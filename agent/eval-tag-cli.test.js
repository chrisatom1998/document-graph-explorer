import { describe, expect, it } from 'vitest';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { inputCacheIdentity } from '../scripts/eval-tag-input';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const cli = (...args) => spawnSync(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), 'scripts/eval-tag.ts', ...args], { encoding: 'utf8', timeout: 20000 });
describe('evaluator rejects invalid requests before inference', () => {
  it.each([
    [['--row-seconds', '--tag', 'kick'], '--row-seconds needs a value'],
    [['--row-seconds', 'NaN', '--tag', 'kick'], '--row-seconds must be a number'],
    [['--limit', '-1', '--tag', 'kick'], '--limit must be a number'],
    [['--shard', '1/1', '--tag', 'kick'], '--shard must be i/n'],
    [['--clap-backend', 'cuda', '--tag', 'kick'], '--clap-backend must be cpu or wasm'],
    [['--tag', 'warm'], 'comes from DSP rules'],
    [['--tag', 'kick', '--watch', 'airy'], 'comes from DSP rules'],
  ])('%j', (args, message) => {
    const result = cli(...args, '--set', '/nonexistent-evaluator-input.json');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  }, 25000);
});

it('rejects a valid candidate model with unsupported feature blocks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-tag-block-'));
  try {
    const model = JSON.parse(readFileSync('public/sound-model/short-clip.json', 'utf8'));
    model.blocks = ['clapZero']; // Same width: still passes the app sanitizer.
    const file = join(dir, 'short.json'); writeFileSync(file, JSON.stringify(model));
    const result = cli('--tag', 'kick', '--set', '/nonexistent-evaluator-input.json', '--short-clip', file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('only computes clapRepeat');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 25000);

it('uses current labels, invalidates row interpretation, and sweeps merged policies through the CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-tag-cache-'));
  try {
    const setPath = join(dir, 'set.json'), npy = join(dir, 'set.npy'), cache = join(dir, 'cache');
    const labels = { 'cat:clap': 1, 'cat:downlifter': 1, 'cat:vinyl scratch': 1 };
    writeFileSync(setPath, JSON.stringify({ items: [{ id: 'one', artist: 'new-group', labels }] }));
    const header = "{'descr': '<i2', 'fortran_order': False, 'shape': (1, 4), }\n";
    const bytes = Buffer.alloc(10 + header.length + 8);
    bytes.write('\x93NUMPY', 0, 'latin1'); bytes[6] = 1; bytes.writeUInt16LE(header.length, 8); bytes.write(header, 10);
    writeFileSync(npy, bytes); mkdirSync(cache);
    const manifest = JSON.parse(readFileSync('public/sound-model/manifest.json', 'utf8'));
    const tagger = JSON.parse(readFileSync('public/tagger-model/model.json', 'utf8'));
    const identity = inputCacheIdentity([npy], { rowSeconds: 0, fromFiles: false, ids: ['one'], offsets: undefined });
    const name = `set.${identity}.${manifest.sha256['onnx/audio_model_quantized.onnx'].slice(0, 8)}-${tagger.sha256['model.onnx'].slice(0, 8)}.shard-0-of-1.jsonl`;
    writeFileSync(join(cache, name), JSON.stringify({ id: 'one', group: 'old-group', labels: { 'effect:kick': 1 }, duration: 4, clap: [], tagger: [] }) + '\n');
    const out = join(dir, 'report.json');
    const args = ['--tag', 'clap,downlifter,vinyl scratch', '--set', setPath, '--cache', cache, '--decide-only', '--grid-head', '0.5', '--grid-tagger', '0.5', '--out', out];
    const result = cli(...args);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.complete).toBe(true);
    expect(report.current['effect:clap'].all.positives).toBe(1);
    expect(report.candidates.downlifter.tagger.note).toContain('cat:falling');
    expect(report.candidates.downlifter['clap-head'].note).toContain('falling');
    expect(report.candidates['vinyl scratch'].tagger.note).toContain('cat:turntable');
    const changed = cli(...args, '--row-seconds', '2');
    expect(changed.status, changed.stderr).toBe(0);
    const partial = JSON.parse(readFileSync(out, 'utf8'));
    expect(partial.complete).toBe(false);
    expect(partial.unscoredClips).toBe(1);
    expect(partial.current['effect:clap'].all).toMatchObject({ positives: 1, fn: 1, passes6030: false });
    const missingFiles = cli(...args, '--audio-dir', dir);
    expect(missingFiles.status, missingFiles.stderr).toBe(0);
    const missing = JSON.parse(readFileSync(out, 'utf8'));
    expect(missing.complete).toBe(false);
    expect(missing.current['effect:clap'].all).toMatchObject({ positives: 1, fn: 1, passes6030: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 45000);
