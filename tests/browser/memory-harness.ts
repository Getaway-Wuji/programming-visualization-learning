import { MemoryExecutionClient, memoryRequest } from '../../web/src/engine/memory-client';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import type { MemoryResult } from '../../web/src/engine/memory-protocol';

const client = new MemoryExecutionClient();
const player = new MemoryPlayer();
let accepted: MemoryResult | null = null;
const api = {
  build: engineBuild,
  async run(source: string, language: 'c' | 'cpp', input: number[] = []) {
    player.invalidate();
    accepted = null;
    const request = memoryRequest(source, language, input);
    const started = performance.now();
    const result = await client.execute(request);
    accepted = result;
    player.accept(result);
    return { result, elapsedMs: performance.now() - started, inspect: client.inspect() };
  },
  replay() {
    if (!accepted?.trace) throw new Error('No real trace');
    const first = player.snapshot();
    const samples = [];
    for (let cursor = 0; cursor <= accepted.trace.steps.length; cursor++) {
      player.seek(cursor);
      const state = player.snapshot();
      if (state.stepKind === 'function.return') {
        samples.push({ cursor, framesAfter: state.state!.frames.length });
        player.seek(cursor - 1);
        const prior = player.snapshot();
        if (prior.state!.frames.length !== state.state!.frames.length + 1)
          throw new Error('Returned frame not restored');
        player.seek(cursor);
      }
    }
    const last = player.snapshot();
    for (let cursor = accepted.trace.steps.length - 1; cursor >= 0; cursor--) player.seek(cursor);
    const restored = JSON.stringify(player.snapshot().state) === JSON.stringify(first.state);
    return { restored, samples, last, first, result: accepted.terminal };
  },
  seek(cursor: number) {
    player.seek(cursor);
    return player.snapshot();
  },
  invalidate() {
    client.invalidate();
    player.invalidate();
    accepted = null;
  },
  cancel() {
    client.cancel();
  },
  inspect() {
    return client.inspect();
  },
};
declare global {
  interface Window {
    memoryTest: typeof api;
  }
}
window.memoryTest = api;
