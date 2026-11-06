import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { expect, type Page, type Route } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { C6_RESET_CLEAR_STORES, C6_RESET_STORES } from '../../web/src/storage/c6-reset';
import { completeCurrentFirstGroup } from './current-course-helpers';
import { installC6Packets } from './c6-observation';
import {
  assertCurrentJudge,
  assertLearningEqual,
  currentLocalReady,
  currentSnapshot,
} from './current-practice-observation';

/** Serve existing archived bytes only. No archive is built or modified. */
export async function archivedMigrationSuccessor(page: Page, directory: string) {
  const root = resolve(directory),
    origin = new URL(page.url()).origin;
  const files: { path: string; sha256: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else
        files.push({
          path: relative(root, p).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
        });
    }
  };
  walk(root);
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.continue();
    const path = resolve(
      root,
      '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
    );
    const expected = files.find((f) => resolve(root, f.path) === path);
    if (!path.startsWith(root + sep) || !expected) return route.abort();
    const bytes = readFileSync(path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected.sha256);
    return route.fulfill({
      body: bytes,
      contentType: mime[extname(path)] ?? 'application/octet-stream',
    });
  };
  await page.route('**/*', handler);
  return {
    directory,
    files,
    async dispose() {
      await page.unroute('**/*', handler);
    },
  };
}

export async function verifyCurrentResetAfterMigration(page: Page, before: StorageSnapshot) {
  await page.addInitScript(installC6Packets);
  await page.goto('/?migration=final73#/courses');
  await expect(page.locator('.c6-node-list > li')).toHaveCount(19);
  await currentLocalReady(page);
  await expect.poll(async () => (await currentSnapshot(page)).settings.goalTemplate).not.toBeNull();
  const reset = await currentSnapshot(page);
  const addedStores = ['pythonActivities', 'pythonDrafts', 'javaActivities', 'javaDrafts'];
  expect(Object.keys(reset).sort()).toEqual([...C6_RESET_STORES, ...addedStores].sort());
  expect(reset.meta).toMatchObject({
    dbVersion: 12,
    schemaVersion: '12.0.0',
    activePackageRef: { id: 'content.c.primer6', version: '2.0.0' },
    activeCatalogSetRef: { id: 'catalog-set.c-python-java', version: '1.0.0' },
  });
  expect(reset.meta.generation).not.toBe(before.meta.generation);
  const nativeRows = reset as unknown as Record<string, unknown>;
  for (const key of [...C6_RESET_CLEAR_STORES, ...addedStores])
    expect(nativeRows[key], key).toEqual([]);
  const { goalTemplate: oldGoal, ...oldPreferences } = before.settings;
  const { goalTemplate: newGoal, ...newPreferences } = reset.settings;
  void oldGoal;
  expect(newPreferences).toEqual(oldPreferences);
  expect(newGoal?.targets).toEqual({ exercise: 1, lesson: 1, case: 0 });
  expect(newGoal?.revision).toBe(1);
  expect(reset.avatar).toEqual(before.avatar);
  expect(reset.appearance).toEqual(before.appearance);
  expect(reset.appearanceAssets).toEqual(before.appearanceAssets);
  const subject = await completeCurrentFirstGroup(page);
  await assertCurrentJudge(page, subject, 'passed');
  const earned = await currentSnapshot(page);
  expect(earned.meta.generation).toBe(reset.meta.generation);
  expect(earned.ledger.every((r) => r.status === 'posted' && typeof r.points === 'number')).toBe(
    true,
  );
  expect(earned.ledger.reduce((sum, r) => sum + (r.points ?? 0), 0)).toBe(35);
  expect(earned.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
  expect(earned.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(2);
  await page.reload();
  await currentLocalReady(page);
  const refreshed = await currentSnapshot(page);
  assertLearningEqual(earned, refreshed);
  expect(refreshed.courseActivities).toEqual(earned.courseActivities);
  return { reset, earned, refreshed };
}
