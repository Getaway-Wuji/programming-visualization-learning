import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __casePreparationCancel: {
      startedAt: number | null;
      settledAt: number | null;
      trusted: boolean;
      state: string | null;
    };
  }
}

test('a native cancel click aborts the first cold execution and a fresh run recovers', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const audit: Window['__casePreparationCancel'] = (window.__casePreparationCancel = {
      startedAt: null,
      settledAt: null,
      trusted: false,
      state: null,
    });
    document.addEventListener(
      'click',
      (event) => {
        if (
          !(event.target instanceof Element) ||
          event.target.closest('button')?.textContent?.trim() !== '取消运行'
        )
          return;
        audit.startedAt = performance.now();
        audit.trusted = event.isTrusted;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            audit.settledAt = performance.now();
            audit.state =
              document
                .querySelector('[data-testid="case-execution"]')
                ?.getAttribute('data-state') ?? null;
          }),
        );
      },
      true,
    );
  });
  let requested!: () => void;
  const arrived = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const pattern = /\/assets\/c_viz_wasm_bg-[^/]+\.wasm$/;
  await page.route(pattern, async (route) => {
    requested();
    await gate;
    try {
      await route.continue();
    } catch {
      /* A real abort may have already cancelled it. */
    } finally {
      finished();
    }
  });
  await page.goto('/#/visualize/case.c.assignment');
  const panel = page.getByTestId('case-execution');
  const run = panel.getByRole('button', { name: '运行示例', exact: true });
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await run.click();
  await arrived;
  try {
    await expect(panel).toHaveAttribute('data-state', 'running');
    await panel.getByRole('button', { name: '取消运行', exact: true }).click();
    await expect(panel).toHaveAttribute('data-state', 'cancelled');
    await expect(run).toBeEnabled();
    await expect(panel.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
    await expect
      .poll(() => page.evaluate(() => window.__casePreparationCancel.settledAt))
      .not.toBeNull();
    const audit = await page.evaluate(() => window.__casePreparationCancel);
    const output = join(
      '.artifacts/11.4',
      process.env.TASK_EVIDENCE_LABEL ?? 'case-preparation-cancel',
      info.project.name,
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, 'metadata.json'),
      JSON.stringify(
        {
          kind: 'native-production-first-cold-execute-cancel',
          browserVersion: page.context().browser()?.version(),
          audit,
          elapsedMs: audit.settledAt! - audit.startedAt!,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    expect(audit.trusted).toBe(true);
    expect(audit.state).toBe('cancelled');
    expect(audit.settledAt! - audit.startedAt!).toBeLessThanOrEqual(100);
  } finally {
    release();
  }
  await done;
  await page.unroute(pattern);
  await expect(panel).toHaveAttribute('data-state', 'cancelled');
  await run.click();
  await expect(panel).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('execution-output')).toHaveText('5\n');
});
