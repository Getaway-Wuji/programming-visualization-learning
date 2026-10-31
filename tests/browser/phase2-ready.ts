import { expect, type Page } from '@playwright/test';
import { native } from './achievement-helpers';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

/** Observe actual archive readiness; candidates never gain learning authority. */
export async function waitForPhase2Archive(page: Page) {
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute(
    'data-learning-storage-status',
    p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  );
  await expect(shell).toHaveAttribute('data-learning-reading-status', 'ready');
  await expect(shell).toHaveAttribute(
    'data-learning-practice-status',
    p05CourseRelease.registered ? 'ready' : 'failed',
  );
  await expect
    .poll(async () => (await native(page)).meta.activePackageRef.id)
    .toBe(p05CourseRelease.registered ? 'content.c.p05' : 'content.c.p0');
  if (p05CourseRelease.registered)
    await expect.poll(async () => (await native(page)).settings.goalTemplate).not.toBeNull();
}
