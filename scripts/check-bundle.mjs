#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const ENTRY_BUDGET_BYTES = 80_000;
const EAGER_JS_BUDGET_BYTES = 280_000;
const FORBIDDEN_EAGER_CHUNK = /(NebulaCanvas|coordinatorLazy|palette|markdownAst|PdfPreview)/i;

const distDir = resolve(process.argv[2] ?? 'dist');
const htmlPath = resolve(distDir, 'index.html');

function assetPath(url) {
  const clean = url.split(/[?#]/, 1)[0].replace(/^\.?\//, '');
  return resolve(distDir, clean);
}

function kb(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

try {
  const html = await readFile(htmlPath, 'utf8');
  const entryMatch = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i);
  if (!entryMatch) throw new Error(`No module entry script found in ${htmlPath}`);

  const preloads = [...html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/gi)]
    .map((match) => match[1]);
  const forbidden = preloads.filter((url) => FORBIDDEN_EAGER_CHUNK.test(url));
  if (forbidden.length > 0) {
    throw new Error(`Heavy feature chunks became eager modulepreloads: ${forbidden.join(', ')}`);
  }

  const entryUrl = entryMatch[1];
  const entryBytes = (await stat(assetPath(entryUrl))).size;
  const eagerUrls = [...new Set([entryUrl, ...preloads])];
  const eagerBytes = (await Promise.all(eagerUrls.map(async (url) => (await stat(assetPath(url))).size)))
    .reduce((sum, bytes) => sum + bytes, 0);

  const failures = [];
  if (entryBytes > ENTRY_BUDGET_BYTES) {
    failures.push(`entry ${kb(entryBytes)} exceeds ${kb(ENTRY_BUDGET_BYTES)}`);
  }
  if (eagerBytes > EAGER_JS_BUDGET_BYTES) {
    failures.push(`eager JavaScript ${kb(eagerBytes)} exceeds ${kb(EAGER_JS_BUDGET_BYTES)}`);
  }
  if (failures.length > 0) throw new Error(failures.join('; '));

  console.log(
    `Bundle budget OK for ${distDir}: entry ${kb(entryBytes)}, eager JavaScript ${kb(eagerBytes)}.`,
  );
} catch (error) {
  console.error(`Bundle budget failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
