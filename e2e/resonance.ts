import { expect, type Page } from '@playwright/test';

// Shared helpers for the Resonance workspace: a top bar (search, chat, a
// "More tools" menu), a filter column on the left, the graph in the middle
// with the Library and Export tabs layered over it, and the connected-clips
// inspector on the right. Full document details expand inside that inspector
// once a focus commits (search, library, chat citations), so there is no
// floating side-panel dialog any more.

/** "N files in project" / "N clips in project" in the sidebar. */
export const projectCount = (page: Page) => page.locator('.rs-count');
export const countText = (count: number) => new RegExp(`^${count} (files|clips) in project$`);

/** The expanded details panel inside the inspector. */
export const detailPanel = (page: Page) => page.locator('.side-panel[role="region"]');

export async function dismissGuide(page: Page) {
  const guide = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await guide.isVisible().catch(() => false)) await guide.click();
}

function viewTab(page: Page, name: 'Graph' | 'Library' | 'Export') {
  return page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true });
}

/** Switch to the Library tab and return its accessible node list. */
export async function openLibrary(page: Page, { keepGuide = false } = {}) {
  if (!keepGuide) await dismissGuide(page);
  const tab = viewTab(page, 'Library');
  if ((await tab.getAttribute('aria-current')) !== 'page') await tab.click();
  const list = page.getByRole('listbox', { name: 'Graph nodes' });
  await expect(list).toBeVisible();
  return list;
}

export async function showGraph(page: Page) {
  await viewTab(page, 'Graph').click();
  await expect(page.getByRole('listbox', { name: 'Graph nodes' })).toHaveCount(0);
}

export async function openExport(page: Page) {
  await viewTab(page, 'Export').click();
  await expect(page.getByRole('region', { name: 'Export and import' })).toBeVisible();
}

/** Run an item of the top bar's "More tools" menu. */
export async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Switch the graph to 2D or 3D; a no-op (menu closed again) when already there. */
export async function switchDims(page: Page, dims: 2 | 3) {
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  const item = page.getByRole('menuitem', { name: dims === 2 ? 'Switch to 2D' : 'Switch to 3D', exact: true });
  await expect(page.getByRole('menuitem', { name: /^Switch to [23]D$/ })).toBeVisible();
  if (await item.count()) await item.click();
  else await page.getByRole('button', { name: 'Close menu', exact: true }).click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('application', { name: dims === 2 ? /Interactive 2D/ : /Interactive 3D/ })).toBeVisible();
}

/** Home fits the whole graph in view (the global keyboard shortcut). */
export async function fitAll(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Home');
}

export async function hideDetails(page: Page) {
  await page.getByRole('button', { name: 'Hide full details', exact: true }).click();
  await expect(detailPanel(page)).toHaveCount(0);
}

/** Import a graph JSON through the welcome screen's file input. */
export async function importGraphJson(page: Page, json: string, fileName = 'graph.json'): Promise<void> {
  await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
  const input = page.locator('input[type="file"][accept*=".json"]');
  await expect(input).toHaveCount(1);
  await input.evaluate((element, [contents, name]) => {
    const fileInput = element as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], name, { type: 'application/json' }));
    Object.defineProperty(fileInput, 'files', { configurable: true, value: transfer.files });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }, [json, fileName]);
}

/** Pick a file or folder through the sidebar's import buttons. */
export async function pickFiles(page: Page, files: string | string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Import (files|clips)/ }).click();
  await (await chooser).setFiles(files);
}
export async function pickFolder(page: Page, folder: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Import sounds/ }).click();
  await (await chooser).setFiles(folder);
}

/** Below 860px the filter column folds behind a Filters button; open it when needed. */
// (Its name reads "Filters" or "Done", followed by "filters on" while one is active.)
const narrowFilters = (page: Page) => page.locator('.rs-narrow-filters');
export async function openFilters(page: Page) {
  const toggle = narrowFilters(page);
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}
export async function closeFilters(page: Page) {
  const toggle = narrowFilters(page);
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
}
