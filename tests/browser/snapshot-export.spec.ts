import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { crc32, gzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { native, clear } from './achievement-helpers';
import { isolateCaseProgram } from './case-content-copy';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { decodeMemoryResult, type MemoryRequest } from '../../web/src/engine/memory-protocol';
import { engineBuild as memoryBuild } from '../../web/src/generated/memory/engine-build';
import { PlayerModel } from '../../web/src/player/model';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { createSourceIndex, mapSourceLocation } from '../../web/src/player/source-location';
import type { SnapshotDocument } from '../../web/src/snapshot-export/types';

const folder = `.artifacts/16.3/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const exporter = (p: Page) => p.getByTestId('snapshot-export');
const formatButton = (p: Page, format: 'json' | 'png') =>
  p.getByRole('button', {
    name: format === 'json' ? '下载状态文件（JSON）' : '下载快照图片（PNG）',
    exact: true,
  });
test.beforeAll(() => mkdir(folder, { recursive: true }));
test.use({ timezoneId: 'Asia/Shanghai' });
async function ready(p: Page, path: string) {
  await p.goto(`/#/${path}`);
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
}
async function runCase(p: Page, id = 'bubble-sort') {
  await ready(p, `visualize/case.c.${id}`);
  await expect(formatButton(p, 'json')).toBeDisabled();
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(formatButton(p, 'json')).toBeEnabled();
  await p.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
}
async function runMemory(p: Page, id = 'nodes') {
  await ready(p, `memory?example=${id}&view=memory`);
  await expect(formatButton(p, 'json')).toBeDisabled();
  await p.getByRole('button', { name: '运行样例', exact: true }).click();
  await expect(formatButton(p, 'json')).toBeEnabled();
}
async function captured(p: Page, label: string) {
  const encoded = await p.evaluate(() => {
    const record = window.__verticalObservation.workers.findLast(
      (w) => w.moduleSeen && w.responseOk,
    );
    if (!record) throw Error('Real Worker required');
    return {
      moduleSeen: record.moduleSeen,
      ...(
        record as unknown as {
          captureEncoded: () => { requestBase64: string; responseBase64: string };
        }
      ).captureEncoded(),
    };
  });
  expect(encoded.moduleSeen).toBe(true);
  await writeFile(`${folder}/${label}-worker.json.gz`, gzipSync(JSON.stringify(encoded)), {
    flag: 'wx',
  });
  const request = JSON.parse(Buffer.from(encoded.requestBase64, 'base64').toString()) as
    ExecuteRequest | MemoryRequest;
  const buffer = Uint8Array.from(Buffer.from(encoded.responseBase64, 'base64')).buffer;
  return 'execVersion' in request
    ? {
        kind: 'memory' as const,
        request,
        result: await decodeMemoryResult(buffer, request, memoryBuild.wasmSha256),
      }
    : { kind: 'case' as const, request, result: await decodeResult(buffer, request) };
}
type Real = Awaited<ReturnType<typeof captured>>;
function verify(document: SnapshotDocument, real: Real, cursor: number) {
  expect(document.formatVersion).toBe('1.0.0');
  expect(document.position.cursor).toBe(cursor);
  expect(document.position.paused).toBe(true);
  expect(document.position.length).toBe(real.result.trace!.steps.length);
  expect(document.position.atTerminal).toBe(cursor === real.result.trace!.steps.length);
  expect(document.runtime.identity).toEqual(real.result.identity);
  expect(document.input).toEqual(real.request.input);
  expect(document.source.nodeMap).toEqual(real.result.nodeMap);
  expect(document.currentStep).toEqual(cursor ? real.result.trace!.steps[cursor - 1] : null);
  expect(document.executionOutcome).toEqual(real.result.terminal);
  expect(document.terminalAtCursor).toEqual(
    cursor === real.result.trace!.steps.length ? real.result.terminal : null,
  );
  const serialized = JSON.stringify(document);
  expect(Object.keys(document)).not.toContain('trace');
  expect(serialized).not.toContain('"checkpoints":');
  const source =
    typeof real.request.source === 'string' ? real.request.source : real.request.source.text;
  expect(document.source.text).toBe(source);
  expect(document.source.sha256).toBe(createHash('sha256').update(source).digest('hex'));
  const index = createSourceIndex(source);
  if (real.kind === 'case') {
    const model = new PlayerModel();
    expect(model.acceptValidated(model.begin(real.result.identity), real.result)).toBe(true);
    model.seek(cursor);
    const view = model.snapshot();
    expect(document.currentState).toEqual(view.state);
    expect(document.position.executed.range).toEqual(
      mapSourceLocation(source, real.result.nodeMap, view.location, index).range,
    );
    expect(document.source.sourceRevision).toBe(real.request.identity.sourceRevision);
    expect(document.origin.caseRef).toEqual(real.result.subjectRef);
    expect(document.origin.programRef).toEqual(real.result.programRef);
    expect(document.origin.packageRef).toEqual(real.result.packageRef);
    expect(document.source.blockMap).toEqual(real.request.source.blockMap);
    expect(document.source.bindingMap).toEqual(real.request.source.bindingMap);
    expect(document.source.resolvedBindings).toEqual(real.result.resolvedBindings);
  } else {
    const model = new MemoryPlayer();
    model.accept(real.result);
    model.seek(cursor);
    const view = model.snapshot();
    expect(document.currentState).toEqual(view.state);
    expect(document.types).toEqual(real.result.types);
    expect(document.position.executed.range).toEqual(
      view.byteRange ? index.range(view.byteRange) : null,
    );
    expect(document.source.sourceRevision).toBe(real.request.sourceRevision);
    expect(document.origin.caseRef).toBeNull();
    expect(document.origin.definitionVersion).toEqual({
      scheme: 'source-sha256',
      value: document.source.sha256,
    });
  }
}
function pngDocument(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let offset = 8,
    document: SnapshotDocument | null = null,
    height = 0;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    expect(crc32(bytes.subarray(offset + 4, offset + 8 + length))).toBe(
      bytes.readUInt32BE(offset + 8 + length),
    );
    if (type === 'IHDR') {
      expect(data.readUInt32BE(0)).toBe(1440);
      height = data.readUInt32BE(4);
      expect(height).toBeLessThanOrEqual(8192);
    }
    if (type === 'iTXt' && data.toString('ascii', 0, 14) === 'c-viz.snapshot') {
      const head = Buffer.from('c-viz.snapshot\0\0\0\0\0');
      expect(data.subarray(0, head.length)).toEqual(head);
      expect(document).toBeNull();
      document = JSON.parse(data.subarray(head.length).toString('utf8')) as SnapshotDocument;
    }
    offset += 12 + length;
    if (type === 'IEND') {
      expect(offset).toBe(bytes.length);
      break;
    }
  }
  expect(document).not.toBeNull();
  expect(height).toBeGreaterThan(200);
  return document!;
}
async function download(p: Page, format: 'json' | 'png') {
  const pending = p.waitForEvent('download');
  await formatButton(p, format).click();
  const file = await pending,
    name = file.suggestedFilename();
  expect(name).toMatch(new RegExp(`^cviz-\\d{8}T\\d{9}Z-s\\d+-[a-f0-9-]{36}\\.${format}$`));
  await file.saveAs(`${folder}/${name}`);
  expect(await file.failure()).toBeNull();
  const bytes = await readFile(`${folder}/${name}`);
  expect(bytes.length).toBeLessThanOrEqual((format === 'json' ? 2 : 8) * 1024 * 1024);
  await expect(exporter(p)).toHaveAttribute('data-phase', 'download-started');
  await expect(p.getByTestId('snapshot-export-status')).toContainText('请在浏览器下载列表确认');
  if (format === 'png') {
    const dimensions = await p.evaluate(async (base64) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
      const result = { width: image.width, height: image.height };
      image.close();
      return result;
    }, bytes.toString('base64'));
    expect(dimensions.width).toBe(1440);
  }
  return {
    name,
    document:
      format === 'json'
        ? (JSON.parse(bytes.toString('utf8')) as SnapshotDocument)
        : pngDocument(bytes),
  };
}
async function seek(p: Page, real: Real, cursor: number) {
  if (real.kind === 'memory')
    await p.getByRole('slider', { name: '执行步骤', exact: true }).fill(String(cursor));
  else {
    // The existing case player has no seek slider; use its real step controls.
    const current = Number(await p.getByTestId('player-controls').getAttribute('data-cursor'));
    for (let i = 0; i < current; i++)
      await p
        .getByTestId('player-controls')
        .getByRole('button', { name: '后退', exact: true })
        .click();
    for (let i = 0; i < cursor; i++)
      await p
        .getByTestId('player-controls')
        .getByRole('button', { name: '前进', exact: true })
        .click();
  }
}
for (const id of [
  'assignment',
  'branch',
  'loops',
  'array-traversal',
  'bubble-sort',
  'selection-sort',
  'binary-search-first',
])
  test(`real downloads preserve current source, input and full state: C ${id}`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await runCase(p, id);
    const real = await captured(p, id),
      before = await native(p);
    const initial = await download(p, 'json');
    verify(initial.document, real, 0);
    const cursor = Math.min(12, real.result.trace!.steps.length);
    await seek(p, real, cursor);
    const picture = await download(p, 'png');
    verify(picture.document, real, cursor);
    const second = await download(p, 'json');
    verify(second.document, real, cursor);
    expect(new Set([initial.name, picture.name, second.name]).size).toBe(3);
    expect(await native(p)).toEqual(before);
  });
for (const id of [
  'pointers',
  'scope',
  'nodes',
  'null',
  'uninitialized',
  'bounds',
  'functions',
  'hanoi',
  'quicksort',
  'stack-limit',
])
  test(`real C/C++ memory downloads preserve complete restored state: ${id}`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await runMemory(p, id);
    const real = await captured(p, id),
      before = await native(p);
    expect(real.kind).toBe('memory');
    const cursors = new Set([0, real.result.trace!.steps.length]);
    for (const kind of [
      'function.enter',
      'function.return',
      'pointer.write',
      'memory.release',
      'scope.exit',
    ]) {
      const step = real.result.trace!.steps.find((s) => s.kind === kind);
      if (step) cursors.add(step.seq);
    }
    for (const cursor of cursors) {
      await seek(p, real, cursor);
      verify((await download(p, 'json')).document, real, cursor);
    }
    const pictureCursor = id === 'stack-limit' ? 1 : real.result.trace!.steps.length;
    await seek(p, real, pictureCursor);
    verify((await download(p, 'png')).document, real, pictureCursor);
    // End, then rewind: dead objects, caller activation and output must restore.
    await seek(p, real, real.result.trace!.steps.length);
    await seek(p, real, 1);
    verify((await download(p, 'json')).document, real, 1);
    expect(await native(p)).toEqual(before);
  });

interface Hold {
  arm: 'none' | 'digest' | 'canvas' | 'fonts' | 'canvas-null' | 'url-fail';
  waiting: boolean;
  release: () => void;
}
declare global {
  interface Window {
    snapshotHold: Hold;
  }
}
async function controls(p: Page) {
  await p.addInitScript(() => {
    const hold: Hold = { arm: 'none', waiting: false, release: () => {} };
    window.snapshotHold = hold;
    const defer = async <T>(value: T, phase: Hold['arm']) => {
      if (hold.arm !== phase) return value;
      hold.arm = 'none';
      hold.waiting = true;
      await new Promise<void>((resolve) => {
        hold.release = () => {
          hold.waiting = false;
          resolve();
        };
      });
      return value;
    };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, data) =>
      defer(await digest(algorithm, data), 'digest');
    const nativeBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (hold.arm === 'canvas-null') {
        hold.arm = 'none';
        callback(null);
        return;
      }
      nativeBlob.call(
        this,
        (blob) => {
          void defer(blob, 'canvas').then(callback);
        },
        type,
        quality,
      );
    };
    const ready = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, 'ready')!;
    Object.defineProperty(FontFaceSet.prototype, 'ready', {
      configurable: true,
      get() {
        return Promise.resolve(ready.get!.call(this)).then((value) => defer(value, 'fonts'));
      },
    });
    const url = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      if (hold.arm === 'url-fail') {
        hold.arm = 'none';
        throw Error('Controlled download failure');
      }
      return url(blob);
    };
  });
}
async function arm(p: Page, phase: Hold['arm']) {
  await p.evaluate((phase) => {
    window.snapshotHold.arm = phase;
  }, phase);
}
async function waiting(p: Page) {
  await expect.poll(() => p.evaluate(() => window.snapshotHold.waiting)).toBe(true);
}
async function release(p: Page) {
  await p.evaluate(() => window.snapshotHold.release());
}

for (const phase of ['digest', 'canvas', 'fonts'] as const)
  test(`a real ${phase} continuation cannot download after step-away-and-back`, async ({
    page: p,
  }) => {
    await observeCaseSetExecution(p);
    await controls(p);
    await runMemory(p);
    let count = 0;
    p.on('download', () => count++);
    await arm(p, phase);
    await formatButton(p, 'png').click();
    await waiting(p);
    await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('1');
    await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('0');
    await expect(exporter(p)).toHaveAttribute('data-phase', 'cancelled');
    await release(p);
    await p.waitForTimeout(150);
    expect(count).toBe(0);
    const real = await captured(p, `${phase}-retry`);
    verify((await download(p, 'png')).document, real, 0);
  });
for (const action of ['source', 'input', 'run', 'mode', 'unmount', 'clear'] as const)
  test(`pending actual PNG is cancelled by ${action}`, async ({ page: p, context }) => {
    await observeCaseSetExecution(p);
    await controls(p);
    await runMemory(p);
    const clearPeer = action === 'clear' ? await context.newPage() : null;
    if (clearPeer) {
      await clearPeer.goto('/#/settings?panel=data');
      await expect(
        clearPeer.getByRole('button', { name: '清除本地数据', exact: true }),
      ).toBeEnabled();
      await p.bringToFront();
    }
    let count = 0;
    p.on('download', () => count++);
    await arm(p, 'canvas');
    await formatButton(p, 'png').click();
    await waiting(p);
    if (action === 'source')
      await p.getByLabel('观察样例', { exact: true }).selectOption('functions');
    if (action === 'input') await p.getByLabel('三个节点值', { exact: true }).fill('7 -2 0');
    if (action === 'run') await p.getByRole('button', { name: '运行样例', exact: true }).click();
    if (action === 'mode') await p.getByRole('button', { name: '基础视图', exact: true }).click();
    if (action === 'unmount') await p.goto('/#/cases');
    if (clearPeer) await clear(clearPeer);
    if (action === 'clear') {
      // A session clear remounts the workspace; the new actor starts empty.
      await expect(exporter(p)).toHaveAttribute('data-phase', 'idle');
      await expect(formatButton(p, 'json')).toBeDisabled();
      await clearPeer!.close();
    } else if (action !== 'unmount')
      await expect(exporter(p)).toHaveAttribute('data-phase', 'cancelled');
    await release(p);
    await p.waitForTimeout(150);
    expect(count).toBe(0);
  });
test('manual cancellation, native encoding failure, timeout and download failure all allow explicit retry', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await controls(p);
  await runMemory(p);
  let count = 0;
  p.on('download', () => count++);
  await arm(p, 'canvas');
  await formatButton(p, 'png').click();
  await waiting(p);
  await p.getByRole('button', { name: '取消导出', exact: true }).click();
  await expect(exporter(p)).toHaveAttribute('data-phase', 'cancelled');
  await release(p);
  for (const phase of ['canvas-null', 'url-fail'] as const) {
    await arm(p, phase);
    await formatButton(p, 'png').click();
    await expect(exporter(p)).toHaveAttribute('data-phase', 'failed');
    await expect(p.getByTestId('snapshot-export-status')).toContainText('请重试');
  }
  await arm(p, 'fonts');
  await formatButton(p, 'png').click();
  await waiting(p);
  await expect(exporter(p)).toHaveAttribute('data-phase', 'failed', { timeout: 7000 });
  await expect(p.getByTestId('snapshot-export-status')).toContainText('超过5秒');
  await release(p);
  expect(count).toBe(0);
  const real = await captured(p, 'failure-retry');
  verify((await download(p, 'png')).document, real, 0);
});
test('literal Unicode seed remains inert in files and absent from URLs, console and learning stores', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await ready(p, 'visualize/case.c.bubble-sort');
  const marker = '<script>window.snapshotInjected=1</script>中文😀\u202e',
    logs: string[] = [],
    urls: string[] = [];
  p.on('console', (m) => logs.push(m.text()));
  p.on('request', (r) => urls.push(r.url()));
  await p.getByText('复现随机数据', { exact: true }).click();
  await p.getByTestId('input-seed').fill(marker);
  await p.getByRole('button', { name: '按种子复现', exact: true }).click();
  await p.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(formatButton(p, 'json')).toBeEnabled();
  const real = await captured(p, 'literal-seed'),
    before = await native(p);
  const json = await download(p, 'json'),
    png = await download(p, 'png');
  verify(json.document, real, 0);
  verify(png.document, real, 0);
  expect(JSON.stringify(json.document.input)).toContain(marker);
  expect(JSON.stringify(png.document.input)).toContain(marker);
  expect(
    await p.evaluate(() => (window as unknown as { snapshotInjected?: number }).snapshotInjected),
  ).toBeUndefined();
  expect(
    [...logs, ...urls, p.url(), json.name, png.name].some(
      (s) => s.includes(marker) || s.includes(encodeURIComponent(marker)),
    ),
  ).toBe(false);
  expect(await native(p)).toEqual(before);
});

test('an export pauses the original playing memory model and never resumes it', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await runMemory(p, 'nodes');
  const real = await captured(p, 'pause-original');
  await p.getByRole('button', { name: '播放', exact: true }).click();
  const file = await download(p, 'png'),
    cursor = file.document.position.cursor;
  verify(file.document, real, cursor);
  await expect(p.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await p.waitForTimeout(600);
  await expect(p.getByTestId('memory-workspace')).toHaveAttribute('data-cursor', String(cursor));
  expect(
    await p.evaluate(
      () => window.__verticalObservation.workers.filter((w) => w.moduleSeen && w.responseOk).length,
    ),
  ).toBe(1);
});
test('the real 32-frame error prefix exports intact JSON and a complete bounded picture', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await runMemory(p, 'stack-limit');
  const real = await captured(p, 'deep-prefix'),
    cursor = real.result.trace!.steps.length;
  await seek(p, real, cursor);
  const file = await download(p, 'json');
  verify(file.document, real, cursor);
  expect(file.document.currentState.frames).toHaveLength(32);
  verify((await download(p, 'png')).document, real, cursor);
});
test('changing a case input cancels the actual pending picture and invalidates its final receipt', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await controls(p);
  await runCase(p, 'assignment');
  let count = 0;
  p.on('download', () => count++);
  await arm(p, 'canvas');
  await formatButton(p, 'png').click();
  await waiting(p);
  await p.getByTestId('input-field-x').fill('15');
  await release(p);
  await p.waitForTimeout(150);
  expect(count).toBe(0);
  await expect(exporter(p)).toHaveCount(0);
  await p.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(formatButton(p, 'json')).toBeEnabled();
  const real = await captured(p, 'case-input-retry');
  verify((await download(p, 'json')).document, real, 0);
});
test('an isolated public template copy executes and exports its actual CRLF Chinese and emoji source', async ({
  page: p,
}) => {
  // Only this explicit fixture uses the independent bundled catalog. The
  // separate formal course must not override the modified public template.
  await p.route(/\/content\/(?:course|review)\//, (route) =>
    route.fulfill({
      status: 404,
      body: 'Explicit isolated source fixture; not publication evidence',
    }),
  );
  const copy = await isolateCaseProgram(
    p,
    'program.c.assignment',
    (source) => '// 中文😀\r\n' + source,
  );
  await observeCaseSetExecution(p);
  await runCase(p, 'assignment');
  const real = await captured(p, 'unicode-source');
  await seek(p, real, 2);
  const file = await download(p, 'png');
  verify(file.document, real, 2);
  expect(file.document.source.text.startsWith('// 中文😀\r\n')).toBe(true);
  expect(copy.getCopy()?.publicationEvidence).toBe(false);
  await writeFile(`${folder}/unicode-isolated-copy.json`, JSON.stringify(copy.getCopy(), null, 2), {
    flag: 'wx',
  });
});
test('selected caller frames and view switches do not narrow the complete exported memory state', async ({
  page: p,
}) => {
  await observeCaseSetExecution(p);
  await runMemory(p, 'functions');
  const real = await captured(p, 'frame-scope');
  const step = real.result.trace!.steps.find((s) => s.kind === 'function.enter' && s.seq > 4)!;
  await seek(p, real, step.seq);
  await p.getByRole('button', { name: '调用栈视图', exact: true }).click();
  const caller = p.getByTestId('stack-frame').last();
  await caller.click();
  await expect(caller).toHaveAttribute('aria-pressed', 'true');
  expect(await caller.getAttribute('data-active')).toBe('false');
  const file = await download(p, 'png');
  verify(file.document, real, step.seq);
  expect(file.document.presentation.mode).toBe('stack');
  expect(file.document.currentState.frames.length).toBeGreaterThan(1);
  await p.getByRole('button', { name: '基础视图', exact: true }).click();
  const basic = await download(p, 'json');
  verify(basic.document, real, step.seq);
  expect(basic.document.currentState).toEqual(file.document.currentState);
});
test('an actual isolated 600-slot C state keeps exact JSON and rejects an oversized picture without truncation', async ({
  page: p,
}) => {
  await p.route(/\/content\/(?:course|review)\//, (route) =>
    route.fulfill({
      status: 404,
      body: 'Explicit isolated source fixture; not publication evidence',
    }),
  );
  const copy = await isolateCaseProgram(p, 'program.c.assignment', (source) =>
    source.replace('return 0;', 'int large[600];\n    return 0;'),
  );
  await observeCaseSetExecution(p);
  await runCase(p, 'assignment');
  const real = await captured(p, 'oversized-real-source');
  const step = real.result.trace!.steps.find((s) =>
    s.changes.some(
      (c) =>
        c.op === 'record' &&
        c.table === 'objects' &&
        c.after &&
        'name' in c.after &&
        c.after.name === 'large',
    ),
  )!;
  expect(step).toBeTruthy();
  await seek(p, real, step.seq);
  const file = await download(p, 'json');
  verify(file.document, real, step.seq);
  expect(file.document.currentState.objects.find((o) => o.name === 'large')!.length).toBe(600);
  let count = 0;
  p.on('download', () => count++);
  await formatButton(p, 'png').click();
  await expect(exporter(p)).toHaveAttribute('data-phase', 'failed');
  await expect(p.getByTestId('snapshot-export-status')).toContainText('没有截断内容');
  expect(count).toBe(0);
  verify((await download(p, 'json')).document, real, step.seq);
  await writeFile(
    `${folder}/oversize-isolated-copy.json`,
    JSON.stringify(copy.getCopy(), null, 2),
    { flag: 'wx' },
  );
});
for (const width of [1440, 768, 390])
  test(`snapshot controls fit and download from the minimal interface at ${width}px`, async ({
    page: p,
  }) => {
    await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await observeCaseSetExecution(p);
    await runMemory(p, 'nodes');
    const real = await captured(p, `viewport-${width}`);
    await p.getByRole('slider', { name: '执行步骤', exact: true }).fill('25');
    await exporter(p).getByText('文件包含范围', { exact: true }).click();
    await exporter(p).scrollIntoViewIfNeeded();
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await p.screenshot({ path: `${folder}/interface-${width}.png`, fullPage: true });
    verify((await download(p, 'png')).document, real, 25);
  });
