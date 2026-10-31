import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initSync, prepare_input, execute_request } from '../../web/src/generated/c_viz_wasm';
import {
  initSync as initMemory,
  execute_memory,
} from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/engine-build';
import { engineBuild as memoryBuild } from '../../web/src/generated/memory/engine-build';
import { caseExecutionCatalog } from '../../web/src/content/case-learning';
import { caseRequest } from '../../web/src/engine/execution-client';
import { memoryRequest } from '../../web/src/engine/memory-client';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import { decodeMemoryResult, encodeMemoryRequest } from '../../web/src/engine/memory-protocol';
import { PlayerModel } from '../../web/src/player/model';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { memoryExamples } from '../../web/src/memory/examples';
import { stackExamples } from '../../web/src/stack/examples';
import { copyCurrentDocument, encodeSnapshot } from '../../web/src/snapshot-export/document';
import { layoutSnapshot, visibleText } from '../../web/src/snapshot-export/layout';
import { attachPngSnapshot, pngCrc32 } from '../../web/src/snapshot-export/png';
import { SnapshotExporter } from '../../web/src/snapshot-export/controller';
import {
  SNAPSHOT_LIMITS,
  type CaptureContext,
  type SnapshotPort,
} from '../../web/src/snapshot-export/types';

const id = '16300000-0000-4000-8000-000000000001',
  at = '2026-10-31T08:00:00.000Z';
const digest = (source: string) => createHash('sha256').update(source).digest('hex');
async function core(
  caseId = 'case.c.bubble-sort',
  values?: Record<string, number | number[]>,
  sourcePrefix = '',
) {
  const original = caseExecutionCatalog(caseId)!;
  const catalog = sourcePrefix
      ? {
          ...original,
          program: {
            ...original.program,
            sourceExample: sourcePrefix + original.program.sourceExample,
          },
        }
      : original,
    input = values ?? catalog.program.exampleInput;
  const prepared = JSON.parse(
    new TextDecoder().decode(
      prepare_input(
        JSON.stringify(catalog),
        new TextEncoder().encode(
          JSON.stringify(
            Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))),
          ),
        ),
        1000,
      ),
    ),
  ).source;
  const request = caseRequest(
    catalog,
    prepared,
    { contextId: crypto.randomUUID(), contextRevision: 1, sourceRevision: 1 },
    { values: input, random: null },
  );
  const bytes = execute_request(
    encodeRequest(request),
    JSON.stringify(catalog),
    engineBuild.wasmSha256,
    1000,
  ).slice();
  const result = await decodeResult(bytes.buffer, request),
    player = new PlayerModel();
  player.acceptValidated(player.begin(result.identity), result);
  const read = (): CaptureContext => ({
    kind: 'case',
    mode: 'basic',
    observationId: caseId,
    title: catalog.subject.title,
    request,
    result,
    view: player.snapshot(),
    diagnosticFocus: null,
  });
  return { request, result, player, read };
}
async function memory(example: (typeof memoryExamples)[number] | (typeof stackExamples)[number]) {
  const input =
    example.id === 'hanoi'
      ? [2]
      : example.id === 'quicksort'
        ? [4, 2, 9, 1, 5]
        : 'input' in example
          ? [...example.input]
          : [];
  const request = memoryRequest(example.source, example.language, input);
  const bytes = execute_memory(encodeMemoryRequest(request), memoryBuild.wasmSha256, 1000).slice();
  const result = await decodeMemoryResult(bytes.buffer, request, memoryBuild.wasmSha256),
    player = new MemoryPlayer();
  player.accept(result);
  const read = (): CaptureContext => ({
    kind: 'memory-observation',
    mode: 'memory',
    observationId: example.id,
    title: example.title,
    request,
    result,
    view: player.snapshot(),
    highlightedRange: player.snapshot().byteRange,
    highlightReason: 'executed-step',
  });
  return { request, result, player, read };
}
function documentOf(context: CaptureContext) {
  const result = copyCurrentDocument(context, id, at);
  result.source.sha256 = digest(result.source.text);
  if (result.origin.definitionVersion.scheme === 'source-sha256')
    result.origin.definitionVersion.value = result.source.sha256;
  return result;
}
const measure = (text: string) => Array.from(text).length * 8;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function exporterFixture() {
  const data = await core('case.c.assignment');
  let available = true;
  const port: SnapshotPort = {
    read: () => (available ? data.read() : null),
    pause: () => data.player.pause(),
    subscribe: () => () => {},
  };
  const download = vi.fn(),
    hash = vi.fn(async (source: string) => digest(source));
  let serial = 0;
  const exporter = new SnapshotExporter(port, {
    download,
    hash,
    date: () => at,
    uuid: () => `16300000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
  });
  return {
    ...data,
    port,
    exporter,
    download,
    hash,
    unavailable: () => {
      available = false;
      exporter.observe();
    },
  };
}

describe('16.3 real current-state extraction and bounded file generation', () => {
  beforeAll(() => {
    initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
    initMemory({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') });
  });
  afterEach(() => vi.useRealTimers());
  for (const key of [
    'assignment',
    'branch',
    'loops',
    'array-traversal',
    'bubble-sort',
    'selection-sort',
    'binary-search-first',
  ])
    it(`copies complete actual Rust state, source, input and positions without the trajectory: ${key}`, async () => {
      const data = await core(`case.c.${key}`),
        original = JSON.stringify(data.result);
      for (const cursor of [
        ...new Set([
          0,
          Math.min(15, data.result.trace!.steps.length),
          data.result.trace!.steps.length,
        ]),
      ]) {
        data.player.seek(cursor);
        const context = data.read(),
          document = documentOf(context),
          roundTrip = JSON.parse(new TextDecoder().decode(encodeSnapshot(document)));
        expect(roundTrip.currentState).toEqual(context.view.state);
        expect(roundTrip.currentState).not.toBe(context.view.state);
        expect(roundTrip.input).toEqual(data.request.input);
        expect(roundTrip.source.text).toBe(data.request.source.text);
        expect(roundTrip.source.sourceRevision).toBe(data.request.identity.sourceRevision);
        expect(roundTrip.source.nodeMap).toEqual(data.result.nodeMap);
        expect(roundTrip.runtime.identity).toEqual(data.result.identity);
        expect(roundTrip.currentStep).toEqual(cursor ? data.result.trace!.steps[cursor - 1] : null);
        expect(roundTrip.terminalAtCursor).toEqual(
          cursor === data.result.trace!.steps.length ? data.result.terminal : null,
        );
        expect(roundTrip.trace).toBeUndefined();
        expect(roundTrip.checkpoints).toBeUndefined();
        expect(layoutSnapshot(document, measure, () => {}).height).toBeLessThanOrEqual(
          SNAPSHOT_LIMITS.height,
        );
      }
      expect(JSON.stringify(data.result)).toBe(original);
    });
  for (const example of [...memoryExamples, ...stackExamples])
    it(`preserves actual memory frames, aliases, typed-null/uninitialized/dead objects and return state: ${example.id}`, async () => {
      const data = await memory(example),
        trace = data.result.trace!;
      const cursors = new Set([0, trace.steps.length]);
      for (const kind of [
        'function.enter',
        'function.return',
        'pointer.write',
        'memory.release',
        'scope.exit',
      ]) {
        const index = trace.steps.findIndex((step) => step.kind === kind);
        if (index >= 0) cursors.add(index + 1);
      }
      for (const cursor of cursors) {
        data.player.seek(cursor);
        const context = data.read(),
          document = documentOf(context);
        expect(JSON.parse(new TextDecoder().decode(encodeSnapshot(document))).currentState).toEqual(
          context.view.state,
        );
        expect(document.types).toEqual(data.result.types);
        expect(document.origin.caseRef).toBeNull();
        expect(document.origin.definitionVersion).toEqual({
          scheme: 'source-sha256',
          value: digest(example.source),
        });
        expect(document.runtime.identity).toEqual(data.result.identity);
        expect(document.position.cursor).toBe(cursor);
        expect(document.currentStep).toEqual(cursor ? trace.steps[cursor - 1] : null);
        for (const object of document.currentState.objects)
          if ('alive' in object && !object.alive) expect(object.cells).toEqual([]);
      }
      data.player.seek(trace.steps.length);
      const end = documentOf(data.read());
      data.player.seek(0);
      const start = documentOf(data.read());
      expect(end.currentState).not.toEqual(start.currentState);
    });
  it('keeps complete sparse state and refuses an oversized picture without changing the JSON data', async () => {
    const data = await memory(memoryExamples[0]);
    data.player.seek(3);
    const document = documentOf(data.read());
    const object = document.currentState
      .objects[0] as import('../../web/src/engine/memory-protocol').MemoryObject;
    object.length = 262144;
    object.byteLength = 1048576;
    object.zeroInitialized = true;
    object.cells = [];
    const before = encodeSnapshot(document);
    expect(() => layoutSnapshot(document, measure, () => {})).toThrow('SNAPSHOT_PICTURE_LIMIT');
    expect(encodeSnapshot(document)).toEqual(before);
  });
  it('preserves Chinese, CRLF, supplementary characters and exact UTF8 byte coordinates', async () => {
    const data = await core('case.c.assignment', undefined, '// 中文😀\r\n');
    const context = data.read();
    if (context.kind !== 'case') throw Error();
    context.diagnosticFocus = { start: 3, end: 13 };
    const document = documentOf(context);
    expect(document.source.text.startsWith('// 中文😀\r\n')).toBe(true);
    expect(document.position.highlighted.range).toMatchObject({
      byteRange: { start: 3, end: 13 },
      start: { line: 1, column: 4 },
    });
    expect(document.source.sha256).toBe(digest(context.request.source.text));
  });
  it('rejects unavailable, crossed identities and active playback rather than making a fake snapshot', async () => {
    const data = await core();
    const context = data.read();
    context.view.state = null;
    expect(() => documentOf(context)).toThrow('SNAPSHOT_UNAVAILABLE');
    const crossed = data.read();
    crossed.view.identity!.runId = crypto.randomUUID();
    expect(() => documentOf(crossed)).toThrow('SNAPSHOT_UNAVAILABLE');
    data.player.play();
    expect(() => documentOf(data.read())).toThrow('SNAPSHOT_UNAVAILABLE');
  });
  it('renders untrusted strings as literal drawing data and visibly represents control characters', async () => {
    const data = await core();
    const document = documentOf(data.read());
    document.origin.title = '<script>alert(1)</script> 中文';
    document.currentState.output = '<img src="https://example.invalid">\0\u202e';
    const picture = layoutSnapshot(document, measure, () => {}),
      text = picture.operations
        .filter((op) => op.kind === 'text')
        .map((op) => op.text)
        .join('\n');
    expect(text).toContain('<script>alert(1)</script>');
    expect(text).toContain('\\u0000');
    expect(text).toContain('\\u202e');
    expect(visibleText('😀\ud800')).toBe('😀\\ud800');
  });
  it('uses PNG iTXt Unicode metadata and independent native CRC32 without altering the native image bytes', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=',
      'base64',
    );
    const json = new TextEncoder().encode('{"source":"中文😀<script>"}\n'),
      combined = attachPngSnapshot(png, json);
    expect(pngCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(pngCrc32(json)).toBe(crc32(json));
    let found = false;
    for (let offset = 8; offset < combined.length;) {
      const size = new DataView(combined.buffer, offset, 4).getUint32(0);
      const type = new TextDecoder().decode(combined.slice(offset + 4, offset + 8));
      if (type === 'iTXt') {
        found = true;
        const content = combined.slice(offset + 8, offset + 8 + size);
        expect(new TextDecoder().decode(content)).toBe(
          'c-viz.snapshot\0\0\0\0\0' + new TextDecoder().decode(json),
        );
        expect(new DataView(combined.buffer, offset + 8 + size, 4).getUint32(0)).toBe(
          crc32(combined.slice(offset + 4, offset + 8 + size)),
        );
      }
      offset += size + 12;
    }
    expect(found).toBe(true);
    expect(() => attachPngSnapshot(new Uint8Array(10), json)).toThrow('SNAPSHOT_FAILED');
  });
  it('rejects synthetic envelopes above the JSON byte budget, including PNG metadata, without truncation', async () => {
    const data = await core('case.c.assignment');
    const document = documentOf(data.read());
    document.currentState.output = '中'.repeat(700000);
    expect(() => encodeSnapshot(document)).toThrow('SNAPSHOT_TOO_LARGE');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=',
      'base64',
    );
    expect(() => attachPngSnapshot(png, new Uint8Array(SNAPSHOT_LIMITS.jsonBytes + 1))).toThrow(
      'SNAPSHOT_TOO_LARGE',
    );
    expect(document.currentState.output.length).toBe(700000);
  });
  it('pauses the actual player and downloads a separate complete document for each cursor and repeated click', async () => {
    const f = await exporterFixture();
    f.player.play();
    await f.exporter.export('json');
    expect(f.player.snapshot().status).not.toBe('playing');
    f.player.seek(2);
    f.exporter.observe();
    await f.exporter.export('json');
    await f.exporter.export('json');
    expect(f.download).toHaveBeenCalledTimes(3);
    expect(new Set(f.download.mock.calls.map((call) => call[1])).size).toBe(3);
    const records = await Promise.all(
      f.download.mock.calls.map(async (call) => JSON.parse(await (call[0] as Blob).text())),
    );
    expect(records.map((record) => record.position.cursor)).toEqual([0, 2, 2]);
    expect(records[0].currentState).not.toEqual(records[1].currentState);
  });
  it('invalidates an asynchronous digest on step-away/step-back ABA and never revives its file', async () => {
    const f = await exporterFixture(),
      hold = deferred<string>();
    f.hash.mockImplementationOnce(() => hold.promise);
    const pending = f.exporter.export('json');
    f.player.seek(1);
    f.exporter.observe();
    f.player.seek(0);
    f.exporter.observe();
    hold.resolve(digest(f.request.source.text));
    await pending;
    expect(f.download).not.toHaveBeenCalled();
    expect(f.exporter.getSnapshot().phase).toBe('cancelled');
    await f.exporter.export('json');
    expect(f.download).toHaveBeenCalledTimes(1);
  });
  it('cancels a raster wait on invalidation and ignores a late successful image', async () => {
    const f = await exporterFixture(),
      hold = deferred<Blob>(),
      render = vi.fn(() => hold.promise),
      download = vi.fn();
    const exporter = new SnapshotExporter(f.port, {
      render,
      download,
      hash: async (text) => digest(text),
    });
    const pending = exporter.export('png');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    exporter.cancel();
    hold.resolve(new Blob(['late']));
    await pending;
    expect(download).not.toHaveBeenCalled();
    expect(exporter.getSnapshot().phase).toBe('cancelled');
  });
  it('clears a pending operation when the current run disappears, and an unavailable run cannot download', async () => {
    const f = await exporterFixture(),
      hold = deferred<string>();
    f.hash.mockImplementationOnce(() => hold.promise);
    const pending = f.exporter.export('json');
    f.unavailable();
    hold.resolve(digest(f.request.source.text));
    await pending;
    await f.exporter.export('json');
    expect(f.download).not.toHaveBeenCalled();
    expect(f.exporter.getSnapshot().phase).toBe('failed');
  });
  it('times out at the independent5000ms export budget without granting execution time or late download', async () => {
    const f = await exporterFixture(),
      hold = deferred<string>();
    vi.useFakeTimers();
    f.hash.mockImplementationOnce(() => hold.promise);
    const pending = f.exporter.export('json');
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(f.exporter.getSnapshot().phase).toBe('failed');
    expect(f.exporter.getSnapshot().message).toContain('5秒');
    hold.resolve(digest(f.request.source.text));
    await Promise.resolve();
    expect(f.download).not.toHaveBeenCalled();
  });
  it('reports an actual download exception without claiming a disk save and permits explicit retry', async () => {
    const f = await exporterFixture();
    f.download.mockImplementationOnce(() => {
      throw Error('blocked');
    });
    await f.exporter.export('json');
    expect(f.exporter.getSnapshot().phase).toBe('failed');
    await f.exporter.export('json');
    expect(f.exporter.getSnapshot().phase).toBe('download-started');
    expect(f.exporter.getSnapshot().message).toContain('请在浏览器下载列表确认');
  });
});
