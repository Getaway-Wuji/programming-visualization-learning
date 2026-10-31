import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/#/custom-code');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
}
async function edit(page: Page, source: string) {
  await page.getByRole('button', { name: '编辑代码', exact: true }).click();
  await page.getByRole('textbox', { name: 'C 代码', exact: true }).fill(source);
}
async function execute(page: Page) {
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute(
    'data-status',
    /ready|rejected|failed/,
  );
}
async function end(page: Page) {
  const slider = page.getByRole('slider', { name: '执行步骤', exact: true });
  await slider.fill((await slider.getAttribute('max'))!);
}
async function recover(page: Page) {
  await edit(page, '#include <stdio.h>\nint main(){printf("next learning");return 0;}');
  await execute(page);
  await expect(page.getByTestId('custom-run-status')).toHaveText('执行完成');
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText('next learning');
}
const cases = [
  [
    'parentheses',
    'int main(){return ' + '('.repeat(70) + '1' + ')'.repeat(70) + ';}',
    'E_DEPTH_LIMIT',
  ],
  ['unary AST', 'int main(){return ' + '!'.repeat(70) + '1;}', 'E_DEPTH_LIMIT'],
  [
    'nested blocks',
    'int main(){' + '{'.repeat(70) + 'return 0;' + '}'.repeat(70) + '}',
    'E_DEPTH_LIMIT',
  ],
  ['infinite loop', 'int main(){while(1){}}', 'E_STEP_LIMIT|E_FUEL_LIMIT|E_DEADLINE'],
  ['deep recursion', 'int f(int n){return f(n+1);}int main(){return f(0);}', 'E_STACK_LIMIT'],
  [
    'combined depth',
    'int f(int n){' +
      '{'.repeat(27) +
      'return f(n+1);' +
      '}'.repeat(27) +
      '}int main(){return f(0);}',
    'E_DEPTH_LIMIT',
  ],
  ['null pointer', 'int main(){int* p=0;return *p;}', 'E_NULL_POINTER'],
  ['uninitialized pointer', 'int main(){int* p;return *p;}', 'E_UNINITIALIZED'],
  ['ended object', 'int main(){int* p=0;{int n=7;p=&n;}return *p;}', 'E_DANGLING_POINTER'],
  ['one past dereference', 'int main(){int a[2]={3,7};int* p=a+2;return *p;}', 'E_POINTER_BOUNDS'],
  ['outside provenance', 'int main(){int a[2];int* p=a+3;return 0;}', 'E_POINTER_BOUNDS'],
  ['array bounds', 'int main(){int a[2];return a[2];}', 'E_POINTER_BOUNDS'],
  [
    'input exhausted',
    '#include <stdio.h>\nint main(){int a;int b;scanf("%d",&a);scanf("%d",&b);return 0;}',
    'E_INPUT_EXHAUSTED',
  ],
] as const;
for (const [label, source, code] of cases) {
  test(`real workbench rejects ${label}, preserves a reversible prefix and recovers`, async ({
    page,
  }, info) => {
    await ready(page);
    await edit(page, source);
    const start = Date.now();
    await execute(page);
    const elapsedMs = Date.now() - start;
    await expect(page.getByTestId('custom-code-page')).toContainText(new RegExp(code));
    expect(elapsedMs).toBeLessThan(2500);
    const slider = page.getByRole('slider', { name: '执行步骤', exact: true });
    let steps = 0;
    if (await slider.isEnabled()) {
      steps = Number(await slider.getAttribute('max'));
      await end(page);
      await slider.fill('0');
      await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-cursor', '0');
      await end(page);
      await expect(page.getByTestId('custom-code-page')).toHaveAttribute(
        'data-cursor',
        String(steps),
      );
    }
    const actual = (await page.getByTestId('custom-code-page').innerText()).match(/E_[A-Z_]+/)?.[0];
    await info.attach('real-terminal', {
      body: JSON.stringify({ label, actual, steps, elapsedMs }),
      contentType: 'application/json',
    });
    await recover(page);
  });
}
test('actual output quota admits 16 KiB, refuses the next byte atomically and recovers', async ({
  page,
}) => {
  await ready(page);
  const output = 'q'.repeat(16384);
  const source = '#include <stdio.h>\nint main(){printf("' + output + '");';
  await edit(page, source + 'return 0;}');
  await execute(page);
  await expect(page.getByTestId('custom-run-status')).toHaveText('执行完成');
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText(output);
  await edit(page, source + 'printf("x");return 0;}');
  await execute(page);
  await expect(page.getByTestId('custom-diagnostic')).toContainText('E_OUTPUT_LIMIT');
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText(output);
  await page.getByRole('slider', { name: '执行步骤' }).fill('0');
  await expect(page.getByTestId('custom-output')).toHaveText('（尚无输出）');
  await recover(page);
});
test('UTF-8 source quota keeps exact 32 KiB and retains oversized original text', async ({
  page,
}) => {
  await ready(page);
  const tail = '\nint main(){return 0;}';
  const n = Math.floor((32768 - 2 - tail.length) / 3);
  const source = '//' + '字'.repeat(n) + ' '.repeat(32768 - 2 - tail.length - n * 3) + tail;
  expect(new TextEncoder().encode(source).length).toBe(32768);
  await edit(page, source);
  await execute(page);
  await expect(page.getByTestId('custom-run-status')).toHaveText('执行完成');
  await edit(page, source + 'x');
  await expect(page.getByRole('button', { name: '运行代码', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'C 代码', exact: true })).toHaveValue(
    source + 'x',
  );
  await recover(page);
});

test('real WASM admits one MiB of virtual C array storage and refuses the next int', async ({
  page,
}) => {
  await ready(page);
  await edit(page, 'int main(){int a[262144];return 0;}');
  await execute(page);
  await expect(page.getByTestId('custom-run-status')).toHaveText('执行完成');
  await edit(page, 'int main(){int a[262145];return 0;}');
  await execute(page);
  await expect(page.getByTestId('custom-diagnostic')).toContainText('E_MEMORY_LIMIT');
  await recover(page);
});
type WorkerQA = {
  mode: 'pass' | 'hold' | 'silence' | 'error' | 'corrupt';
  active: number;
  max: number;
  created: number;
  terminated: number;
  held: (() => void)[];
  pages: number[];
  posted: number;
  responses: number;
};
declare global {
  interface Window {
    customWorkerQA: WorkerQA;
  }
}
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const Native = window.Worker;
    const descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage')!;
    const qa: WorkerQA = {
      mode: 'pass',
      active: 0,
      max: 0,
      created: 0,
      terminated: 0,
      held: [],
      pages: [],
      posted: 0,
      responses: 0,
    };
    window.customWorkerQA = qa;
    window.Worker = class extends Native {
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        qa.created++;
        qa.active++;
        qa.max = Math.max(qa.max, qa.active);
        Object.defineProperty(this, 'onmessage', {
          get: () => descriptor.get!.call(this),
          set: (cb: ((e: MessageEvent) => void) | null) =>
            descriptor.set!.call(
              this,
              cb &&
                ((e: MessageEvent) => {
                  qa.responses++;
                  if (e.data?.ok) qa.pages.push(e.data.wasmPages);
                  const mode = qa.mode;
                  if (mode === 'hold') {
                    qa.held.push(() => cb(e));
                    return;
                  }
                  if (mode === 'silence') return;
                  qa.mode = 'pass';
                  if (mode === 'error') {
                    this.dispatchEvent(
                      new ErrorEvent('error', {
                        cancelable: true,
                        message: 'QA injected worker fault',
                      }),
                    );
                    return;
                  }
                  if (mode === 'corrupt') {
                    cb(
                      new MessageEvent('message', {
                        data: { ...e.data, operationId: 'stale-identity' },
                      }),
                    );
                    return;
                  }
                  cb(e);
                }),
            ),
        });
      }
      terminate() {
        if (!this.ended) {
          this.ended = true;
          qa.active--;
          qa.terminated++;
        }
        super.terminate();
      }
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
        qa.posted++;
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
}
test('cancel terminates an outstanding real infinite-loop Worker before any response and the next run succeeds', async ({
  page,
}, info) => {
  await instrument(page);
  await ready(page);
  await edit(page, 'int main(){while(1){}}');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await page.waitForFunction(() => window.customWorkerQA.posted === 1);
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(page.getByTestId('custom-run-status')).toContainText('E_CANCELLED');
  const stats = await page.evaluate(() => ({
    active: window.customWorkerQA.active,
    posted: window.customWorkerQA.posted,
    responses: window.customWorkerQA.responses,
    terminated: window.customWorkerQA.terminated,
  }));
  expect(stats).toEqual({ active: 0, posted: 1, responses: 0, terminated: 1 });
  await info.attach('outstanding-native-worker-cancel', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
  await recover(page);
});
test('twelve real queued runs are invalidated, stale duplicate responses never replace the final run', async ({
  page,
}, info) => {
  await instrument(page);
  await ready(page);
  await page.evaluate(() => {
    window.customWorkerQA.mode = 'hold';
  });
  for (let i = 0; i < 12; i++) {
    await edit(page, `int main(){return ${i};}`);
    await page.getByRole('button', { name: '运行代码', exact: true }).click();
    await page.waitForFunction((n) => window.customWorkerQA.held.length === n, i + 1);
  }
  await page.getByRole('button', { name: '取消运行', exact: true }).click();
  await expect(page.getByTestId('custom-run-status')).toContainText('E_CANCELLED');
  await page.evaluate(() => {
    window.customWorkerQA.mode = 'pass';
  });
  await recover(page);
  await page.evaluate(() => {
    for (const cb of window.customWorkerQA.held.toReversed()) {
      cb();
      cb();
    }
  });
  await expect(page.getByTestId('custom-output')).toHaveText('next learning');
  const stats = await page.evaluate(() => {
    const { held, ...stats } = window.customWorkerQA;
    return { ...stats, held: held.length };
  });
  expect(stats).toMatchObject({ active: 0, max: 1, created: 13, terminated: 13, held: 12 });
  expect(stats.pages.every((p) => p > 0 && p <= 2048)).toBe(true);
  await info.attach('real-worker-lifecycle', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
});
for (const [mode, code] of [
  ['silence', 'E_DEADLINE'],
  ['error', 'E_WORKER_FAILURE'],
  ['corrupt', 'E_PROTOCOL_INVALID'],
] as const) {
  test(`real Worker ${mode} fault releases resources and permits the next run`, async ({
    page,
  }, info) => {
    await instrument(page);
    await ready(page);
    await page.evaluate((mode) => {
      window.customWorkerQA.mode = mode;
    }, mode);
    const start = Date.now();
    await execute(page);
    await expect(page.getByTestId('custom-run-status')).toContainText(code);
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(2500);
    expect(await page.evaluate(() => window.customWorkerQA.active)).toBe(0);
    await page.evaluate(() => {
      window.customWorkerQA.mode = 'pass';
    });
    await recover(page);
    expect(await page.evaluate(() => window.customWorkerQA.active)).toBe(0);
    await info.attach('injected-fault', {
      body: JSON.stringify({ mode, code, elapsedMs }),
      contentType: 'application/json',
    });
  });
}
test('failed WASM download recovers without page reload', async ({ page }) => {
  let blocked = false;
  await page.route('**/*c_viz_advanced_bg*.wasm', (route) => {
    if (!blocked) {
      blocked = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await ready(page);
  await execute(page);
  expect(blocked).toBe(true);
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('custom-run-status')).toContainText('E_MODULE');
  await recover(page);
});
test('HTML remains literal text and code, input, output and trace never enter implicit durable storage or network logs', async ({
  page,
}, info) => {
  const marker = 'QA17_4_private_original_9c62';
  const payload = "<img src=x onerror='window.qaPwn=1'><script>window.qaPwn=2</script>";
  const logs: string[] = [],
    requests: string[] = [],
    dialogs: string[] = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('request', (r) => requests.push(r.url() + (r.postData() ?? '')));
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await ready(page);
  const durable = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('c-viz-learning');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const names = Array.from(db.objectStoreNames),
        data: Record<string, unknown[]> = {};
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(names, 'readonly');
        for (const name of names) {
          const r = tx.objectStore(name).getAll();
          r.onsuccess = () => {
            data[name] = r.result;
          };
        }
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      return {
        data,
        local: { ...localStorage },
        session: { ...sessionStorage },
        caches: await caches.keys(),
      };
    });
  const before = await durable();
  const source = `// ${marker}\n#include <stdio.h>\nint main(){int n;scanf("%d",&n);printf("${payload}");return 0;}`;
  await edit(page, source);
  await page.getByRole('textbox', { name: '整数输入' }).fill('723');
  await execute(page);
  await end(page);
  await expect(page.getByTestId('custom-output')).toHaveText(payload);
  await expect(page.getByTestId('custom-output').locator('img,script')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑代码', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'C 代码', exact: true })).toHaveValue(source);
  expect(
    await page.evaluate(() => (window as unknown as { qaPwn?: number }).qaPwn),
  ).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(await durable()).toEqual(before);
  expect([...logs, ...requests].some((s) => s.includes(marker) || s.includes(payload))).toBe(false);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toHaveText('草稿已保存到当前浏览器。');
  const afterSave = await durable();
  const drafts = afterSave.data.customDrafts as Record<string, unknown>[];
  expect(drafts).toHaveLength(1);
  expect(Object.keys(drafts[0]).sort()).toEqual([
    'draftVersion',
    'generation',
    'revision',
    'source',
    'updatedAt',
  ]);
  expect(drafts[0].source).toBe(source);
  for (const name of Object.keys(before.data).filter((n) => n !== 'customDrafts'))
    expect(afterSave.data[name]).toEqual(before.data[name]);
  expect([...logs, ...requests].some((s) => s.includes(marker) || s.includes(payload))).toBe(false);
  await info.attach('privacy-observation', {
    body: JSON.stringify({
      marker,
      implicitDatabaseChanges: 0,
      implicitCacheChanges: 0,
      sourceTransmitted: false,
      sourceLogged: false,
      explicitDraftFields: Object.keys(drafts[0]),
      requests: requests.length,
      dialogs: dialogs.length,
    }),
    contentType: 'application/json',
  });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'C 代码', exact: true })).toHaveValue(source);
  await expect(page.getByRole('textbox', { name: '整数输入' })).toHaveValue('7');
  await expect(page.getByTestId('custom-output')).toHaveCount(0);
});
