#!/usr/bin/env node
/**
 * Check for untracked files that are imported by tracked/staged files.
 * This prevents the "works locally but fails in CI" scenario.
 * 
 * Usage: node scripts/check-untracked-imports.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

const ROOT = process.cwd();

// Get list of untracked files
function getUntrackedFiles() {
    try {
        const output = execSync('git ls-files --others --exclude-standard', {
            encoding: 'utf-8',
            cwd: ROOT
        });
        return new Set(output.trim().split('\n').filter(Boolean));
    } catch {
        return new Set();
    }
}

// Get list of tracked + staged files that might have imports
function getTrackedSourceFiles() {
    try {
        const tracked = execSync('git ls-files', { encoding: 'utf-8', cwd: ROOT });
        const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8', cwd: ROOT });
        const all = [...tracked.split('\n'), ...staged.split('\n')]
            .filter(f => /\.(ts|tsx|js|jsx|mjs)$/.test(f))
            .filter(Boolean);
        return [...new Set(all)];
    } catch {
        return [];
    }
}

// Extract relative imports from a file
function extractImports(filePath) {
    const fullPath = join(ROOT, filePath);
    if (!existsSync(fullPath)) return [];

    const content = readFileSync(fullPath, 'utf-8');
    const importRegex = /(?:import|from)\s+['"](\.[^'"]+)['"]/g;
    const imports = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        const dir = dirname(filePath);

        // Try common extensions
        const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
        for (const ext of extensions) {
            const resolved = join(dir, importPath + ext);
            imports.push(resolved);
        }
    }

    return imports;
}

// Main check
function main() {
    const untrackedFiles = getUntrackedFiles();
    if (untrackedFiles.size === 0) {
        console.log('✓ No untracked files');
        process.exit(0);
    }

    const trackedFiles = getTrackedSourceFiles();
    const problems = [];

    for (const file of trackedFiles) {
        const imports = extractImports(file);
        for (const importPath of imports) {
            if (untrackedFiles.has(importPath)) {
                problems.push({ file, imports: importPath });
            }
        }
    }

    if (problems.length === 0) {
        console.log('✓ No untracked imports detected');
        process.exit(0);
    }

    console.error('\n❌ Found untracked files that are imported by tracked files:\n');
    for (const { file, imports } of problems) {
        console.error(`  ${file}`);
        console.error(`    → imports untracked: ${imports}`);
    }
    console.error('\nRun: git add <files> to fix this.\n');
    process.exit(1);
}

main();
