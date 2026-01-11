import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';

export const runtime = "nodejs";

export async function GET(req: Request) {
  const prisma = getPrisma();
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'oflc', isActive: true },
  });

  if (!datasetVersion) {
    return NextResponse.json({ error: 'Active OFLC dataset version not found' }, { status: 500 });
  }

  const results = await prisma.socTitle.findMany({
    where: {
      datasetVersionId: datasetVersion.id,
      ...(query
        ? {
            OR: [
              { socCode: { contains: query, mode: 'insensitive' } },
              { title: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { socCode: 'asc' },
    take: 200,
  });

  return NextResponse.json(
    results.map((entry) => ({ code: entry.socCode, title: entry.title })),
  );
}
