/**
 * Shared helpers for driving the Resonance workspace.
 *
 * The shell replaced the floating toolbar, the overlay document list and the
 * modal side panel, so specs go through these helpers rather than naming the
 * old controls directly — one place to update when the chrome moves again.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Start a fresh profile in 3D. Resonance opens in 2D by default; specs that
 * cover 3D rendering first opt back in. Written once, so a later 2D choice
 * still survives reloads.
 */
export async function startIn3D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('knowledge-nebula-dims') === null) localStorage.setItem('knowledge-nebula-dims', '3');
    } catch { /* storage unavailable: the app default applies */ }
  });
}

/** Dismiss the first-run tour when it is up; it swallows keyboard input. */
export async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await tour.isVisible().catch(() => false)) await tour.click();
}

/** Switch the shell's view tabs. */
export async function openTab(page: Page, tab: 'Graph' | 'Library' | 'Export'): Promise<void> {
  await page.getByRole('button', { name: tab, exact: true }).click();
}

/** Open the Library tab and return its document listbox (replaces "Browse documents"). */
export async function openFiles(page: Page): Promise<Locator> {
  await dismissTour(page);
  await openTab(page, 'Library');
  const listbox = page.getByRole('listbox', { name: 'Graph nodes' });
  await expect(listbox).toBeVisible();
  return listbox;
}

/** Pick a document from the library by its visible name, leaving the Graph tab active. */
export async function openDocument(page: Page, name: RegExp | string): Promise<void> {
  await openFiles(page);
  await page.getByRole('option', { name }).click();
  await openTab(page, 'Graph');
}

/** How many documents the workspace holds, as the sidebar reports it ("100 files in project"). */
export function corpusCount(page: Page): Locator {
  return page.locator('.rs-count');
}

/** The expanded "Full details" panel — the inline replacement for the modal side panel. */
export function details(page: Page): Locator {
  return page.locator('.rs-details .side-panel');
}

/** The inspector's details toggle, whatever clip it currently names. */
export function detailsToggle(page: Page): Locator {
  return page.locator('.rs-inspector__details');
}

/** Expand full details for the selected clip (a no-op when already open). */
export async function openDetails(page: Page): Promise<Locator> {
  const toggle = detailsToggle(page);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(details(page)).toBeVisible();
  return details(page);
}

/** Collapse full details (replaces the side panel's "Back to graph"). */
export async function closeDetails(page: Page): Promise<void> {
  const toggle = detailsToggle(page);
  if (await toggle.count() && (await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await expect(details(page)).toHaveCount(0);
}

/** Frame the whole graph (the old toolbar button; Home is the app-wide shortcut). */
export async function fitAll(page: Page): Promise<void> {
  // Fitting implies looking at the graph: leave the Library/Export overlay first,
  // so following canvas drags and wheel events reach the scene.
  const graphTab = page.getByRole('button', { name: 'Graph', exact: true });
  if ((await graphTab.getAttribute('aria-current')) !== 'page') await graphTab.click();
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press('Home');
}

/** Open the top bar's tool menu and click one of its items. */
export async function toolMenu(page: Page, item: RegExp | string): Promise<void> {
  await page.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Open the chat panel (replaces the floating chat launcher). */
export async function openChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ask about your library' }).click();
}

/** Open the sample assistant (replaces the floating .dj-launch pill). */
export async function openSampleAssistant(page: Page): Promise<void> {
  await page.locator('.rs-assistant').click();
}

/**
 * Make the filter column reachable. Below 860px (including the suite's
 * default 800x500 window) it hides behind a "Filters" button.
 */
export async function showFilters(page: Page): Promise<void> {
  const toggle = page.locator('.rs-narrow-filters');
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Expand (or collapse) the sidebar's classic filter panel: clusters, connection counts, recency. */
export async function advancedFilters(page: Page, open = true): Promise<void> {
  await showFilters(page);
  const panel = page.locator('.rs-advanced');
  if ((await panel.evaluate(el => (el as HTMLDetailsElement).open)) !== open) {
    await panel.locator('summary').click();
  }
  // A closed <details> keeps its children mounted, so check visibility, not count.
  const filterPanel = page.locator('.rs-advanced .filter-bar');
  if (open) await expect(filterPanel).toBeVisible();
  else await expect(filterPanel).toBeHidden();
}

/** Toggle one similarity-type filter checkbox in the left sidebar. */
export async function similarityFilter(page: Page, label: string, on = true): Promise<void> {
  await showFilters(page);
  // The native input is visually hidden behind a styled box, so drive the label.
  const box = page.getByRole('checkbox', { name: label, exact: true });
  if ((await box.isChecked()) !== on) await page.locator('.rs-checks label', { hasText: label }).click();
  if (on) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
}
