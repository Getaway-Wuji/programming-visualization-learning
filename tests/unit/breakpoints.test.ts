import { afterEach, expect, test, vi } from 'vitest';
import { sourceLines, stepVisits } from '../../web/src/debug/breakpoints';
import { MemoryWorkspaceController } from '../../web/src/memory/controller';
import { MemoryExecutionClient } from '../../web/src/engine/memory-client';
import { fixture } from './memory-fixture';

const source = 'int main(){\nint x=7;\nreturn x;\n}';
function sample() {
  const result = fixture();
  result.nodeMap = [
    { nodeId: 'n1', kind: 'function', byteRange: { start: 0, end: source.length } },
    { nodeId: 'n2', kind: 'block', byteRange: { start: 10, end: source.length } },
    { nodeId: 'n3', kind: 'declaration', byteRange: { start: 12, end: 20 } },
    { nodeId: 'n4', kind: 'return', byteRange: { start: 21, end: 30 } },
  ];
  return result;
}
function setup() {
  const client = new MemoryExecutionClient();
  const execute = vi.spyOn(client, 'execute').mockResolvedValue(sample());
  const controller = new MemoryWorkspaceController(client);
  controller.setSource(source, 'c');
  return { controller, execute };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('source coordinates preserve UTF8, CRLF, lone CR and original line text', () => {
  const text = '// 你\r\nint x;\rreturn x;\n';
  const lines = sourceLines(text);
  expect(lines.map((line) => line.text)).toEqual(['// 你', 'int x;', 'return x;', '']);
  expect(lines.map((line) => line.byteStart)).toEqual([0, 8, 15, 25]);
  expect(text.slice(lines[2].start, lines[2].end)).toBe('return x;');
  const result = sample();
  result.nodeMap.forEach((node) => (node.byteRange.start = 15));
  expect(stepVisits(text, result).map((visit) => visit.line)).toEqual([3, 3, 3, 3]);
});

test('one line groups consecutive steps; loop tests and distinct recursion frames start visits', () => {
  // Synthetic scheduling boundaries only; real executions are covered in Chrome.
  const result = sample();
  result.nodeMap.forEach((node) => (node.byteRange.start = 0));
  result.nodeMap.find((node) => node.nodeId === 'n3')!.kind = 'while';
  const control = result.trace!.initialState.control;
  result.trace!.steps = [
    { seq: 1, kind: 'nop', nodeId: 'n1', changes: [] },
    { seq: 2, kind: 'nop', nodeId: 'n1', changes: [] },
    { seq: 3, kind: 'condition', nodeId: 'n3', changes: [] },
    { seq: 4, kind: 'condition', nodeId: 'n3', changes: [] },
    {
      seq: 5,
      kind: 'function.enter',
      nodeId: 'n1',
      changes: [{ op: 'control', before: control, after: { ...control, activeFrameId: 'f2' } }],
    },
    { seq: 6, kind: 'nop', nodeId: 'n1', changes: [] },
    {
      seq: 7,
      kind: 'function.return',
      nodeId: 'n1',
      changes: [{ op: 'control', before: { ...control, activeFrameId: 'f2' }, after: control }],
    },
    { seq: 8, kind: 'nop', nodeId: 'n1', changes: [] },
  ];
  expect(stepVisits('int main(){while(1){} }', result).map((visit) => visit.entry)).toEqual([
    true,
    false,
    true,
    true,
    true,
    false,
    false,
    true,
  ]);
});

test('expression-node loop conditions use the smallest original control range, excluding nested ifs', () => {
  const result = sample();
  result.nodeMap = [
    { nodeId: 'n1', kind: 'for', byteRange: { start: 0, end: 40 } },
    { nodeId: 'n2', kind: 'expression', byteRange: { start: 5, end: 7 } },
    { nodeId: 'n3', kind: 'if', byteRange: { start: 20, end: 35 } },
    { nodeId: 'n4', kind: 'expression', byteRange: { start: 23, end: 25 } },
  ];
  result.trace!.steps = [
    { seq: 1, kind: 'nop', nodeId: 'n1', changes: [] },
    { seq: 2, kind: 'condition', nodeId: 'n2', changes: [] },
    { seq: 3, kind: 'condition', nodeId: 'n4', changes: [] },
    { seq: 4, kind: 'condition', nodeId: 'n2', changes: [] },
  ];
  expect(stepVisits('for(;;){if(1){} }', result).map((visit) => visit.entry)).toEqual([
    true,
    true,
    false,
    true,
  ]);
});

test('stop after first step of a line; continue advances through the same-line tail', async () => {
  vi.useFakeTimers();
  const { controller, execute } = setup();
  controller.toggleBreakpoint(2);
  await controller.execute(source, 'c', []);
  controller.play();
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().hit).toEqual({ line: 2, cursor: 2 });
  expect(controller.getSnapshot().view.playing).toBe(false);
  // The declaration completed, but the subsequent initialization has not.
  expect(controller.getSnapshot().view.state!.objects[0].cells).toEqual([]);
  await vi.advanceTimersByTimeAsync(4000);
  expect(controller.getSnapshot().view.cursor).toBe(2);
  controller.play();
  await vi.advanceTimersByTimeAsync(500);
  expect(controller.getSnapshot().view.cursor).toBe(3);
  expect(controller.getSnapshot().hit).toBeNull();
  expect(controller.getSnapshot().view.state!.objects[0].cells[0].value).toBe(7);
  await vi.advanceTimersByTimeAsync(500);
  expect(controller.getSnapshot().view.cursor).toBe(4);
  expect(execute).toHaveBeenCalledTimes(1);
});

test('seek, backward and manual forward restore state without auto hits; replay hits again', async () => {
  vi.useFakeTimers();
  const { controller } = setup();
  await controller.execute(source, 'c', []);
  controller.toggleBreakpoint(2);
  controller.seek(3);
  const beforeReturn = controller.getSnapshot().view.state;
  controller.step(1);
  controller.step(-1);
  expect(controller.getSnapshot().view.state).toEqual(beforeReturn);
  expect(controller.getSnapshot().hit).toBeNull();
  expect(controller.getSnapshot().breakpoints).toEqual([2]);
  controller.replay();
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().hit).toEqual({ line: 2, cursor: 2 });
});

test('changing rate or breakpoint during playback leaves one schedule and paused stays paused', async () => {
  vi.useFakeTimers();
  const { controller } = setup();
  await controller.execute(source, 'c', []);
  controller.play();
  controller.setRate(4);
  controller.setRate(2);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(controller.getSnapshot().view.cursor).toBe(1);
  controller.toggleBreakpoint(2);
  expect(vi.getTimerCount()).toBe(0);
  controller.play();
  await vi.advanceTimersByTimeAsync(250);
  expect(controller.getSnapshot().hit?.cursor).toBe(2);
  controller.setRate(4);
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().view.cursor).toBe(2);
  controller.clearBreakpoints();
  controller.play();
  await vi.advanceTimersByTimeAsync(250);
  expect(controller.getSnapshot().view.cursor).toBe(4);
});

test('input invalidation and rerun retain marks; edited source or language clears stale mapping', async () => {
  const { controller } = setup();
  controller.toggleBreakpoint(2);
  controller.toggleBreakpoint(99);
  controller.toggleBreakpoint(1.5);
  await controller.execute(source, 'c', []);
  controller.invalidate();
  expect(controller.getSnapshot().breakpoints).toEqual([2]);
  expect(controller.getSnapshot().view.state).toBeNull();
  await controller.execute(source, 'c', [2]);
  expect(controller.getSnapshot().breakpoints).toEqual([2]);
  controller.setSource('\n' + source, 'c');
  expect(controller.getSnapshot().breakpoints).toEqual([]);
  expect(controller.getSnapshot().view.state).toBeNull();
  expect(controller.getSnapshot().breakpointNotice).toContain('原行断点已清除');
  controller.toggleBreakpoint(3);
  controller.setSource('\n' + source, 'cpp');
  expect(controller.getSnapshot().breakpoints).toEqual([]);
});

test('late execution and stale playback callbacks cannot revive invalidated debugging state', async () => {
  vi.useFakeTimers();
  const { controller, execute } = setup();
  let resolve!: (value: ReturnType<typeof sample>) => void;
  execute.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const pending = controller.execute(source, 'c', []);
  controller.toggleBreakpoint(2);
  controller.setSource('int main(){return 0;}', 'c');
  resolve(sample());
  await pending;
  expect(controller.getSnapshot().result).toBeNull();
  expect(controller.getSnapshot().breakpoints).toEqual([]);
  await controller.execute(source, 'c', []);
  controller.play();
  controller.invalidate();
  await vi.advanceTimersByTimeAsync(2000);
  expect(controller.getSnapshot().view.state).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
