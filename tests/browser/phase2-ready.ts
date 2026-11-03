import { expect, type Page } from '@playwright/test';
import { native } from './achievement-helpers';

/** Observe actual archive readiness; candidates never gain learning authority. */
export async function waitForPhase2Archive(page: Page) {
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(shell).toHaveAttribute('data-learning-reading-status', 'ready');
  await expect(shell).toHaveAttribute('data-learning-practice-status', 'ready');
  await expect
    .poll(async () => (await native(page)).meta)
    .toMatchObject({
      dbVersion: 10,
      schemaVersion: '10.0.0',
      activePackageRef: { id: 'content.c.primer6', version: '2.0.0' },
      activeCatalogSetRef: { id: 'catalog-set.c.primer6', version: '2.0.0' },
    });
  await expect.poll(async () => (await native(page)).settings.goalTemplate).not.toBeNull();
}
