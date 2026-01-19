import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { getField, inferDelimiter, parseCsvStream } from './utils';
import { createEmbeddingProviderFromEnv } from '../../src/lib/embeddings/providerFactory';
import { embedBatch } from '../../src/lib/embeddings/embedBatch';
import { toVectorLiteral } from '../../src/lib/embeddings/vectorUtils';

const prisma = new PrismaClient();

type SkaItem = {
  id: string;
  name: string;
  description: string | null;
  taxonomyType: 'skill' | 'knowledge' | 'ability';
};

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length);
  }
  return undefined;
}

function resolveBaseDir(): string {
  const raw = process.env.ONET_DATA_DIR ?? './data/onet';
  const resolved = path.resolve(process.cwd(), raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`ONET_DATA_DIR not found: ${resolved}`);
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(resolved, entries[0].name);
  }
  return resolved;
}

function findFile(baseDir: string, patterns: RegExp[], explicit?: string): string {
  if (explicit) {
    const explicitPath = path.join(baseDir, explicit);
    if (fs.existsSync(explicitPath)) {
      return explicitPath;
    }
  }
  const entries = fs.readdirSync(baseDir);
  for (const entry of entries) {
    const lowered = entry.toLowerCase();
    if (patterns.some((pattern) => pattern.test(lowered))) {
      return path.join(baseDir, entry);
    }
  }
  throw new Error(`File not found in ${baseDir}: ${patterns.map((p) => p.source).join(', ')}`);
}

async function loadContentModelReference(filePath: string) {
  const map = new Map<string, { name: string; description: string | null }>();
  await parseCsvStream({
    stream: fs.createReadStream(filePath),
    delimiter: inferDelimiter(filePath),
    onRow: (row) => {
      const elementId = getField(row, ['element id', 'element_id']);
      const name = getField(row, ['element name', 'element_name']);
      const description = getField(row, ['description']);
      if (!elementId || !name) return;
      map.set(elementId, { name, description: description ?? null });
    },
  });
  return map;
}

async function loadUniqueElements(
  filePath: string,
  taxonomyType: SkaItem['taxonomyType'],
  reference: Map<string, { name: string; description: string | null }>,
) {
  const map = new Map<string, SkaItem>();
  await parseCsvStream({
    stream: fs.createReadStream(filePath),
    delimiter: inferDelimiter(filePath),
    onRow: (row) => {
      const elementId = getField(row, ['element id', 'element_id']);
      if (!elementId || map.has(elementId)) return;
      const rawName = getField(row, ['element name', 'element_name']);
      const ref = reference.get(elementId);
      const name = ref?.name ?? rawName;
      if (!name) return;
      map.set(elementId, {
        id: elementId,
        name,
        description: ref?.description ?? null,
        taxonomyType,
      });
    },
  });

  return Array.from(map.values());
}

function computeHash(item: SkaItem): string {
  return [item.id, item.name, item.description ?? '', item.taxonomyType].join('|');
}

async function main() {
  const label = getArgValue('--label') ?? `onet_ska_${Date.now()}`;
  const contentModelFile = getArgValue('--contentModelFile');
  const skillsFile = getArgValue('--skillsFile');
  const knowledgeFile = getArgValue('--knowledgeFile');
  const abilitiesFile = getArgValue('--abilitiesFile');

  const baseDir = resolveBaseDir();
  const contentModelPath = findFile(
    baseDir,
    [/content model reference\.txt/],
    contentModelFile,
  );
  const skillsPath = findFile(baseDir, [/skills\.txt/], skillsFile);
  const knowledgePath = findFile(baseDir, [/knowledge\.txt/], knowledgeFile);
  const abilitiesPath = findFile(baseDir, [/abilities\.txt/], abilitiesFile);

  const reference = await loadContentModelReference(contentModelPath);
  const skills = await loadUniqueElements(skillsPath, 'skill', reference);
  const knowledge = await loadUniqueElements(knowledgePath, 'knowledge', reference);
  const abilities = await loadUniqueElements(abilitiesPath, 'ability', reference);

  const items = [...skills, ...knowledge, ...abilities];
  if (items.length === 0) {
    throw new Error('No SKA entries found. Check O*NET data files.');
  }

  const datasetVersion = await prisma.datasetVersion.create({
    data: {
      datasetName: 'onet_ska',
      versionLabel: label,
      isActive: false,
      metaJson: {
        sourceDir: baseDir,
        files: {
          contentModel: path.basename(contentModelPath),
          skills: path.basename(skillsPath),
          knowledge: path.basename(knowledgePath),
          abilities: path.basename(abilitiesPath),
        },
      },
    },
  });

  const provider = createEmbeddingProviderFromEnv();
  const texts = items.map((item) =>
    `O*NET ${item.taxonomyType}: ${item.name}. Definition: ${item.description ?? ''}`.trim(),
  );
  const embeddings = await embedBatch(provider, texts, 64);

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const vectorLiteral = toVectorLiteral(embeddings[i]);
    await prisma.$executeRawUnsafe(
      'INSERT INTO "SkillCatalog" ("id","datasetVersionId","skillId","name","description","taxonomyType","embedding","embeddingModelId","contentHash","updatedAt") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::vector, $8, $9, NOW()) ON CONFLICT ("datasetVersionId","skillId") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "taxonomyType" = EXCLUDED."taxonomyType", "embedding" = EXCLUDED."embedding", "embeddingModelId" = EXCLUDED."embeddingModelId", "contentHash" = EXCLUDED."contentHash", "updatedAt" = NOW()',
      randomUUID(),
      datasetVersion.id,
      item.id,
      item.name,
      item.description,
      item.taxonomyType,
      vectorLiteral,
      provider.model,
      computeHash(item),
    );
  }

  console.log(
    `INGEST onet_ska done versionId=${datasetVersion.id} label=${datasetVersion.versionLabel} entries=${items.length}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
