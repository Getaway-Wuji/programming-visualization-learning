// Real compiled WASM cache, controlled Worker transport; this does not prove an interpreted result.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { memoryModuleStore } from '../../web/src/engine/memory-module';
import { MemoryBugClient, bugRequest } from '../../web/src/memory-bugs/protocol';
import { memoryBugQuestions } from '../../web/src/memory-bugs/content';

test('production memory bug client reuses the prepared singleton and creates fresh Workers under its original second', async () => {
  const wasm = new Uint8Array(readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm'));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(wasm, {
        headers: { 'content-type': 'application/wasm' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const workers: { terminate: ReturnType<typeof vi.fn>; sent?: { remainingMs: number } }[] = [];
  class ControlledWorker {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    terminate = vi.fn();
    sent?: { remainingMs: number };
    constructor() {
      workers.push(this);
    }
    postMessage(message: { remainingMs: number }) {
      this.sent = message;
    }
  }
  vi.stubGlobal('Worker', ControlledWorker);
  const client = new MemoryBugClient();
  try {
    await memoryModuleStore.load(new AbortController().signal, () => {});
    expect(fetcher).toHaveBeenCalledOnce();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const question = memoryBugQuestions[0]!;
    const request = bugRequest(
      question,
      question.solutionSource,
      question.tests[0]!.caseKey,
      'prepared-memory',
    );
    const pending = client
      .execute(request, performance.now())
      .catch((error: Error) => error.message);
    for (let i = 0; i < 50 && !workers[0]?.sent; i++) await Promise.resolve();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.sent!.remainingMs).toBeGreaterThan(0);
    expect(workers[0]!.sent!.remainingMs).toBeLessThanOrEqual(1000);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe('E_DEADLINE');
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    const second = client
      .execute(request, performance.now())
      .catch((error: Error) => error.message);
    for (let i = 0; i < 50 && !workers[1]?.sent; i++) await Promise.resolve();
    expect(workers).toHaveLength(2);
    expect(workers[1]).not.toBe(workers[0]);
    client.cancel();
    expect(await second).toBe('E_CANCELLED');
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    client.cancel();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
