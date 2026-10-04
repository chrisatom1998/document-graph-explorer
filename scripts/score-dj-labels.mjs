/* Measures what the app actually predicts for DJ sound labels on independently
 * labelled loops. Uploads each clip through the real UI and records every label the
 * app reports, so the scorer can compare any taxonomy entry, not just one target. */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST = process.argv[2];
const OUT = process.argv[3];
const BASE = process.env.APP_URL || 'http://localhost:5199';
const LIMIT = Number(process.env.LIMIT || 0);
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const all = LIMIT ? manifest.clips.slice(0, LIMIT) : manifest.clips;
// Resume: a long run can lose its browser or its server, so completed clips are kept.
const RAW = join(OUT, 'raw.json');
const results = existsSync(RAW) ? JSON.parse(readFileSync(RAW, 'utf8')) : [];
const finished = new Set(results.filter(r => r.status === 'ok').map(r => r.id));
for (let i = results.length - 1; i >= 0; i--) if (results[i].status !== 'ok') results.splice(i, 1);
const clips = all.filter(c => !finished.has(c.id));
console.log(`clips=${all.length} already done=${finished.size} to run=${clips.length}`);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
for (const [i, clip] of clips.entries()) {
  if (!existsSync(clip.path)) { console.log(`MISSING ${clip.path}`); continue; }
  const bytes = readFileSync(clip.path);
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [], remote = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  page.on('request', r => { const u = new URL(r.url());
    if (u.protocol.startsWith('http') && !['localhost','127.0.0.1'].includes(u.hostname)) remote.push(r.url()); });
  const started = Date.now();
  let record = { id: clip.id, status: 'error' };
  try {
    await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add files', exact: true }).click();
    // An anonymous name keeps filename hints out of the measurement.
    await page.locator('input[type="file"]').first().evaluate((el, { b64, name }) => {
      const bin = atob(b64), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([buf], name, { type: 'audio/wav' }));
      Object.defineProperty(el, 'files', { configurable: true, value: dt.files });
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { b64: bytes.toString('base64'), name: `clip-${i}.wav` });

    let analysis = null;
    for (let waited = 0; waited < 300000 && !analysis; waited += 1500) {
      await page.waitForTimeout(1500);
      analysis = await page.evaluate(async () => {
        const open = n => new Promise((res, rej) => { const r = indexedDB.open(n); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        let db; try { db = await open('knowledge-nebula'); } catch { return null; }
        if (![...db.objectStoreNames].includes('settings')) return null;
        const keys = await new Promise(res => { const t = db.transaction('settings', 'readonly').objectStore('settings').getAllKeys(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); });
        const key = keys.find(k => typeof k === 'string' && k.startsWith('music-analysis:v2:'));
        if (!key) return null;
        const entry = await new Promise(res => { const t = db.transaction('settings', 'readonly').objectStore('settings').get(key); t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
        const a = entry && entry.audio;
        if (!a || !a.instrumentScan || !a.instrumentScan.complete || a.stage === 'preview') return null;
        const p = a.soundProfile || {};
        return {
          durationSeconds: a.durationSeconds, analyzedSeconds: a.analyzedSeconds,
          // Everything the app would be willing to show, with its status and score.
          observations: (a.recognition ? a.recognition.observations : []).map(o => ({ dimension: o.dimension, label: o.labelId, status: o.status })),
          djTags: (p.djTags || []).map(t => ({ group: t.group, label: t.label, score: t.score, model: t.model })),
          source: p.source ? p.source.label : null,
          resemblance: p.resemblance || null,
          roles: p.roles || [], character: p.character || [],
          voice: p.voice ? { basis: p.voice.basis, style: p.voice.style || null } : null,
          fusionPositive: a.fusion ? [...new Set(a.fusion.windows.filter(w => w.status === 'complete').flatMap(w => w.decisions.filter(d => d.state === 'positive').map(d => d.label)))] : null,
        };
      });
    }
    if (!analysis) throw new Error('analysis did not complete within 300s');
    record = { id: clip.id, status: 'ok', ms: Date.now() - started, truth: clip.truth, pageErrors, remote, ...analysis };
  } catch (e) {
    record = { id: clip.id, status: 'error', ms: Date.now() - started, truth: clip.truth, error: String(e).slice(0, 300), pageErrors, remote };
  }
  await context.close();
  results.push(record);
  console.log(`[${results.length}/${all.length}] ${clip.id} ${record.status} ${record.ms}ms source=${record.source ?? '-'} tags=${record.djTags ? record.djTags.length : 0}`);
  writeFileSync(RAW, JSON.stringify(results, null, 1));
}
await browser.close();
console.log('wrote', RAW, `${results.filter(r => r.status === 'ok').length}/${all.length} ok`);
