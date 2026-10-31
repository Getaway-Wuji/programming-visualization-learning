import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { native, clear } from './achievement-helpers';
import { observeCaseSetExecution } from './case-set-observation';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { PlayerModel } from '../../web/src/player/model';

const folder = `.artifacts/16.2/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const group = (p: Page) => p.getByTestId('comparison-page');
const lane = (p: Page, i: number) => p.getByTestId(`comparison-lane-${i}`);
test.use({ timezoneId: 'Asia/Shanghai' });
test.beforeAll(() => mkdir(folder, { recursive: true }));
async function ready(p: Page) {
  await p.bringToFront();
  await p.goto('/#/compare');
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  await expect(p.getByTestId('input-field-values')).toBeVisible();
}
async function prepare(p: Page, values?: string) {
  if (values !== undefined) await p.getByTestId('input-field-values').fill(values);
  await p.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'ready');
}
async function run(p: Page, values?: string) {
  await prepare(p, values);
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'settled');
}
async function captured(p: Page, name: string) {
  const workers = await p.evaluate(() =>
    window.__verticalObservation.workers
      .filter((w) => w.kind === 'execute')
      .map((w) => ({
        kind: w.kind,
        moduleSeen: w.moduleSeen,
        responseOk: w.responseOk,
        ...(
          w as unknown as {
            captureEncoded: () => { requestBase64: string | null; responseBase64: string | null };
          }
        ).captureEncoded(),
      })),
  );
  await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(workers)), { flag: 'wx' });
  return Promise.all(
    workers
      .filter((w) => w.responseBase64 && w.requestBase64)
      .map(async (w) => {
        const request = JSON.parse(
          Buffer.from(w.requestBase64!, 'base64').toString(),
        ) as ExecuteRequest;
        const result = await decodeResult(
          Uint8Array.from(Buffer.from(w.responseBase64!, 'base64')).buffer,
          request,
        );
        return { request, result, moduleSeen: w.moduleSeen };
      }),
  );
}
async function count(p: Page) {
  return p.evaluate(
    () => window.__verticalObservation.workers.filter((w) => w.kind === 'execute').length,
  );
}
async function sameMetrics(p: Page, real: Awaited<ReturnType<typeof captured>>, cursor: number) {
  for (let i = 0; i < real.length; i++) {
    const model = new PlayerModel(),
      result = real[i].result;
    expect(model.acceptValidated(model.begin(result.identity), result)).toBe(true);
    model.seek(Math.min(cursor, result.trace!.steps.length));
    for (const [key, value] of Object.entries(model.snapshot().state!.counters))
      await expect(p.getByTestId(`metric-${i}-${key}`)).toHaveText(String(value));
    await expect(lane(p, i)).toHaveAttribute(
      'data-cursor',
      String(Math.min(cursor, result.trace!.steps.length)),
    );
  }
}

test('two independent real C programs receive identical data; controls and full-state counters restore without storage facts', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  const before = await native(p);
  await run(p);
  const real = await captured(p, 'default-pair');
  expect(real).toHaveLength(2);
  expect(real.map((r) => r.result.programRef!.id)).toEqual([
    'program.c.bubble-sort',
    'program.c.selection-sort',
  ]);
  expect(
    real.every(
      (r) =>
        r.moduleSeen && r.result.producer === 'rust' && r.result.terminal.status === 'completed',
    ),
  ).toBe(true);
  expect(real[0].request.input).toEqual(real[1].request.input);
  expect(real[0].request.identity.runId).not.toBe(real[1].request.identity.runId);
  expect(real[0].request.identity.contextId).not.toBe(real[1].request.identity.contextId);
  for (let i = 0; i < 2; i++) {
    await lane(p, i).locator('.comparison-source > summary').click();
    await expect(lane(p, i).getByRole('textbox', { name: '当前执行的 C 代码' })).toHaveValue(
      real[i].request.source.text,
    );
    await expect(lane(p, i).getByTestId('lane-input')).toContainText('[7,-3,0,5,-3,2,9]');
  }
  const lengths = real.map((r) => r.result.trace!.steps.length),
    max = Math.max(...lengths),
    min = Math.min(...lengths);
  for (const k of [0, 15, min, min + 1, max, min - 1, 15, 0]) {
    await p.getByRole('slider', { name: '对比步骤', exact: true }).fill(String(k));
    await sameMetrics(p, real, k);
  }
  await p.getByRole('button', { name: '前进一拍', exact: true }).click();
  await sameMetrics(p, real, 1);
  await p.getByRole('button', { name: '后退一拍', exact: true }).click();
  await sameMetrics(p, real, 0);
  await p.getByRole('combobox', { name: '对比回放速度' }).selectOption('4');
  await p.getByRole('button', { name: '播放对比', exact: true }).click();
  await expect
    .poll(async () => Number(await lane(p, 0).getAttribute('data-cursor')))
    .toBeGreaterThan(1);
  await p.getByRole('button', { name: '暂停对比', exact: true }).click();
  const cursor = await p.getByTestId('comparison-cursor').textContent();
  await p.waitForTimeout(250);
  await expect(p.getByTestId('comparison-cursor')).toHaveText(cursor!);
  await p.getByRole('button', { name: '到末尾', exact: true }).click();
  await sameMetrics(p, real, max);
  for (let i = 0; i < 2; i++)
    await expect(lane(p, i).getByTestId('step-output')).toContainText('-3 -3 0 2 5 7 9');
  await p.getByRole('combobox', { name: '对比回放速度' }).selectOption('0.25');
  await sameMetrics(p, real, max);
  expect(await count(p)).toBe(2);
  expect(await native(p)).toEqual(before);
});

for (const [name, values, output] of [
  ['empty', '[]', '\n'],
  ['single', '0', '0\n'],
  ['equal', '2,2,2', '2 2 2\n'],
  ['sorted', '-3,0,4', '-3 0 4\n'],
  ['reverse', '4,0,-3', '-3 0 4\n'],
  ['limits', '-999,999,0', '-999 0 999\n'],
] as const)
  test(`real boundary pair: ${name}`, async ({ page: p }) => {
    await observeCaseSetExecution(p);
    await ready(p);
    await run(p, values);
    const real = await captured(p, name);
    expect(real).toHaveLength(2);
    for (const r of real) {
      expect(r.result.terminal.status).toBe('completed');
      const m = new PlayerModel();
      m.acceptValidated(m.begin(r.result.identity), r.result);
      m.seek(r.result.trace!.steps.length);
      expect(m.snapshot().state!.output).toBe(output);
    }
    await p.getByRole('button', { name: '到末尾', exact: true }).click();
    await sameMetrics(p, real, Math.max(...real.map((r) => r.result.trace!.steps.length)));
  });

test('input limits reject before execution; maximum 30 values remain under original budgets or show the actual limit', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  for (const values of ['', '1000', '1.5', '1,,2', Array(31).fill('0').join(',')]) {
    await p.getByTestId('input-field-values').fill(values);
    await expect(p.getByRole('button', { name: '应用输入并准备', exact: true })).toBeDisabled();
  }
  expect(await count(p)).toBe(0);
  await run(p, Array.from({ length: 30 }, (_, i) => 30 - i).join(','));
  const real = await captured(p, 'max30');
  expect(real.length).toBeGreaterThan(0);
  for (const r of real) {
    expect(r.request.remainingMs).toBeLessThanOrEqual(1000);
    expect(r.result.trace?.steps.length ?? 0).toBeLessThanOrEqual(20000);
  }
  await writeFile(
    `${folder}/max30-outcomes.json`,
    JSON.stringify(
      {
        captured: real.map((r) => ({
          program: r.request.programRef,
          terminal: r.result.terminal,
          steps: r.result.trace?.steps.length,
        })),
        ui: await p.getByTestId('comparison-status').textContent(),
        lanes: await p.getByTestId('lane-status').allTextContents(),
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
});

test('algorithm swap, text, seed, length, generation and reset immediately invalidate; same seed is reproducible', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, '3,1,2');
  await p.getByRole('button', { name: '互换左右算法' }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
  await expect(lane(p, 0).getByRole('heading', { level: 2 })).toHaveText('选择排序');
  await run(p, '3,1,2');
  const real = await captured(p, 'swapped');
  expect(real.slice(-2).map((r) => r.request.programRef!.id)).toEqual([
    'program.c.selection-sort',
    'program.c.bubble-sort',
  ]);
  await p.locator('.comparison-input-settings > summary').click();
  await p.getByTestId('input-seed').fill('comparison-seed');
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
  await p.getByTestId('input-length-values').fill('5');
  await p.getByRole('button', { name: '按种子复现', exact: true }).click();
  const draft = await p.getByTestId('input-field-values').inputValue();
  await prepare(p);
  await p.locator('.comparison-input-settings > summary').click();
  await p.getByRole('button', { name: '按种子复现', exact: true }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
  await expect(p.getByTestId('input-field-values')).toHaveValue(draft);
  await p.getByRole('button', { name: '恢复示例输入', exact: true }).click();
  await expect(p.getByTestId('input-field-values')).toHaveValue('7, -3, 0, 5, -3, 2, 9');
  expect(await count(p)).toBe(4);
});

async function fault(p: Page, mode: 'fail-first' | 'hold-second') {
  await p.addInitScript((selected) => {
    const NativeWorker = window.Worker;
    let executions = 0;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        if ((message as { kind?: string })?.kind === 'execute') {
          executions++;
          if (selected === 'fail-first' && executions === 1) {
            queueMicrotask(() =>
              this.dispatchEvent(new ErrorEvent('error', { message: 'Controlled worker failure' })),
            );
            return;
          }
          if (selected === 'hold-second' && executions === 2) return;
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  }, mode);
}
test('one real Worker failure remains visible; other algorithm executes, then fresh run recovers', async ({
  page: p,
}) => {
  await fault(p, 'fail-first');
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, '2,1');
  await expect(lane(p, 0).getByTestId('diagnostic-item')).toHaveAttribute(
    'data-code',
    'E_WORKER_FAILURE',
  );
  await expect(lane(p, 1).getByTestId('lane-status')).toContainText('程序正常结束');
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'settled');
  await expect(p.getByTestId('diagnostic-item')).toHaveCount(0);
  await captured(p, 'worker-failure-recovery');
});
test('cancel during second run retains finalized first and never accepts the pending side; rerun recovers', async ({
  page: p,
}) => {
  await fault(p, 'hold-second');
  await observeCaseSetExecution(p);
  await ready(p);
  await prepare(p, '2,1');
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(lane(p, 0)).toHaveAttribute('data-phase', 'accepted');
  await expect(lane(p, 1)).toHaveAttribute('data-phase', 'running');
  await p.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'cancelled');
  await expect(lane(p, 0)).toHaveAttribute('data-phase', 'accepted');
  await expect(lane(p, 1)).toHaveAttribute('data-phase', 'cancelled');
  await p.waitForTimeout(1100);
  await expect(lane(p, 1)).toHaveAttribute('data-cursor', '');
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(group(p)).toHaveAttribute('data-phase', 'settled');
  await expect(lane(p, 1).getByTestId('lane-status')).toContainText('程序正常结束');
  await captured(p, 'cancel-recovery');
});
test('editing during pending execution cancels old group; navigation and reload do not retain comparison input or traces', async ({
  page: p,
}) => {
  await fault(p, 'hold-second');
  await observeCaseSetExecution(p);
  await ready(p);
  await prepare(p, '2,1');
  await p.getByRole('button', { name: '运行两种算法', exact: true }).click();
  await expect(lane(p, 1)).toHaveAttribute('data-phase', 'running');
  await p.locator('.comparison-input-settings > summary').click();
  await p.getByTestId('input-field-values').fill('5,4');
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
  await p.waitForTimeout(1100);
  await expect(lane(p, 0)).toHaveAttribute('data-length', '0');
  await expect(lane(p, 1)).toHaveAttribute('data-length', '0');
  await p.goto('/#/cases');
  await p.getByRole('link', { name: '打开同数据双算法对比' }).click();
  await expect(p.getByTestId('input-field-values')).toHaveValue('7, -3, 0, 5, -3, 2, 9');
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
  await p.reload();
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
});
test('clearing the real local archive invalidates comparison in another tab', async ({
  page: p,
  context,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, '2,1');
  const other = await context.newPage();
  await other.goto('/#/settings');
  await clear(other);
  await p.bringToFront();
  await expect(group(p)).toHaveAttribute('data-phase', 'idle');
  await expect(lane(p, 0)).toHaveAttribute('data-length', '0');
  await expect(lane(p, 1)).toHaveAttribute('data-length', '0');
  expect((await native(p)).ledger).toHaveLength(0);
  await other.close();
});
test('minimal representative three widths show both lanes without document overflow', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p);
  await run(p, '3,1,2');
  for (let index = 0; index < 2; index++)
    await lane(p, index).locator('.comparison-source > summary').click();
  for (const width of [1440, 768, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    await expect(lane(p, 0)).toBeVisible();
    await expect(lane(p, 1)).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390)
      for (let index = 0; index < 2; index++) {
        expect(
          await lane(p, index)
            .locator('.source-copyarea')
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
    await p.screenshot({ path: `${folder}/comparison-${width}.png`, fullPage: true });
  }
  await p.getByTestId('theme-mode-toggle').click();
  const contrast = await lane(p, 0).evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color),
      background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await p.screenshot({ path: `${folder}/comparison-390-dark.png`, fullPage: true });
});
