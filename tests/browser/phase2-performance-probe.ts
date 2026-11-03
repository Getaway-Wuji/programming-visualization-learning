/* eslint-disable @typescript-eslint/no-explicit-any -- Passive browser observation carries version-dependent metadata. */
// Passive measurement only. No product calls, altered delays or synthetic state.
export function installPhase2Probe() {
  const scope = window as typeof window & { phase2Perf: any };
  const audit: any = {
    compilations: 0,
    workers: [],
    intents: [],
    raf: [],
    ticks: [],
    commits: [],
    longTasks: [],
    configuration: null,
    recording: false,
    lastTick: null,
    lastCursor: null,
  };
  scope.phase2Perf = audit;
  const compile = WebAssembly.compile.bind(WebAssembly);
  WebAssembly.compile = (...args) => {
    audit.compilations++;
    return compile(...args);
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    record: any;
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      const row: any = {
        url: String(args[0]),
        createdAt: performance.now(),
        terminatedAt: null,
        sentAt: null,
        receivedAt: null,
        ok: null,
        response: null,
        request: null,
      };
      this.record = row;
      audit.workers.push(row);
      this.addEventListener('message', ({ data }) => {
        row.receivedAt = performance.now();
        row.ok = data?.ok;
        row.technical = data?.technical;
        row.wasmPages = data?.wasmPages;
        if (data?.buffer instanceof ArrayBuffer) row.response = data.buffer;
      });
    }
    postMessage(data: any, options?: any) {
      this.record.sentAt = performance.now();
      this.record.kind = data?.kind ?? 'extended-execute';
      this.record.remainingMs = data?.remainingMs;
      if (data?.buffer instanceof ArrayBuffer) this.record.request = data.buffer.slice(0);
      return super.postMessage(data, options);
    }
    terminate() {
      this.record.terminatedAt = performance.now();
      return super.terminate();
    }
  };
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) =>
    timeout(
      typeof callback === 'function'
        ? function (...values: any[]) {
            if (audit.recording && delay === 125) {
              audit.lastTick = performance.now();
              audit.ticks.push(audit.lastTick);
            }
            return callback(...values);
          }
        : callback,
      delay,
      ...args,
    )) as typeof setTimeout;
  document.addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement).closest('button'),
        config = audit.configuration;
      if (event.isTrusted && config && button?.textContent?.trim() === config.runLabel)
        audit.intents.push({
          start: performance.now(),
          end: null,
          workersBefore: audit.workers.length,
          compilationsBefore: audit.compilations,
          seenBusy: false,
          queued: false,
        });
    },
    true,
  );
  const inspect = () => {
    const config = audit.configuration;
    if (!config) return;
    const readState = () =>
      config.currentC6
        ? [...document.querySelectorAll('.c6-result-pane h2')].some(
            (e) => e.textContent === '四组全部通过',
          ) &&
          [...document.querySelectorAll('[role="status"]')].some(
            (e) => e.textContent === '本次判题记录已保存。',
          )
          ? 'passed'
          : null
        : document.querySelector(config.root)?.getAttribute(config.stateAttribute);
    const state = readState();
    const intent = audit.intents.at(-1);
    if (intent && intent.end === null) {
      if (['running', 'preparing', 'submitting'].includes(state ?? '')) intent.seenBusy = true;
      const workers = audit.workers.slice(intent.workersBefore),
        responded = workers.some((w: any) => w.receivedAt !== null);
      if (!intent.queued && responded && config.terminalStates.includes(state)) {
        intent.queued = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const current = readState();
            if (config.terminalStates.includes(current)) {
              intent.end = performance.now();
              intent.state = current;
              intent.visibility = document.visibilityState;
              intent.focus = document.hasFocus();
              intent.viewport = [innerWidth, innerHeight];
            } else intent.queued = false;
          }),
        );
      }
    }
    if (audit.recording) {
      const slider = document.querySelector<HTMLInputElement>(config.slider),
        cursor = slider ? Number(slider.value) : null;
      if (cursor !== null && cursor !== audit.lastCursor) {
        const now = performance.now(),
          start = audit.lastTick;
        audit.commits.push({
          at: now,
          cursor,
          tickStart: start,
          duration: start === null ? null : now - start,
          visibility: document.visibilityState,
          focus: document.hasFocus(),
        });
        audit.lastCursor = cursor;
      }
    }
  };
  const watch = () =>
    new MutationObserver(inspect).observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  if (document.documentElement) watch();
  else document.addEventListener('DOMContentLoaded', watch, { once: true });
  try {
    new PerformanceObserver((list) => {
      for (const row of list.getEntries())
        audit.longTasks.push({ start: row.startTime, duration: row.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* Browser support is recorded by empty observations. */
  }
  const raf = (at: number) => {
    if (audit.recording) audit.raf.push(at);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

export function readPhase2Probe(includePackets = true) {
  const audit = (window as typeof window & { phase2Perf: any }).phase2Perf;
  return {
    ...audit,
    workers: audit.workers.map((row: any) => {
      let request: any = null,
        result: any = null;
      try {
        if (includePackets && row.request)
          request = JSON.parse(new TextDecoder().decode(row.request));
        if (includePackets && row.response)
          result = JSON.parse(new TextDecoder().decode(row.response));
      } catch {
        /* Raw malformed bytes remain a failed observation. */
      }
      return {
        ...row,
        request: undefined,
        response: undefined,
        requestMetadata: request
          ? {
              identity: request.identity,
              language: request.language,
              sourceBytes: new TextEncoder().encode(request.source?.text ?? request.source ?? '')
                .length,
              input: request.input,
            }
          : null,
        resultMetadata: result
          ? {
              producer: result.producer,
              engine: result.engine ?? result.engineRef,
              identity: result.identity,
              terminal: result.terminal,
              judgeStatus: result.judgeVersion ? result.status : undefined,
              caseCount: result.cases?.length,
              stats: result.stats,
              steps: result.trace?.steps?.length,
              completeness: result.trace?.completeness,
            }
          : null,
        responseBytes: row.response?.byteLength ?? null,
      };
    }),
    resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
    environment: {
      userAgent: navigator.userAgent,
      visible: document.visibilityState,
      focus: document.hasFocus(),
      viewport: [innerWidth, innerHeight],
      devicePixelRatio,
      renderer: null,
      rendererBoundary:
        'No extra WebGL context created by measurement; native host GPU metadata is separate.',
    },
  };
}
