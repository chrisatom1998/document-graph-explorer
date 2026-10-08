import { expect, test, type Page } from '@playwright/test';
import { autoDismissTour, openFiles } from './resonance';

// These tiny metadata fixtures run no inference. Report blocked controls
// promptly instead of inheriting the multi-minute OCR/embedding budgets.
test.use({ actionTimeout: 30_000 });
test.setTimeout(120_000);

// ASCII-only, sanitized graph metadata: these fixtures need no document
// parsing, embeddings, audio models, or access to the owner's source files.
function graph(...titles: string[]) {
  return {
    version: 1, generator: 'knowledge-nebula', createdAt: '2026-10-07T00:00:00.000Z',
    includeEmbeddings: false, clusterNames: {}, edges: [],
    nodes: titles.map((title, index) => ({
      id: `n${index}`, title, kind: 'document', fileType: 'txt', topics: [],
      entities: [], keywords: [], wordCount: 1, cluster: 0, degree: 0, status: 'ok',
    })),
  };
}

function shareFragment(...titles: string[]): string {
  const payload = btoa(JSON.stringify(graph(...titles)))
    .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  return `#graph=v1.raw.${payload}`;
}

async function expectSharedView(page: Page, titles: string[]): Promise<void> {
  await expect(page.getByRole('button', { name: 'Current corpus: Shared graph', exact: true })).toBeVisible();
  const files = await openFiles(page);
  await expect(files.getByRole('option')).toHaveCount(titles.length);
  for (const title of titles) await expect(files.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await expect(files.getByRole('option', { name: /Private saved document/ })).toHaveCount(0);
}

async function seedPrivateWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  // Wait for the app to initialize its real schema and corpus registry before
  // seeding a saved snapshot at the IndexedDB boundary.
  const switcher = page.getByRole('button', { name: /^Current corpus:/ });
  await switcher.click();
  await expect(page.getByRole('list', { name: 'Saved corpora' }).getByRole('listitem')).toHaveCount(1);
  await switcher.click();
  const snapshot = graph('Private saved document');
  snapshot.nodes[0].id = 'private-document';
  await page.evaluate(exportData => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('knowledge-nebula');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['corpora', 'settings'], 'readwrite');
      tx.objectStore('corpora').put({
        id: 'share-test-private', name: 'Private workspace', createdAt: 1, updatedAt: 1,
        corpusHash: 'private-graph-hash', docHashes: ['private-document'], exportData, positions: {},
      });
      tx.objectStore('settings').put('share-test-private', 'lastCorpusId');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), snapshot);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('knowledge-nebula-dims', '2'));
  await autoDismissTour(page);
});

test('opens a shared graph on startup and replaces it on live hash navigation without mixing saved data', async ({ page }) => {
  await seedPrivateWorkspace(page);
  // Changing the search forces a full document navigation, exercising App's
  // startup wiring rather than only the already-mounted hashchange handler.
  await page.goto(`/?share-test=start${shareFragment('First shared document', 'First share only')}`);
  await expectSharedView(page, ['First shared document', 'First share only']);

  await page.evaluate(fragment => { window.location.hash = fragment; }, shareFragment('Second shared document'));
  await expectSharedView(page, ['Second shared document']);
  await expect(page.getByRole('option', { name: /First shared document|First share only/ })).toHaveCount(0);

  // Restore through the real workspace picker: opening either portable view
  // must leave the saved private graph available and unchanged.
  const picker = page.getByRole('button', { name: 'Current corpus: Shared graph', exact: true });
  // A visible picker can still be covered by the view tabs. Exercise actual
  // pointer clicks across compact layouts before restoring at the CI width.
  for (const width of [1024, 390, 800]) {
    await page.setViewportSize({ width, height: 500 });
    await picker.click();
    await expect(page.getByRole('dialog', { name: 'Manage corpora', exact: true })).toBeVisible();
    await picker.click();
    await expect(page.getByRole('dialog', { name: 'Manage corpora', exact: true })).toHaveCount(0);
  }
  await picker.click();
  await page.getByRole('list', { name: 'Saved corpora' }).getByRole('button', { name: /^Private workspace/ }).click();
  await expect(page.getByRole('button', { name: 'Current corpus: Private workspace', exact: true })).toBeVisible();
  const localFiles = await openFiles(page);
  await expect(localFiles.getByRole('option')).toHaveCount(1);
  await expect(localFiles.getByRole('option', { name: /Private saved document/ })).toBeVisible();
});

for (const form of ['escaped delimiters', 'query fallback'] as const) {
  test(`opens a startup share with ${form}`, async ({ page }) => {
    const fragment = shareFragment('Messenger shared document');
    const href = form === 'escaped delimiters'
      ? `/${encodeURIComponent(fragment)}`
      : `/?graph=${fragment.slice('#graph='.length)}`;
    await page.goto(href);
    await expectSharedView(page, ['Messenger shared document']);
  });
}
