/* global window, document, performance, PerformanceObserver, MutationObserver, requestAnimationFrame, innerHeight, innerWidth, navigator, devicePixelRatio, screen, location */
/** Metadata-only observation installed before the product loads. Does not call
 * product methods, decode an algorithm or modify a response/clock/deadline. */
export function installPerformanceObserver() {
  const audit = (window.__performanceAudit = {
    version: 1,
    intents: [],
    workers: [],
    longTasks: [],
    pageReady: null,
    buffers: [],
    compilations: [],
  });
  const originalCompile = WebAssembly.compile;
  WebAssembly.compile = async (...args) => {
    const observation = { start: performance.now(), end: null, succeeded: false };
    audit.compilations.push(observation);
    try {
      const module = await Reflect.apply(originalCompile, WebAssembly, args);
      observation.succeeded = true;
      return module;
    } finally {
      observation.end = performance.now();
    }
  };
  const modules = new WeakMap();
  let moduleCount = 0;
  const OriginalWorker = window.Worker;
  window.Worker = class ObservedWorker extends OriginalWorker {
    constructor(url, options) {
      super(url, options);
      const record = {
        url: String(url),
        createdAt: performance.now(),
        kind: null,
        sentAt: null,
        receivedAt: null,
        terminatedAt: null,
        responseBytes: null,
        ok: null,
      };
      audit.workers.push(record);
      this.addEventListener('message', (event) => {
        record.receivedAt = performance.now();
        record.ok = event.data?.ok ?? null;
        record.responseBytes = event.data?.buffer?.byteLength ?? null;
        record.technical = event.data?.technical ?? null;
        // Keep the same buffer reference, with no copy/parse on the timed path.
        if (event.data?.buffer)
          audit.buffers = [
            {
              workerIndex: audit.workers.indexOf(record),
              buffer: event.data.buffer,
            },
          ];
      });
      const send = this.postMessage.bind(this);
      this.postMessage = (...args) => {
        record.sentAt = performance.now();
        record.kind = args[0]?.kind ?? null;
        record.operationId = args[0]?.operationId ?? null;
        const module = args[0]?.module;
        if (module instanceof WebAssembly.Module) {
          if (!modules.has(module)) modules.set(module, ++moduleCount);
          record.moduleId = modules.get(module);
        }
        return send(...args);
      };
      const terminate = this.terminate.bind(this);
      this.terminate = () => {
        record.terminatedAt = performance.now();
        return terminate();
      };
    }
  };
  audit.longTaskObservationUnsupported =
    !PerformanceObserver.supportedEntryTypes?.includes('longtask');
  try {
    if (!audit.longTaskObservationUnsupported)
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          audit.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
  } catch {
    audit.longTaskObservationUnsupported = true;
  }
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('button, a');
      if (!button) return;
      const label = button.textContent.trim();
      if (
        ![
          '运行示例',
          '提交练习',
          '准备代码',
          '准备运行样例',
          '应用输入并准备',
          '查看本次复盘',
          '取消运行',
          '取消提交',
        ].includes(label)
      )
        return;
      audit.intents.push({
        label,
        at: performance.now(),
        trusted: event.isTrusted,
        end: null,
        state: null,
        paintVisible: null,
      });
    },
    true,
  );
  const pending = new WeakSet();
  const inspect = () => {
    const intent = audit.intents.at(-1);
    if (!intent || intent.end !== null || pending.has(intent)) return;
    const panel = document.querySelector(
      '[data-testid="case-execution"], [data-testid="practice-execution"]',
    );
    const state = panel?.getAttribute('data-state');
    const running = ['运行示例', '提交练习'].includes(intent.label);
    const preparing = ['准备代码', '准备运行样例', '应用输入并准备'].includes(intent.label);
    const terminal =
      running &&
      [
        'completed',
        'passed',
        'unmet',
        'failed',
        'cancelled',
        'resource-limit',
        'infrastructure-failure',
        'program-error',
        'rejected',
      ].includes(state);
    const ready = preparing && ['ready', 'failed'].includes(state);
    const review =
      intent.label === '查看本次复盘' &&
      location.hash.endsWith('/review') &&
      !!document.querySelector(
        '[data-page-id="PAGE-06"][data-mode="exercise-review"] [data-testid="trace-view"]',
      );
    const cancel =
      ['取消运行', '取消提交'].includes(intent.label) &&
      !['running', 'preparing'].includes(state) &&
      audit.workers.every((worker) => worker.terminatedAt !== null);
    if (!terminal && !ready && !review && !cancel) return;
    pending.add(intent);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const currentState = panel?.getAttribute('data-state');
        if (running && ['running', 'preparing'].includes(currentState)) {
          pending.delete(intent);
          return;
        }
        intent.end = performance.now();
        intent.state = currentState;
        const view = document.querySelector('[data-testid="trace-view"]');
        const bounds = view?.getBoundingClientRect();
        const controls = document.querySelector('[data-testid="player-controls"]');
        intent.cursor = controls?.getAttribute('data-cursor') ?? null;
        intent.length = controls?.getAttribute('data-length') ?? null;
        intent.paintViewport = { width: innerWidth, height: innerHeight };
        intent.paintBounds = bounds
          ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
          : null;
        const visibleWidth = bounds
          ? Math.max(0, Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0))
          : 0;
        const visibleHeight = bounds
          ? Math.max(0, Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0))
          : 0;
        intent.paintIntersection = { width: visibleWidth, height: visibleHeight };
        intent.paintVisible =
          !!bounds &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          visibleHeight >= Math.min(bounds.height, 160) * 0.75 &&
          visibleWidth >= Math.min(bounds.width, 240) * 0.75;
        intent.playable = !!document.querySelector(
          '[data-testid="player-controls"][data-length]:not([data-length="0"])',
        );
      }),
    );
  };
  const observe = () =>
    new MutationObserver(inspect).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });
}

export function readPerformanceAudit() {
  const audit = window.__performanceAudit;
  const workers = audit.workers.map((worker, index) => {
    const buffer = audit.buffers.find((entry) => entry.workerIndex === index)?.buffer;
    let metadata = worker.metadata;
    if (buffer && worker.kind === 'execute') {
      try {
        const result = JSON.parse(new TextDecoder().decode(buffer));
        metadata = {
          identity: result.identity,
          stats: result.stats,
          terminal: result.terminal.status,
          steps: result.trace?.steps.length,
          checkpoints: result.trace?.checkpoints.length,
          completeness: result.trace?.completeness,
        };
      } catch {
        metadata = { malformed: true };
      }
    }
    worker.metadata = metadata;
    return { ...worker, ...metadata };
  });
  audit.buffers = [];
  return {
    ...audit,
    buffers: undefined,
    workers,
    resources: performance.getEntriesByType('resource').map((entry) => ({
      url: entry.name,
      start: entry.startTime,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    })),
    navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
    environment: {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      devicePixelRatio,
      visibility: document.visibilityState,
      screen: [screen.width, screen.height],
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
}
