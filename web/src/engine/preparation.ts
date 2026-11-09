import { claimEngineSlot } from './module';
import { preparationAssets } from './preparation-assets';

export type PreparationEngine =
  | 'c'
  | 'c6'
  | 'practice'
  | 'memory'
  | 'algorithm'
  | 'advanced'
  | 'python'
  | 'java'
  | 'cpp'
  | 'rust'
  | 'mysql';

export type PreparationFailureCode =
  'E_PREPARATION_CANCELLED' | 'E_PREPARATION_TIMEOUT' | 'E_MODULE_LOAD' | 'E_WORKER_LOAD';

export class EnginePreparationFailure extends Error {
  constructor(public readonly code: PreparationFailureCode) {
    super(code);
  }
}

const preparationLimitMs = 120_000;

async function cacheWorker(url: string, signal: AbortSignal, guard: () => void) {
  guard();
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      mode: 'same-origin',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'default',
    });
  } catch {
    guard();
    throw new EnginePreparationFailure('E_WORKER_LOAD');
  }
  guard();
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (
    !response.ok ||
    response.redirected ||
    (mime !== 'text/javascript' && mime !== 'application/javascript') ||
    !response.body
  )
    throw new EnginePreparationFailure('E_WORKER_LOAD');
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      guard();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
    }
  } catch {
    guard();
    throw new EnginePreparationFailure('E_WORKER_LOAD');
  } finally {
    reader.releaseLock();
  }
  if (!bytes) throw new EnginePreparationFailure('E_WORKER_LOAD');
}

/** Explicit resource initialization only. Execution keeps its original, separate 1000ms budget. */
export function prepareEngine(engine: PreparationEngine, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new EnginePreparationFailure('E_PREPARATION_CANCELLED'));
  const started = performance.now();
  return new Promise<void>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let release = () => {};
    const timer = setTimeout(
      () => finish(new EnginePreparationFailure('E_PREPARATION_TIMEOUT')),
      preparationLimitMs,
    );
    const finish = (failure?: EnginePreparationFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      release();
      controller.abort();
      if (failure) reject(failure);
      else resolve();
    };
    const cancel = () => finish(new EnginePreparationFailure('E_PREPARATION_CANCELLED'));
    const guard = () => {
      if (settled || signal.aborted || controller.signal.aborted)
        throw new EnginePreparationFailure('E_PREPARATION_CANCELLED');
      if (performance.now() - started >= preparationLimitMs)
        throw new EnginePreparationFailure('E_PREPARATION_TIMEOUT');
    };
    signal.addEventListener('abort', cancel, { once: true });
    release = claimEngineSlot(cancel);
    if (settled) {
      release();
      return;
    }
    void (async () => {
      guard();
      const assets = await preparationAssets(engine);
      guard();
      for (const worker of assets.workers) await cacheWorker(worker, controller.signal, guard);
      await assets.store.load(controller.signal, guard);
      guard();
      finish();
    })().catch((error: unknown) => {
      finish(
        error instanceof EnginePreparationFailure
          ? error
          : new EnginePreparationFailure(
              error instanceof Error && error.message === 'E_CANCELLED'
                ? 'E_PREPARATION_CANCELLED'
                : 'E_MODULE_LOAD',
            ),
      );
    });
  });
}
