import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('score CLI writes a real report and fails incomplete audio instead of silently succeeding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dge-score-cli-'));
  try {
    const manifest = { version: 1, labels: ['source:voice'], clips: [{
      id: 'one', file: 'c000001.wav', sha256: 'a'.repeat(64), group: 'one',
      split: 'test', kind: 'mix', seconds: 30, truth: { 'source:voice': 1 },
      provenance: { type: 'published-annotation', reference: 'test fixture' },
    }] };
    const manifestPath = join(dir, 'manifest.json'), graphPath = join(dir, 'graph.json'), output = join(dir, 'score.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [] }));
    const result = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs',
      'scripts/benchmarks/score.mjs', manifestPath, graphPath, output, 'test'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(existsSync(output), true, 'CLI must write a score report');
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.all.complete, false);
    assert.equal(report.all.status.missing, 1);
    assert.equal(report.all.labels['source:voice'].fn, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
