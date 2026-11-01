import { expect, test } from '@playwright/test';
import { evidence, instrumentation, settings } from './helpers';
test('正式存储: six existing themes retain readable AI controls in light and dark modes', async ({
  page,
}, info) => {
  const c = await instrumentation(page);
  await settings(page);
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  for (const preset of ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech']) {
    await page.getByRole('tab', { name: '外观与主题', exact: true }).click();
    await page.getByTestId(`theme-${preset}`).click();
    await page.getByRole('tab', { name: 'AI解释（可选）', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance-preference', preset);
    for (const mode of ['light', 'dark']) {
      const current = await page.locator('html').getAttribute('data-theme');
      if (current !== mode) await page.getByTestId('theme-mode-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expect(page.getByLabel('你自己的API Key', { exact: true })).toBeVisible();
      await expect(page.getByLabel('你自己的API Key', { exact: true })).toHaveAttribute(
        'type',
        'password',
      );
      await expect(page.getByRole('switch')).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`ai-${preset}-${mode}.png`), fullPage: true });
    }
  }
  expect(c.verifies).toBe(0);
  expect(c.requests).toHaveLength(0);
  await evidence(page, c, info);
});
