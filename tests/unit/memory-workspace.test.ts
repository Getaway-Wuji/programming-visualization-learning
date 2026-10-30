import { afterEach, expect, test, vi } from 'vitest';
import { MemoryWorkspaceController } from '../../web/src/memory/controller';
import { MemoryExecutionClient } from '../../web/src/engine/memory-client';
import { fixture } from './memory-fixture';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup() {
  const client = new MemoryExecutionClient();
  const execute = vi.spyOn(client, 'execute').mockResolvedValue(fixture());
  return { client, execute, controller: new MemoryWorkspaceController(client) };
}
test('one accepted result supports seek, reverse and replay without another execution', async () => {
  vi.useFakeTimers();
  const { controller, execute } = setup();
  await controller.execute('source', 'c', []);
  const initial = controller.getSnapshot().view.state;
  controller.seek(3);
  expect(controller.getSnapshot().view.state!.objects[0].cells[0].value).toBe(7);
  controller.seek(0);
  expect(controller.getSnapshot().view.state).toEqual(initial);
  controller.replay();
  await vi.advanceTimersByTimeAsync(500);
  expect(controller.getSnapshot().view.cursor).toBe(1);
  expect(execute).toHaveBeenCalledTimes(1);
  controller.invalidate();
});
test('source/input invalidation discards a pending late success', async () => {
  const { controller, execute } = setup();
  let resolve!: (value: ReturnType<typeof fixture>) => void;
  execute.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = controller.execute('old', 'c', []);
  controller.invalidate();
  resolve(fixture());
  await pending;
  expect(controller.getSnapshot().result).toBeNull();
  expect(controller.getSnapshot().status).toBe('idle');
});
test('pause, speed changes and restart keep a single timer and invalidation stops it', async () => {
  vi.useFakeTimers();
  const { controller } = setup();
  await controller.execute('source', 'c', []);
  controller.play();
  controller.setRate(4);
  controller.play();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(125);
  expect(controller.getSnapshot().view.cursor).toBe(1);
  controller.pause();
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().view.cursor).toBe(1);
  controller.play();
  controller.invalidate();
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().view.state).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
test('execution failure clears the prior visible state and can recover with a fresh run', async () => {
  const { controller, execute } = setup();
  await controller.execute('a', 'c', []);
  controller.seek(3);
  execute.mockRejectedValueOnce(new Error('E_CANCELLED'));
  await controller.execute('b', 'c', []);
  expect(controller.getSnapshot().view.state).toBeNull();
  expect(controller.getSnapshot().error).toBe('E_CANCELLED');
  await controller.execute('c', 'c', []);
  expect(controller.getSnapshot().view.cursor).toBe(0);
  expect(controller.getSnapshot().error).toBe('');
});
