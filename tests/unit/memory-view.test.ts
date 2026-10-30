import { expect, test } from 'vitest';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import {
  memorySlots,
  pointerPresentation,
  virtualAddress,
} from '../../web/src/memory/presentation';
import { fixture } from './memory-fixture';

function data() {
  const result = fixture();
  const player = new MemoryPlayer();
  player.accept(result);
  player.seek(3);
  return { result, player, state: player.snapshot().state! };
}
test('layout uses exact sparse values, explicit uninitialized slots and addresses above four GiB', () => {
  const { result, state } = data();
  const object = state.objects[0];
  object.baseAddress = 5_242_884_096;
  object.length = 262144;
  object.byteLength = object.length * 4;
  object.zeroInitialized = true;
  object.cells = [
    { byteOffset: 0, value: null },
    { byteOffset: 1048572, value: -7 },
  ];
  expect(memorySlots(object, result.types)).toHaveLength(16);
  expect(memorySlots(object, result.types)[0].value).toBeNull();
  expect(memorySlots(object, result.types)[1].value).toBe(0);
  expect(memorySlots(object, result.types, 16383).at(-1)).toMatchObject({
    value: -7,
    byteOffset: 1048572,
  });
  expect(virtualAddress(object.baseAddress)).toBe('0x138801000');
});
test('typed zero pointer stays distinct from an uninitialized pointer', () => {
  const { result, state } = data();
  const object = state.objects[0];
  object.typeName = 'int*';
  object.byteLength = 8;
  object.cells = [];
  object.zeroInitialized = true;
  expect(memorySlots(object, result.types)[0].value).toEqual({
    objectId: null,
    byteOffset: 0,
    lowerBound: 0,
    upperBound: 0,
    pointeeType: 'int',
  });
  object.zeroInitialized = false;
  expect(memorySlots(object, result.types)[0].value).toBeNull();
});
test('reference labels retain object identity and distinguish null, one-past and ended objects', () => {
  const { state } = data();
  const pointer = {
    objectId: 'o1',
    byteOffset: 0,
    lowerBound: 0,
    upperBound: 4,
    pointeeType: 'int',
  };
  expect(pointerPresentation(pointer, state).kind).toBe('valid');
  expect(pointerPresentation({ ...pointer, objectId: null, upperBound: 0 }, state).kind).toBe(
    'null',
  );
  expect(pointerPresentation({ ...pointer, byteOffset: 4 }, state).kind).toBe('one-past');
  state.objects[0].alive = false;
  expect(pointerPresentation(pointer, state)).toMatchObject({
    kind: 'dangling',
    address: '0x1000',
  });
});
test('ended values disappear and full reverse recovery restores their original slots', () => {
  const { player, result, state } = data();
  expect(memorySlots(state.objects[0], result.types)[0].value).toBe(7);
  player.seek(4);
  expect(memorySlots(player.snapshot().state!.objects[0], result.types)).toEqual([]);
  player.seek(3);
  expect(player.snapshot().state).toEqual(state);
});
