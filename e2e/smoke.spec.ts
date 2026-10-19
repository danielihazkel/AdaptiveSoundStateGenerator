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
