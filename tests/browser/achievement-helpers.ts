import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { openAnswer, submit, observeCaseSetExecution } from './notebook-helpers';
import { memoryBugQuestions } from '../../web/src/memory-bugs/content';
import type { Achievement } from '../../web/src/achievements/model';
import { native as priorNative, sameLearning, clear } from './scheduler-helpers';
export { openAnswer, submit, observeCaseSetExecution, sameLearning, clear };
export const folder = `.artifacts/15.4/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
export const status = (p: Page) => p.getByTestId('achievement-save-status');
export async function native(p: Page) {
  return (await priorNative(p)) as Awaited<ReturnType<typeof priorNative>> & {
    achievements: Achievement[];
  };
}
export async function achievementReady(p: Page) {
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(p.locator('.app-shell')).toHaveAttribute('data-achievement-storage-status', 'ready');
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
}
export async function badges(p: Page) {
  await p.goto('/#/achievements');
  await expect(p.getByRole('heading', { level: 1, name: '学习成就', exact: true })).toBeVisible();
  await achievementReady(p);
}
export async function watch(p: Page, id: 'functions' | 'hanoi', confirm = true) {
  await p.goto(`/#/memory?example=${id}&view=stack`);
  await achievementReady(p);
  if (id === 'hanoi')
    await p.getByRole('spinbutton', { name: '汉诺塔盘数', exact: true }).fill('2');
  await p.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(p.getByTestId('memory-workspace')).toHaveAttribute('data-state', 'ready');
  await p.getByRole('combobox', { name: '内存播放速度', exact: true }).selectOption('4');
  await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('0');
  await p.locator('.stack-current').scrollIntoViewIfNeeded();
  await expect(p.getByTestId('observation-confirm')).toHaveAttribute('data-seen', '1');
  await p
    .locator('section.memory-stage')
    .evaluate((e) => (e as HTMLElement).focus({ preventScroll: true }));
  await p.keyboard.press('Space');
  await expect(p.getByTestId('observation-confirm')).toHaveAttribute('data-complete', 'true', {
    timeout: 90000,
  });
  if (confirm) {
    await p.getByRole('button', { name: '确认本次递归观察', exact: true }).click();
    await achievementReady(p);
  }
}
export async function pointerPass(p: Page, index = 0) {
  const q = memoryBugQuestions[index];
  await p.goto(`/#/bugs/memory/${q.exerciseRef.id}`);
  const editor = p.getByRole('textbox', { name: '编辑关卡 C++ 代码', exact: true });
  await expect(editor).toBeEditable();
  await achievementReady(p);
  await editor.fill(q.solutionSource);
  await p.getByRole('button', { name: '提交全部4组', exact: true }).click();
  await expect(p.getByTestId('memory-bug-session')).toHaveAttribute('data-state', 'passed');
  await expect(p.getByTestId('memory-bug-session')).toHaveAttribute('data-save-state', 'saved');
}
export async function capture(p: Page, name: string) {
  await mkdir(folder, { recursive: true });
  const workers = await p.evaluate(
    () =>
      window.__verticalObservation?.workers
        .filter((w) => w.moduleSeen && w.responseOk)
        .map((w) => ({
          moduleSeen: w.moduleSeen,
          operationId: w.operationId,
          ...(w as unknown as { captureEncoded: () => Record<string, unknown> }).captureEncoded(),
        })) ?? [],
  );
  await writeFile(
    `${folder}/${name}.json.gz`,
    gzipSync(JSON.stringify({ workers, rows: await native(p) })),
    { flag: 'wx' },
  );
}
export async function quota(p: Page) {
  await p.addInitScript(() => {
    const control = { armed: false, attempts: [] as string[] };
    Object.assign(window, { __achievementQuota: control });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'achievements') {
        control.attempts.push(JSON.stringify(value));
        if (control.armed)
          throw new DOMException('15.4 native achievement quota', 'QuotaExceededError');
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
}
export async function arm(p: Page, on = true) {
  await p.evaluate((on) => {
    (window as unknown as { __achievementQuota: { armed: boolean } }).__achievementQuota.armed = on;
  }, on);
}
