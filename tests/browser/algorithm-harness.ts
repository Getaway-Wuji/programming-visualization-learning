import { AlgorithmExecutionClient, algorithmRequest } from '../../web/src/engine/algorithm-client';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import type { AlgorithmResult } from '../../web/src/engine/algorithm-protocol';

const client = new AlgorithmExecutionClient();
const player = new AlgorithmPlayer();
let accepted: AlgorithmResult | null = null;
const api = {
  build: engineBuild,
  async run(source: string, language: 'c' | 'cpp', input: number[] = []) {
    player.invalidate();
    accepted = null;
    const request = algorithmRequest(source, language, input);
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
    algorithmTest: typeof api;
  }
}
window.algorithmTest = api;
