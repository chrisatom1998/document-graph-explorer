import { test, expect, type Page } from '@playwright/test';
import { countText, detailPanel, dismissGuide, projectCount } from './resonance';

test('competing tabs retain committed notes and deletion versions when an older save retries', async ({ page, context }) => {
  // This checks persistence across two active tabs; software-rendering two
  // 3D scenes can starve hydration. Exercise the supported 2D preference;
  // the smoke and clarity tests cover 3D rendering independently.
  await context.addInitScript(() => localStorage.setItem('knowledge-nebula-dims', '2'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Load demo corpus' }).click();
  await expect(projectCount(page)).toHaveText(countText(100), { timeout: 270_000 });
  // Verify a restored workspace through its visible project count. Details
  // start collapsed after a restore whether or not a selection survived.
  const restoredCount = async (tab: Page) => {
    await expect(projectCount(tab)).toHaveText(countText(100), { timeout: 150_000 });
  };
  const openNote = async (tab: Page) => {
    await dismissGuide(tab);
    await tab.getByRole('button', { name: 'Search documents', exact: true }).click();
    await tab.getByRole('dialog', { name: 'Search documents' }).getByRole('combobox').fill('Postgres Performance Tuning Guide');
    await tab.getByRole('option', { name: /^Postgres Performance Tuning Guide/ }).click();
    await expect(detailPanel(tab)).toBeVisible({ timeout: 150_000 });
    await tab.getByRole('button', { name: 'About', exact: true }).click();
    await expect(tab.getByRole('textbox', { name: 'Document note' })).toBeVisible();
  };
  await openNote(page);
  // A live graph count does not establish that its asynchronous save committed.
  // The competing-tab scenario needs a restorable baseline before either edit.
  // Observe IndexedDB without forcing a save or changing application state.
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('knowledge-nebula');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['settings', 'corpora']);
      let count = 0;
      const active = tx.objectStore('settings').get('lastCorpusId');
      active.onsuccess = () => {
        if (!active.result) return;
        const corpus = tx.objectStore('corpora').get(active.result);
        corpus.onsuccess = () => {
          const record = corpus.result;
          if (record?.corpusHash) count = record.exportData?.nodes
            ?.filter((node: { kind: string }) => node.kind === 'document').length ?? 0;
        };
      };
      tx.oncomplete = () => { db.close(); resolve(count); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })), { timeout: 150_000, message: 'Initial corpus snapshot committed before opening the competing tab' }).toBe(100);
  const other = await context.newPage();
  await other.goto('/');
  await restoredCount(other);
  await openNote(other);
  // Both edits have the SAME logical millisecond. The first committed value
  // wins; a later retry cannot claim freshness from journal or arrival time.
  const editTime = Date.now() + 60_000;
  for (const tab of [page, other]) await tab.evaluate(time => { Date.now = () => time; }, editTime);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'corpora') throw new DOMException('Test interrupted write', 'QuotaExceededError');
      return put.apply(this, args);
    };
    (window as unknown as { restoreAnnotationWrites: () => void }).restoreAnnotationWrites = () => { IDBObjectStore.prototype.put = put; };
  });
  await page.getByRole('textbox', { name: 'Document note' }).fill('Older pending edit');
  await expect(page.getByText('Could not finish saving notes. Keep this tab open while we retry.', { exact: true })).toBeVisible();
  await other.getByRole('textbox', { name: 'Document note' }).fill('Committed competing edit');
  await expect(other.getByText('Notes saved on this device.', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { restoreAnnotationWrites: () => void }).restoreAnnotationWrites();
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(page.getByRole('textbox', { name: 'Document note' })).toHaveValue('Committed competing edit');
  await expect(page.getByText('A competing saved edit was kept.', { exact: false })).toBeVisible();
  // A committed deletion leaves a version behind; an old recovery copy must
  // not resurrect the note after reload.
  await other.getByRole('textbox', { name: 'Document note' }).fill('');
  await expect(other.getByText('Notes saved on this device.', { exact: true })).toBeVisible();
  await page.evaluate(time => {
    // The completed save normally clears journals. Read the stable annotation
    // key/corpus from the real saved record instead of assuming generated IDs.
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('knowledge-nebula');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('corpora');
        const read = tx.objectStore('corpora').getAll();
        read.onsuccess = () => {
          const record = read.result.find(record => Object.keys(record.annotationVersions ?? {}).length > 0);
          const docKey = Object.keys(record.annotationVersions)[0];
          localStorage.setItem('knowledge-nebula:pending-annotation:' + JSON.stringify([record.id, docKey, 'interrupted']), JSON.stringify({ format: 2, nonce: 'interrupted', updatedAt: time, value: { note: 'Older pending edit', tags: [], pinned: false, updatedAt: time } }));
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, editTime);
  await page.reload();
  await restoredCount(page);
  await openNote(page);
  await expect(page.getByRole('textbox', { name: 'Document note' })).toHaveValue('');
});
