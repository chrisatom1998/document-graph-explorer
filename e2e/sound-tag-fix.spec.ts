import { test, expect, type Page } from '@playwright/test';
import { waitForGraphReady } from './resonance';

// A real recording: the committed Iowa MIS flute fixture (see its LICENSE-ATTRIBUTION.md), with a fixed two-tap echo
// added in the page (the same arithmetic as ffmpeg `aecho=0.8:0.8:300|600:0.6|0.4`). The dry clip's tags are all
// "likely"; the echo makes two maybe-level detectors fire, so the chip has low-confidence tags to sit on.
const FLUTE = 'src/audio/sourceMatching/testfixtures/iowa-flute-first8s.wav';

async function uploadEchoFlute(page: Page) {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.id = 'e2e-fixture'; input.hidden = true;
    document.body.append(input);
  });
  await page.locator('#e2e-fixture').setInputFiles(FLUTE);
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await page.evaluate(async () => {
    const source = document.querySelector<HTMLInputElement>('#e2e-fixture')!;
    const bytes = new Uint8Array(await source.files![0].arrayBuffer());
    const view = new DataView(bytes.buffer);
    const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
    let fmt = -1, data = -1, dataSize = 0;
    for (let at = 12; at + 8 <= bytes.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1)) {
      if (tag(at) === 'fmt ') fmt = at + 8;
      if (tag(at) === 'data') { data = at + 8; dataSize = view.getUint32(at + 4, true); break; }
    }
    const channels = view.getUint16(fmt + 2, true), rate = view.getUint32(fmt + 4, true), bits = view.getUint16(fmt + 14, true);
    if (channels !== 1 || bits !== 16 || data < 0) throw new Error('Expected the mono 16-bit flute fixture.');
    const count = dataSize / 2, taps = [[.3, .6], [.6, .4]].map(([s, decay]) => [Math.round(s * rate), decay]);
    const out = new ArrayBuffer(44 + count * 2), o = new DataView(out);
    const text = (at: number, value: string) => [...value].forEach((c, i) => o.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); o.setUint32(4, out.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    o.setUint32(16, 16, true); o.setUint16(20, 1, true); o.setUint16(22, 1, true);
    o.setUint32(24, rate, true); o.setUint32(28, rate * 2, true); o.setUint16(32, 2, true); o.setUint16(34, 16, true);
    text(36, 'data'); o.setUint32(40, count * 2, true);
    const x = (i: number) => i < 0 ? 0 : view.getInt16(data + i * 2, true);
    for (let i = 0; i < count; i++) {
      const y = (x(i) * .8 + taps.reduce((sum, [d, decay]) => sum + x(i - d) * decay, 0)) * .8;
      o.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(y))), true);
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([out], 'Iowa flute echo.wav', { type: 'audio/wav' }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not(#e2e-fixture)')!;
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    source.remove();
  });
}

test('"Not sure? Fix it" sits on low-confidence tags only, and a fix survives reload', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
  await page.goto('/');
  await uploadEchoFlute(page);
  await waitForGraphReady(page, 300_000);
  const sounds = page.getByRole('region', { name: 'Sound identification' });
  const openTrack = async () => {
    await page.getByRole('button', { name: 'Search documents' }).click();
    await page.locator('.search-result-row').filter({ hasText: /flute echo/i }).first().click();
    await expect(sounds).toBeVisible();
  };
  await openTrack();
  // Background verification may still be adding tags; wait until the chips settle on the maybe/possible tags.
  const chips = sounds.getByRole('button', { name: /^Not sure\? Fix / });
  await expect(chips.first()).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('.music-status')).toHaveCount(0, { timeout: 180_000 });
  const chipCount = await chips.count();
  expect(chipCount).toBeGreaterThanOrEqual(2);
  // Only on possible or maybe tags: never on likely tags, and no Confirm/Reject buttons anywhere.
  expect(await sounds.locator('.sound-tag:not(.sound-tag--maybe):not(.sound-tag--possible) .sound-tag__fix').count()).toBe(0);
  expect(await sounds.locator('.sound-tag--maybe .sound-tag__fix, .sound-tag--possible .sound-tag__fix').count()).toBe(chipCount);
  await expect(page.getByRole('button', { name: /^(Confirm|Reject)$/ })).toHaveCount(0);
  await sounds.screenshot({ path: testInfo.outputPath('chip.png') });

  const labelOf = async (index: number) => (await chips.nth(index).getAttribute('aria-label'))!.replace('Not sure? Fix ', '');
  const removed = await labelOf(0), kept = await labelOf(1);
  await chips.nth(0).click();
  const fixer = page.getByRole('group', { name: `Fix ${removed}` });
  await expect(fixer).toBeVisible();
  await expect(fixer.getByRole('combobox', { name: 'Pick the right tag' })).toBeVisible();
  await sounds.screenshot({ path: testInfo.outputPath('fix-it.png') });
  await fixer.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.music-features [role="status"]')).toContainText('Your fix is saved.');
  await sounds.getByRole('button', { name: `Not sure? Fix ${kept}` }).click();
  await page.getByRole('group', { name: `Fix ${kept}` }).getByRole('button', { name: 'Keep' }).click();
  await expect(sounds.getByRole('button', { name: `Not sure? Fix ${kept}` })).toHaveCount(0);

  const tagText = (label: string) => sounds.locator('.sound-tag > span:first-of-type, .sound-tag > .sound-tag__mark + span').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  const expectFixed = async () => {
    await expect(tagText(removed)).toHaveCount(0);
    await expect(sounds.locator('.sound-tag--confirmed').filter({ hasText: kept })).toHaveCount(1);
    await expect(chips).toHaveCount(chipCount - 2);
  };
  await expectFixed();
  await sounds.screenshot({ path: testInfo.outputPath('after-fix.png') });

  await page.reload();
  await waitForGraphReady(page, 180_000);
  await openTrack();
  await expectFixed();
  expect(errors).toEqual([]);
});
