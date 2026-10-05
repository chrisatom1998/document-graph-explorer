/* Format / duration qualification for the installed fusion release.
 * Uploads each variant of each clip through the real app and records the fusion decisions.
 * No labels are used here: this measures whether the SAME audio gets the SAME answer
 * when the container or the length changes. */
import { chromium } from '@playwright/test';
import { readdirSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const QUAL = process.argv[2];
const OUT  = process.argv[3];
const BASE = process.env.APP_URL || 'http://localhost:5199';
const VARIANTS = (process.env.VARIANTS || 'ogg,wav,mp3,wav20').split(',');
const MIME = { ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg', wav20: 'audio/wav' };
const EXT  = { ogg: 'ogg', wav: 'wav', mp3: 'mp3', wav20: 'wav' };
const LIMIT = Number(process.env.LIMIT || 0);
mkdirSync(OUT, { recursive: true });

const ids = readdirSync(join(QUAL, 'ogg')).filter(f => f.endsWith('.ogg')).map(f => basename(f, '.ogg')).sort();
const clips = LIMIT ? ids.slice(0, LIMIT) : ids;
console.log(`clips=${clips.length} variants=${VARIANTS.join(',')} -> ${clips.length * VARIANTS.length} analyses`);

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;  // reuse an already-installed build; no download
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const results = [];
let done = 0;

for (const variant of VARIANTS) {
  for (const id of clips) {
    const file = join(QUAL, variant, `${id}.${EXT[variant]}`);
    if (!existsSync(file)) { console.log(`MISSING ${file}`); continue; }
    const bytes = readFileSync(file);
    const context = await browser.newContext();           // cold profile per clip: no cache carry-over
    const page = await context.newPage();
    const pageErrors = [], remote = [];
    page.on('pageerror', e => pageErrors.push(String(e.message)));
    page.on('request', r => { const u = new URL(r.url());
      if (u.protocol.startsWith('http') && !['localhost','127.0.0.1'].includes(u.hostname)) remote.push(r.url()); });
    const started = Date.now();
    let record = { id, variant, status: 'error' };
    try {
      await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add files', exact: true }).click();
      await page.locator('input[type="file"]').first().evaluate((el, { b64, name, type }) => {
        const bin = atob(b64), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([buf], name, { type }));
        Object.defineProperty(el, 'files', { configurable: true, value: dt.files });
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { b64: bytes.toString('base64'), name: `${variant}-${id}.${EXT[variant]}`, type: MIME[variant] });

      // Poll from Node with evaluate(): an async predicate inside waitForFunction
      // returns a Promise, which is always truthy and resolves on the first tick.
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
          return {
            durationSeconds: a.durationSeconds, analyzedSeconds: a.analyzedSeconds,
            mode: a.recognition && a.recognition.mode, scanMode: a.instrumentScan.mode,
            fusion: a.fusion ? { validation: a.fusion.validation, planned: a.fusion.planned, counts: a.fusion.counts,
              omittedWindows: a.fusion.omittedWindows,
              windows: a.fusion.windows.map(w => ({ start: w.start, end: w.end, status: w.status, reason: w.reason,
                decisions: w.decisions.filter(d => d.state !== 'unavailable').map(d => ({ label: d.label, state: d.state, p: d.headProbability, dp: d.decisionProbability, src: d.source })) })) } : null,
            source: a.soundProfile && a.soundProfile.source ? a.soundProfile.source.label : null,
          };
        });
      }
      if (!analysis) throw new Error('analysis did not complete within 300s');
      record = { id, variant, status: 'ok', ms: Date.now() - started, pageErrors, remote, ...analysis };
    } catch (e) {
      record = { id, variant, status: 'error', ms: Date.now() - started, error: String(e).slice(0, 300), pageErrors, remote };
    }
    await context.close();
    results.push(record);
    done++;
    console.log(`[${done}/${clips.length * VARIANTS.length}] ${variant} ${id} ${record.status} ${record.ms ?? ''}ms fusionWindows=${record.fusion ? record.fusion.windows.length : 'none'}`);
    writeFileSync(join(OUT, 'raw.json'), JSON.stringify(results, null, 1));
  }
}
await browser.close();
console.log('wrote', join(OUT, 'raw.json'));
