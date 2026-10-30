import { expect, test } from 'vitest';
import { fixture } from './memory-fixture';
import {
  frameBindings,
  bindingValues,
  sourceLine,
  stackTransition,
} from '../../web/src/stack/presentation';
import { parseStackInput } from '../../web/src/stack/examples';
import { MemoryPlayer } from '../../web/src/engine/memory-player';

function setup() {
  const result = fixture();
  const player = new MemoryPlayer();
  player.accept(result);
  player.seek(3);
  return { result, state: player.snapshot().state! };
}
test('parameter classification follows declaration nodes and keeps shadowed locals distinct', () => {
  const { result, state } = setup();
  const frame = state.frames[0];
  const local = state.objects[0];
  frame.scopeIds.push('s2');
  state.scopes[0].objectIds = ['o2'];
  state.scopes.push({ id: 's2', frameId: frame.id, nodeId: 'n2', objectIds: ['o1'], aliases: [] });
  local.scopeId = 's2';
  result.nodeMap.push({ nodeId: 'n5', kind: 'parameter', byteRange: { start: 0, end: 1 } });
  state.objects.push({
    ...local,
    id: 'o2',
    declarationNodeId: 'n5',
    scopeId: 's1',
    name: 'x',
    cells: [{ byteOffset: 0, value: 5 }],
  });
  const bindings = frameBindings(frame, state, result);
  expect(bindings.map((value) => [value.kind, value.name, value.object.id])).toEqual([
    ['local', 'x', 'o1'],
    ['parameter', 'x', 'o2'],
  ]);
});
test('same-name recursive frames select their own live scopes and objects', () => {
  const { result, state } = setup();
  const parent = state.frames[0];
  const frame = {
    ...parent,
    id: 'f2',
    parentFrameId: 'f1',
    functionName: parent.functionName,
    scopeIds: ['s2'],
  };
  state.frames.push(frame);
  state.scopes.push({ ...state.scopes[0], id: 's2', frameId: 'f2', objectIds: ['o2'] });
  state.objects.push({
    ...state.objects[0],
    id: 'o2',
    frameId: 'f2',
    scopeId: 's2',
    cells: [{ byteOffset: 0, value: 9 }],
  });
  expect(bindingValues(frameBindings(parent, state, result)[0], state, result)).toBe('x: 7');
  expect(bindingValues(frameBindings(frame, state, result)[0], state, result)).toBe('x: 9');
});
test('an array alias reads the caller object without allocating or copying its storage', () => {
  const { result, state } = setup();
  const object = state.objects[0];
  object.name = 'values';
  object.length = 2;
  object.byteLength = 8;
  object.cells.push({ byteOffset: 4, value: 2 });
  const frame = { ...state.frames[0], id: 'f2', parentFrameId: 'f1', scopeIds: ['s2'] };
  state.frames.push(frame);
  state.scopes.push({
    id: 's2',
    frameId: 'f2',
    nodeId: 'n2',
    objectIds: [],
    aliases: [{ name: 'a', objectId: object.id }],
  });
  const binding = frameBindings(frame, state, result)[0];
  expect(binding.kind).toBe('alias');
  expect(binding.object).toBe(object);
  expect(bindingValues(binding, state, result)).toBe('a[0]: 7；a[1]: 2');
  object.cells[0].value = -3;
  expect(bindingValues(binding, state, result)).toContain('a[0]: -3');
});
test('frame transitions use IDs and reverse restores the actual returned frame', () => {
  const result = fixture();
  const player = new MemoryPlayer();
  player.accept(result);
  player.seek(3);
  const before = player.snapshot().state!;
  player.seek(4);
  const after = player.snapshot().state!;
  expect(stackTransition(after, before).returned.map((frame) => frame.id)).toEqual(['f1']);
  expect(frameBindings(before.frames[0], after, result)).toEqual([]);
  player.seek(3);
  expect(player.snapshot().state).toEqual(before);
  expect(
    frameBindings(before.frames[0], player.snapshot().state!, result)[0].object.cells[0].value,
  ).toBe(7);
});
test('call positions use the original UTF8 source with CRLF and multibyte characters', () => {
  const { result } = setup();
  const source = '// 中😀\r\nint main(){return 0;}';
  result.nodeMap[0].byteRange.start = new TextEncoder().encode('// 中😀\r\n').length;
  expect(sourceLine(source, result.nodeMap[0].nodeId, result)).toBe(2);
  expect(sourceLine(source, null, result)).toBeNull();
});
test('recursive example inputs reject missing values and unsupported ranges before execution', () => {
  expect(parseStackInput('hanoi', '0')).toMatchObject({ valid: true, input: [0] });
  expect(parseStackInput('hanoi', '5').valid).toBe(true);
  for (const input of ['', '6', '-1', '2.5', '1e0'])
    expect(parseStackInput('hanoi', input).valid).toBe(false);
  expect(parseStackInput('quicksort', '4, 2, -9, 1, 5')).toMatchObject({
    valid: true,
    input: [4, 2, -9, 1, 5],
  });
  for (const input of ['', ',1,2,3,4', '1 2 3 4', '1 2 3 4 1000'])
    expect(parseStackInput('quicksort', input).valid).toBe(false);
});
