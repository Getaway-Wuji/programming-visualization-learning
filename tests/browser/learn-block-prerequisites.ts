import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import { generateBlockSource } from '../../web/src/blocks/generator';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import type { PreparedSource } from '../../web/src/engine/execution-client';

/** Advanced historical editor probes now require actual completed lessons. Use
 * a peer page so their measured execution/analysis counts still describe only
 * the probed interaction. No storage rows, permissions or results are injected. */
export async function learnBlockPrerequisites(page: Page) {
  initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
  const peer = await page.context().newPage();
  const content = JSON.parse(
    readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
  ) as CoursePractice;
  const ready = () =>
    expect(peer.getByTestId('learning-save-status')).toHaveAttribute('data-save-status', 'ready');
  try {
    for (const id of [
      'exercise.c.two-x-plus-three',
      'exercise.c.two-loop-sums',
      'exercise.c.increment-at-index',
    ]) {
      const catalog = exerciseCatalog(content, id);
      await peer.goto(`/#/lessons/${catalog.subject.lessonRef.id}`);
      await expect(peer.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
      await ready();
      const start = peer.getByRole('button', { name: '开始本节学习', exact: true });
      if (await start.isEnabled()) {
        await start.click();
        await ready();
      }
      await peer.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
      await ready();
      await peer.goto(`/#/practice/${id}`);
      await expect(peer.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
      await ready();
      await peer.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
      const code = peer.getByRole('textbox', { name: '编辑 C 代码', exact: true });
      await expect(code).toBeEditable();
      const input = Object.fromEntries(
        Object.entries(catalog.subject.tests[0].input).sort(([a], [b]) => a.localeCompare(b)),
      );
      const base = JSON.parse(
        new TextDecoder().decode(
          prepare_input(
            JSON.stringify(catalog),
            new TextEncoder().encode(JSON.stringify(input)),
            1000,
          ),
        ),
      ).source as PreparedSource;
      const source = generateBlockSource(
        correctBlockProgram(id, catalog.program.bindings),
        base,
        catalog.program.bindings,
      );
      await code.fill(source.text);
      await expect(peer.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
      await peer.getByRole('button', { name: '提交练习', exact: true }).click();
      await expect(peer.getByTestId('practice-pass-save')).toHaveAttribute(
        'data-save-state',
        'saved',
      );
      await ready();
    }
    await expect(peer.getByTestId('block-permissions').locator('summary')).toContainText(
      '已永久解锁 20 / 20',
    );
  } finally {
    await peer.close();
    await page.bringToFront();
  }
}
