import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { ContentPackage } from '../../web/src/content/types';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

const course = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const solutions = JSON.parse(
  readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
) as { solutions: { exerciseRef: { id: string }; source: string }[] };
const folder = `.artifacts/15.2/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const panel = (page: Page) => page.getByTestId('practice-execution');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
// Historical migration hosts retain the old banner; the current app exposes
// storage readiness on its shell and shows a banner only for unresolved saves.
const ready = (page: Page) =>
  expect
    .poll(async () => {
      const shell = page.locator('.app-shell');
      return (
        (await shell.getAttribute('data-learning-storage-status')) ??
        (await page.getByTestId('learning-save-status').getAttribute('data-save-status'))
      );
    })
    .toMatch(p05CourseRelease.registered ? /^ready$/ : /^(ready|unsaved)$/);
async function archive(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('c-viz-learning');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const entries = await Promise.all(
        names.map(async (name) => [
          name,
          await new Promise<unknown>((resolve, reject) => {
            const store = tx.objectStore(name);
            const req = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }),
        ]),
      );
      await done;
      return Object.fromEntries(entries) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
async function confirm(page: Page, id: string) {
  await page.goto(`/#/lessons/${id}`);
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const start = page.getByRole('button', { name: '开始本节学习', exact: true });
  if (await start.isEnabled()) {
    await start.click();
    await ready(page);
  }
  await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  await ready(page);
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
}
async function openAnswer(page: Page, exerciseId: string) {
  const subject = course.exercises.find((item) => item.id === exerciseId)!;
  const program = course.programs.find((item) => item.id === subject.programRef.id)!;
  const input = Object.fromEntries(
    Object.entries(subject.tests[0].input).sort(([a], [b]) => a.localeCompare(b)),
  );
  const source = JSON.parse(
    new TextDecoder().decode(
      prepare_input(
        JSON.stringify({
          packageRef: { id: course.packageId, version: course.packageVersion },
          subject,
          program: {
            ...program,
            sourceExample: solutions.solutions.find((item) => item.exerciseRef.id === exerciseId)!
              .source,
          },
          inputSpec: course.inputSpecs.find((item) => item.id === program.inputRef.id)!,
          judgeProfile: course.judgeProfiles.find((item) => item.id === subject.judgeRef.id)!,
        }),
        new TextEncoder().encode(JSON.stringify(input)),
        1000,
      ),
    ),
  ) as { source: { text: string } };
  await page.goto(`/#/practice/${exerciseId}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await ready(page);
  await expect.poll(async () => (await archive(page)).settings.goalTemplate).not.toBeNull();
  // The normal auto preference can reveal code between checking and clicking
  // its expander. Select the public code-only view before editing instead.
  await page
    .getByTestId('block-workspace-preference')
    .getByRole('combobox', { name: '积木显示', exact: true })
    .selectOption('hide');
  const preference = page.getByTestId('block-workspace-preference');
  const preferenceStatus = page.getByTestId('block-preference-save-status');
  await expect(preferenceStatus).toHaveAttribute('data-save-state', /^(saved|temporary)$/);
  if ((await preferenceStatus.getAttribute('data-save-state')) === 'temporary') {
    await expect(preferenceStatus).toContainText('其他页面已更新档案');
    test.info().annotations.push({
      type: 'setup-recovery',
      description:
        'Display preference CAS conflicted with source reconciliation; explicitly re-read and save once through the public control.',
    });
    await preference.getByRole('button', { name: '重新读取并保存选择', exact: true }).click();
    await expect(preferenceStatus).toHaveAttribute('data-save-state', 'saved');
  }
  await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
    'data-blocks-visible',
    'no',
  );
  await expect(code(page)).toBeEditable();
  await code(page).fill(source.source.text);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
}
async function submit(page: Page, saved = true) {
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
    'data-save-state',
    saved ? 'saved' : 'unsaved',
  );
  if (saved) await ready(page);
}
async function capture(page: Page, name: string) {
  const actual = await observedCaseSetExecute(page);
  expect(actual.moduleSeen).toBe(true);
  expect(actual.responseOk).toBe(true);
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(actual)), { flag: 'wx' });
}

test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

export {
  archive,
  ready,
  confirm,
  openAnswer,
  submit,
  capture,
  panel,
  code,
  folder,
  observeCaseSetExecution,
};
