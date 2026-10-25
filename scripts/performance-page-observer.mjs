/* global window, document, performance, PerformanceObserver, MutationObserver, requestAnimationFrame, getComputedStyle, navigator, location, innerWidth, innerHeight, devicePixelRatio, screen, indexedDB */
// Shared real-page observation; no execution, preparation or clock replacement.
/** Installed before product code. Readiness timestamps come from the page's
 * monotonic clock; Playwright polling never supplies the measurement endpoint. */
export function installPageProbe({ definition, observationWindowMs, requiredStates }) {
  performance.setResourceTimingBufferSize(2000);
  const engine = (window.__navigationModuleAudit = {
    compilations: 0,
    streamingCompilations: 0,
    workers: [],
  });
  const compile = WebAssembly.compile.bind(WebAssembly);
  WebAssembly.compile = (...args) => {
    engine.compilations++;
    return compile(...args);
  };
  const streaming = WebAssembly.compileStreaming.bind(WebAssembly);
  WebAssembly.compileStreaming = (...args) => {
    engine.streamingCompilations++;
    return streaming(...args);
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      engine.workers.push({ url: String(args[0]) });
    }
  };
  const audit = (window.__navigationPerformanceAudit = {
    definition,
    observationWindowMs,
    requiredStates,
    shell: null,
    content: null,
    complete: null,
    lastState: null,
    longTasks: [],
    visibilityChanges: [{ at: performance.now(), state: document.visibilityState }],
  });
  const pending = new Set();
  function available(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    );
  }
  function enabledButton(scope, text) {
    return [...scope.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === text && !button.disabled && available(button),
    );
  }
  function state() {
    const shell = document.querySelector('.app-shell');
    const statuses = Object.fromEntries(
      ['storage', 'reading', 'practice', 'reward', 'goal', 'profile'].map((name) => [
        name,
        shell?.getAttribute(`data-learning-${name}-status`) ?? null,
      ]),
    );
    const target = document.querySelector(definition.selector);
    const heading = document.querySelector(`[data-page-id="${definition.id}"] h1`);
    const correctRoute = location.hash === `#${definition.route}`;
    const baseShell =
      correctRoute &&
      available(target) &&
      available(heading) &&
      heading.textContent.trim().length > 0;
    const saveStatuses = [...document.querySelectorAll('[data-testid="learning-save-status"]')].map(
      (element) => element.getAttribute('data-save-status'),
    );
    const consumerReady = requiredStates.every((name) => statuses[name] === 'ready');
    let coreReady = false;
    let workspaceReady = null;
    let sourceLength = null;
    let sourceReadOnly = null;
    let blockCount = null;
    let runEnabled = null;
    if (definition.workspace) {
      const panel = document.querySelector(
        definition.workspace === 'practice'
          ? '[data-testid="practice-execution"]'
          : '[data-testid="case-execution"]',
      );
      const sources = [
        ...(panel?.querySelectorAll('textarea[aria-label="当前执行的 C 代码"]') ?? []),
      ];
      sourceLength = Math.max(0, ...sources.map((element) => element.value.trim().length));
      sourceReadOnly = sources.length === 1 && sources.every((element) => element.readOnly);
      blockCount =
        definition.workspace === 'practice'
          ? (panel?.querySelectorAll('[aria-label="积木列表"] option[value]:not([value=""])')
              .length ?? 0)
          : null;
      runEnabled = !!enabledButton(
        panel ?? document,
        definition.workspace === 'practice' ? '提交练习' : '运行示例',
      );
      const inputsReady =
        definition.workspace === 'practice'
          ? available(panel?.querySelector('[aria-label="积木工作区"] .blocklySvg')) &&
            blockCount > 0 &&
            !!panel?.querySelector('[aria-label="积木列表"]:not(:disabled)') &&
            !!panel?.querySelector('.blocklyBlockCanvas .blocklyPath')
          : [...(panel?.querySelectorAll('[data-testid^="input-field-"]') ?? [])].some(
              (element) => available(element) && !element.disabled,
            );
      workspaceReady =
        sourceLength > 0 &&
        sourceReadOnly &&
        runEnabled &&
        inputsReady &&
        panel?.getAttribute('data-state') === 'ready';
      coreReady = workspaceReady;
    } else if (definition.id === 'PAGE-01') {
      const link = document.querySelector('[data-testid="home-continue-learning"]');
      coreReady =
        !!link?.getAttribute('href')?.includes('/lessons/') &&
        document.querySelector('[data-testid="learning-course-progress"]')?.textContent.trim() ===
          '0/6' &&
        document.querySelector('[data-testid="learning-level"]')?.getAttribute('data-level') ===
          '1' &&
        document
          .querySelector('[data-testid="daily-goal-summary"]')
          ?.getAttribute('data-goal-state') === 'preview';
    } else if (definition.id === 'PAGE-02') {
      coreReady =
        document.querySelector('[data-testid="course-reading"]')?.getAttribute('data-state') ===
          'ready' && document.querySelectorAll('[data-course-lesson] a[href]').length === 6;
    } else if (definition.id === 'PAGE-03') {
      const lesson = document.querySelector('[data-testid="lesson-reading"]');
      coreReady =
        lesson?.getAttribute('data-state') === 'ready' &&
        [...(lesson?.querySelectorAll('pre.sample-source') ?? [])].some(
          (element) => element.textContent.trim().length > 0,
        ) &&
        !!enabledButton(lesson ?? document, '开始本节学习') &&
        !!enabledButton(lesson ?? document, '确认已学习');
    } else if (definition.id === 'PAGE-05') {
      coreReady =
        document.querySelectorAll('[data-page-id="PAGE-05"] a[href*="visualize"]').length === 7 &&
        document.querySelector('[data-testid="content-sample"]')?.getAttribute('data-state') ===
          'ready';
    } else if (definition.id === 'PAGE-07') {
      const panel = document.querySelector(
        '#settings-panel[role="tabpanel"][aria-labelledby="tab-data"]',
      );
      const tabs = [...document.querySelectorAll('.settings-nav [role="tab"]')];
      coreReady =
        available(panel) &&
        available(document.querySelector('#tab-data[role="tab"][aria-selected="true"]')) &&
        tabs.length === 3 &&
        tabs.every((tab) => available(tab) && !tab.disabled) &&
        panel.querySelector('h2')?.textContent.trim() === '本地数据与保存' &&
        panel.querySelectorAll('.info-item').length === 3 &&
        [...panel.querySelectorAll('.info-item')].every(
          (item) => available(item) && item.querySelector('dd')?.textContent.trim().length > 0,
        ) &&
        !!enabledButton(panel, '清除本地数据');
    }
    const blockingOverlay = [...document.querySelectorAll('dialog[open], [aria-busy="true"]')].some(
      (element) => available(element),
    );
    return {
      at: performance.now(),
      statuses,
      requiredConsumerStatesConfirmed: consumerReady,
      correctRoute,
      saveStatuses,
      shellReady: baseShell,
      contentReady: baseShell && consumerReady && !blockingOverlay,
      completeReady: baseShell && consumerReady && coreReady && !blockingOverlay,
      workspaceReady,
      sourceLength,
      sourceReadOnly,
      blockCount,
      runEnabled,
      coreReady,
      blockingOverlay,
      visibility: document.visibilityState,
    };
  }
  function inspect() {
    audit.lastState = state();
    for (const [key, predicate] of [
      ['shell', 'shellReady'],
      ['content', 'contentReady'],
      ['complete', 'completeReady'],
    ]) {
      if (audit[key] || pending.has(key) || !audit.lastState[predicate]) continue;
      const readyAt = performance.now();
      pending.add(key);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const current = state();
          pending.delete(key);
          audit.lastState = current;
          if (!current[predicate]) return;
          audit[key] = {
            readyAt,
            paintAt: performance.now(),
            stateAtPaint: current,
            proof:
              'Necessary real DOM and public consumer-state attributes, still ready after two rAF callbacks',
          };
        }),
      );
    }
  }
  function begin() {
    new MutationObserver(inspect).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    inspect();
  }
  if (document.documentElement) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
  document.addEventListener('visibilitychange', () => {
    audit.visibilityChanges.push({ at: performance.now(), state: document.visibilityState });
  });
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
}

export function readPageProbe() {
  const gl = document.createElement('canvas').getContext('webgl');
  const rendererExtension = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = rendererExtension
    ? gl.getParameter(rendererExtension.UNMASKED_RENDERER_WEBGL)
    : null;
  const vendor = rendererExtension
    ? gl.getParameter(rendererExtension.UNMASKED_VENDOR_WEBGL)
    : null;
  return {
    ...window.__navigationPerformanceAudit,
    engine: window.__navigationModuleAudit,
    capturedAt: performance.now(),
    navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
    resources: performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      nextHopProtocol: entry.nextHopProtocol,
      deliveryType: entry.deliveryType ?? null,
      responseStatus: entry.responseStatus ?? null,
      workerStart: entry.workerStart,
    })),
    paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
    environment: {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      visualViewport: window.visualViewport
        ? {
            width: window.visualViewport.width,
            height: window.visualViewport.height,
            scale: window.visualViewport.scale,
          }
        : null,
      devicePixelRatio,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      screen: [screen.width, screen.height],
      hardwareConcurrency: navigator.hardwareConcurrency,
      webgl: { renderer, vendor, supported: !!gl },
      serviceWorkerControlled: !!navigator.serviceWorker?.controller,
      origin: location.origin,
    },
  };
}

/** Read only after the timing endpoint. This cannot create/repair an archive or
 * write events, rewards, settings, or generated execution evidence. */
export async function readArchiveMetadata() {
  const names = [
    'meta',
    'settings',
    'avatar',
    'progress',
    'dailyFacts',
    'goals',
    'ledger',
    'receipts',
    'aliases',
  ];
  const available = await indexedDB.databases();
  if (!available.some((entry) => entry.name === 'c-viz-learning')) return { present: false };
  const db = await new Promise((resolveDb, rejectDb) => {
    const request = indexedDB.open('c-viz-learning');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolveDb(request.result);
    request.onerror = () => rejectDb(new Error(request.error?.name ?? 'IndexedDB open failed'));
  });
  try {
    const tx = db.transaction(names, 'readonly');
    const done = new Promise((resolveTx, rejectTx) => {
      tx.oncomplete = resolveTx;
      tx.onabort = () => rejectTx(new Error(tx.error?.name ?? 'IndexedDB read failed'));
    });
    const rows = await Promise.all(
      names.map(
        (name) =>
          new Promise((resolveRow, rejectRow) => {
            const store = tx.objectStore(name);
            const request = ['meta', 'settings', 'avatar'].includes(name)
              ? store.get('current')
              : store.count();
            request.onsuccess = () => resolveRow([name, request.result]);
            request.onerror = () => rejectRow(new Error(request.error?.name ?? 'IDB read failed'));
          }),
      ),
    );
    await done;
    const result = Object.fromEntries(rows);
    return {
      present: true,
      stores: Array.from(db.objectStoreNames),
      meta: result.meta
        ? {
            schemaVersion: result.meta.schemaVersion,
            dbVersion: result.meta.dbVersion,
            revision: result.meta.revision,
            timeZone: result.meta.timeZone,
            activePackageRef: result.meta.activePackageRef,
          }
        : null,
      settings: result.settings,
      avatar: result.avatar,
      collectionCounts: Object.fromEntries(names.slice(3).map((name) => [name, result[name]])),
    };
  } finally {
    db.close();
  }
}

export function fixedArchive(metadata) {
  return (
    metadata.present &&
    metadata.stores.length === 9 &&
    Object.values(metadata.collectionCounts).every((count) => count === 0) &&
    metadata.avatar?.presetId === 'avatar.basic.01' &&
    metadata.avatar?.accentColor === '#168A72' &&
    metadata.settings?.theme === 'system' &&
    metadata.settings?.reducedMotion === 'system' &&
    metadata.settings?.playbackRate === 1 &&
    metadata.settings?.goalTemplate?.targets.exercise === 1 &&
    metadata.settings?.goalTemplate?.targets.lesson === 1 &&
    metadata.settings?.goalTemplate?.targets.case === 0
  );
}

/** Network metadata is read after the page-owned readiness endpoint. A 304 is
 * conditional revalidation, while zero Resource Timing transfer alone is only
 * a candidate. Neither is relabelled as an unconditional cache hit. */
export function classifyPageCacheEvidence({
  origin,
  network,
  resources,
  serverRequests,
  mode,
  prewarm,
}) {
  const pathOf = (value) => {
    try {
      const url = new URL(value);
      return url.origin === origin ? url.pathname : null;
    } catch {
      return null;
    }
  };
  const completedServerRequests = serverRequests.filter((row) => Number.isFinite(row.finishMs));
  const revalidations = completedServerRequests.filter(
    (row) => row.status === 304 && row.conditionalEtag && row.responseBodyBytes === 0,
  );
  const revalidatedPaths = new Set(revalidations.map((row) => row.path));
  const reuseCandidates = network.filter((row) => {
    if (!pathOf(row.url)) return false;
    return (
      row.fromDiskCache === true ||
      row.memoryCache === true ||
      (row.responseCompletedObserved === true && row.fromCache === true)
    );
  });
  const directReuse = reuseCandidates
    .filter((row) => {
      const path = pathOf(row.url);
      return (
        !revalidatedPaths.has(path) &&
        row.actualNetworkStatus !== 304 &&
        row.status !== 304 &&
        !completedServerRequests.some((request) => request.path === path)
      );
    })
    .map((row) => ({
      url: row.url,
      source: row.fromDiskCache
        ? 'CDP fromDiskCache'
        : row.memoryCache
          ? 'CDP requestServedFromCache'
          : 'BiDi response.fromCache',
    }));
  const browserRevalidationObservations = network
    .filter((row) => row.actualNetworkStatus === 304 || row.status === 304)
    .map((row) => ({ url: row.url, status: row.actualNetworkStatus ?? row.status }));
  const timingOnlyCandidates = resources
    .filter((row) => pathOf(row.name) && row.transferSize === 0 && row.encodedBodySize > 0)
    .map((row) => row.name);
  const observedCacheSignal =
    directReuse.length > 0 ||
    revalidations.length > 0 ||
    reuseCandidates.length > 0 ||
    browserRevalidationObservations.length > 0 ||
    timingOnlyCandidates.length > 0;
  const confirmedWarm = directReuse.length > 0 || revalidations.length > 0;
  return {
    state: prewarm ? 'isolated cold prewarm' : mode,
    directReuse,
    conditionalRevalidations: revalidations,
    browserRevalidationObservations,
    timingOnlyCandidates,
    unconfirmedReuseCandidates: reuseCandidates
      .filter((row) => !directReuse.some((entry) => entry.url === row.url))
      .map((row) => row.url),
    confirmedWarm,
    confirmed: prewarm || mode === 'cold' ? !observedCacheSignal : confirmedWarm,
    interpretation:
      'Direct browser reuse requires an explicit cache flag and no corresponding completed server response in this exact navigation slice. Actual server 304 plus conditional ETag is revalidation. Zero Resource Timing transfer alone never proves warm cache. TLS connection reuse is not HTTP cache proof.',
  };
}
