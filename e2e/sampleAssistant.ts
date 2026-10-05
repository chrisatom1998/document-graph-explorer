import { expect, type Locator, type Page } from '@playwright/test';

// Tag corrections live in the sample assistant's per-sound "Correct tags"
// editor; the track panel only shows the saved results.
export async function correctDjTags(page: Page, title: string | RegExp, edit: (card: Locator) => Promise<void>, saved: string) {
  await page.getByRole('button', { name: /Sample assistant/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Find your next sound.' });
  await expect(dialog).toBeVisible();
  const card = dialog.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByText('More', { exact: true }).click();
  await card.getByRole('button', { name: 'Correct tags', exact: true }).click();
  await card.getByText('Correct DJ tags', { exact: true }).click();
  await edit(card);
  await card.getByRole('button', { name: 'Save DJ tags', exact: true }).click();
  await expect(card.getByText(saved, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close sample assistant' }).click();
  await expect(dialog).not.toBeVisible();
}
