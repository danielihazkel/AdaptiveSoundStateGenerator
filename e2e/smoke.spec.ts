import { expect, test, type Page } from '@playwright/test';

/** Fresh visitor: acknowledge the disclaimer and skip the intro tour. */
async function firstVisit(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByRole('button', { name: 'Skip tour' }).click();
}

test('setup → session → stop → rate → history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await firstVisit(page);
  await page.getByRole('radio', { name: /Focus/ }).click();
  await page.getByRole('button', { name: /► Begin/ }).click();

  // Session screen: the volume is in view and answers to the arrow keys.
  const volume = page.getByRole('slider', { name: 'Volume' });
  await expect(volume).toBeVisible();
  const before = Number(await volume.inputValue());
  await page.locator('h1').focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => Number(await volume.inputValue())).toBeCloseTo(before + 0.05, 5);

  // Space pauses from the page.
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();

  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByText('How effective was this?')).toBeVisible();
  await page.getByRole('button', { name: '4', exact: true }).click();

  await page.getByRole('button', { name: /Session history/ }).click();
  const history = page.locator('.history');
  await expect(history).toContainText('1total');
  await expect(history).toContainText(/Focus · .*★★★★(?!★)/);

  expect(errors).toEqual([]);
});

test('settings round-trip through #settings', async ({ page }) => {
  await firstVisit(page);
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page).toHaveURL(/#settings$/);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'Every session' }).click();
  await page.getByRole('checkbox', { name: /Adapt mid-session/ }).uncheck();

  await page.reload();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Every session' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: /Adapt mid-session/ })).not.toBeChecked();

  await page.goBack();
  await expect(page.getByRole('button', { name: /► Begin/ })).toBeVisible();
});

test('a sleep session goes nightstand-dark and a tap brings the controls back', async ({ page }) => {
  await page.clock.install();
  await firstVisit(page);
  await page.getByRole('radio', { name: /Sleep/ }).click();
  await page.getByRole('button', { name: /► Begin/ }).click();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();

  const cover = page.getByRole('button', { name: 'Show session controls' });
  await expect(cover).toHaveCount(0);
  await page.clock.fastForward(21_000);
  await expect(cover).toBeVisible();

  // The tap lands on the cover only — it must not press Stop underneath.
  await cover.click();
  await expect(cover).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
});

test('a running session publishes lock-screen metadata with drawn artwork', async ({ page }) => {
  await firstVisit(page);
  await page.getByRole('radio', { name: /Focus/ }).click();
  await page.getByRole('button', { name: /► Begin/ }).click();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
  const meta = await page.evaluate(() => {
    const m = navigator.mediaSession.metadata;
    return m ? { title: m.title, art: m.artwork.map((a) => ({ src: a.src.slice(0, 22), sizes: a.sizes })) } : null;
  });
  expect(meta?.title).toMatch(/^Focus · /);
  expect(meta?.art).toEqual([{ src: 'data:image/png;base64,', sizes: '512x512' }]);
});

test('a downloaded MP3 carries its title and cover', async ({ page }) => {
  test.setTimeout(180_000);
  await firstVisit(page);
  await page.getByRole('radio', { name: /Relax/ }).click();
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('Session length in minutes').fill('5');
  await page.getByLabel('Session length in minutes').blur();
  const download = page.waitForEvent('download', { timeout: 150_000 });
  await page.getByRole('button', { name: /⤓ Download 5 min MP3/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mp3$/);
  const stream = await file.createReadStream();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk as Uint8Array);
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const head = String.fromCharCode(...bytes.subarray(0, 3));
  expect(head).toBe('ID3');
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 4000));
  expect(text).toContain('APIC'); // the drawn cover made it in
  expect(text).toContain('image/png');
  expect(bytes.length).toBeGreaterThan(1_000_000); // and five minutes of audio follow
});

test('the session visualizer draws from the live output, and Settings can turn it off', async ({ page }) => {
  await firstVisit(page);
  await page.getByRole('radio', { name: /Focus/ }).click();
  await page.getByRole('button', { name: /► Begin/ }).click();
  const canvas = page.locator('canvas.session-visualizer');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let painted = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
        return painted;
      }),
    )
    .toBeGreaterThan(1000);
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.getByRole('button', { name: 'Skip' }).click();

  await page.getByRole('button', { name: /Settings/ }).click();
  await page.getByRole('checkbox', { name: /soft glow/ }).uncheck();
  await page.goBack();
  await page.getByRole('button', { name: /► Begin/ }).click();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
  await expect(canvas).toHaveCount(0);
});
