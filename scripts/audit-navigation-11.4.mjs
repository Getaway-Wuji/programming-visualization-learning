// Read existing navigation evidence only. This script never starts a browser or server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { workspaceDir } from './process.mjs';
import { qualifyPerformanceHost } from './performance-host.mjs';
import { classifyPageCacheEvidence, fixedArchive } from './performance-page-observer.mjs';
import { performancePages } from './performance-workloads.mjs';

const browsers = ['chrome', 'edge', 'firefox'];
const modes = ['cold', 'warm'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const relativePath = (path) => relative(workspaceDir, path).split(sep).join('/');
const allTrue = (object) => Object.values(object).every((value) => value === true);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const expectedStates = (pageId) => [
  'storage',
  'reading',
  'practice',
  ...(pageId === 'PAGE-01' ? ['reward', 'goal', 'profile'] : []),
  ...(pageId === 'PAGE-07' ? ['profile'] : []),
];

/** Recompute controls from the stored raw observations, without supplying a DOM
 * endpoint, changing a clock or treating a stored passed flag as sufficient. */
export function inspectNavigationSample({ sample, definition, browser, origin, legacy = false }) {
  const audit = sample.audit;
  const environment = audit?.environment;
  const engine = audit?.engine;
  const network = sample.network ?? [];
  const resources = audit?.resources ?? [];
  const urls = [...network.map((row) => row.url), ...resources.map((row) => row.name)];
  const cache = classifyPageCacheEvidence({
    origin,
    network,
    resources,
    serverRequests: sample.serverRequests ?? [],
    mode: sample.mode,
    prewarm: sample.prewarm === true,
  });
  const recordedCache = { ...sample.cacheEvidence };
  delete recordedCache.acceptInsecureCertsIsNotCacheProof;
  const controls = {
    foreground:
      environment?.visibility === 'visible' &&
      environment?.hasFocus === true &&
      audit?.visibilityChanges?.length > 0 &&
      audit.visibilityChanges.every((entry) => entry.state === 'visible'),
    correctViewport:
      same(environment?.viewport, [1440, 900]) &&
      environment?.visualViewport?.scale === 1 &&
      environment?.devicePixelRatio === 1,
    noServiceWorker:
      environment?.serviceWorkerControlled === false &&
      !(sample.workerRealms ?? []).some((realm) => realm.type === 'service-worker'),
    networkSameOrigin:
      environment?.origin === origin &&
      urls.length > 0 &&
      urls.every((value) => !/^https?:/.test(value) || new URL(value).origin === origin),
    archiveConfirmed: fixedArchive(sample.archive),
    cacheStateConfirmed: cache.confirmed === true,
    noExecutionModule:
      !!engine &&
      engine.compilations === 0 &&
      engine.streamingCompilations === 0 &&
      engine.workers.length === 0 &&
      (sample.workers ?? []).length === 0 &&
      (sample.workerRealms ?? []).length === 0 &&
      !urls.some((url) => /\.wasm(?:\?|$)/.test(url)),
  };
  if (browser === 'firefox')
    controls.networkObservationConfirmed = network.some(
      (row) =>
        row.beforeRequestObserved && row.responseCompletedObserved && row.navigation !== null,
    );
  const start = audit?.navigation?.[0]?.startTime;
  const endpoint = audit?.complete;
  const elapsed = endpoint && finite(start) ? endpoint.paintAt - start : null;
  const state = endpoint?.stateAtPaint;
  const required = expectedStates(sample.pageId);
  const ready =
    !!endpoint &&
    finite(endpoint.readyAt) &&
    finite(endpoint.paintAt) &&
    endpoint.paintAt >= endpoint.readyAt &&
    state?.correctRoute === true &&
    state.shellReady === true &&
    state.contentReady === true &&
    state.completeReady === true &&
    state.coreReady === true &&
    state.blockingOverlay === false &&
    state.visibility === 'visible' &&
    state.requiredConsumerStatesConfirmed === true &&
    required.every((name) => state.statuses[name] === 'ready');
  const checks = {
    exactDefinition: same(audit?.definition, definition) && sample.route === definition.route,
    requiredStates: same(audit?.requiredStates, required),
    originalObservationWindow: audit?.observationWindowMs === 5000,
    nativeNavigationClock: start === 0 && audit.navigation.length === 1,
    noNavigationFailure: sample.failure === null && same(sample.pageErrors, []),
    recomputedControls: allTrue(controls),
    recordedControlsMatch: Object.entries(controls).every(
      ([name, value]) => sample.controls?.[name] === value,
    ),
    noUnknownOrFailedControl: Object.entries(sample.controls ?? {}).every(([name, value]) =>
      name in controls ? value === true : name === 'prewarmConfirmed' && (value === true || legacy),
    ),
    cacheEvidenceMatches: same(cache, recordedCache),
    shellClockMatches:
      finite(audit?.shell?.paintAt) && sample.shellMs === audit.shell.paintAt - start,
    contentClockMatches:
      finite(audit?.content?.paintAt) && sample.contentMs === audit.content.paintAt - start,
    completeClockMatches: sample.completeMs === elapsed,
    twoRafEndpointProof: legacy
      ? endpoint === null
      : endpoint?.proof ===
          'Necessary real DOM and public consumer-state attributes, still ready after two rAF callbacks' &&
        finite(endpoint.stateAtPaint.at) &&
        endpoint.stateAtPaint.at >= endpoint.readyAt &&
        endpoint.stateAtPaint.at <= endpoint.paintAt,
    readyEndpoint: legacy
      ? endpoint === null &&
        audit.lastState?.contentReady === true &&
        audit.lastState.coreReady === false
      : ready,
    originalTwoSecondThreshold: legacy
      ? sample.completeMs === null && sample.completeWithinThreshold === false
      : finite(elapsed) &&
        elapsed >= 0 &&
        elapsed <= 2000 &&
        sample.completeWithinThreshold === true,
    recordedReadinessMatches: sample.readinessConfirmed === !legacy,
    recordedPassMatches: sample.passed === !legacy,
    workspaceReady:
      !definition.workspace ||
      (state?.workspaceReady === true &&
        state.sourceLength > 0 &&
        state.sourceReadOnly === true &&
        state.runEnabled === true),
  };
  return { checks, controls, elapsed, passed: allTrue(checks) };
}

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    min: n ? sorted[0] : null,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
    max: n ? sorted[n - 1] : null,
  };
};

function observerSections(source) {
  const text = source.replace(/\r\n/g, '\n');
  const pageStart = text.indexOf("    } else if (definition.id === 'PAGE-07') {");
  const pageEnd = text.indexOf('\n    }\n    const blockingOverlay', pageStart);
  // The old version sets the flag inside catch; start at the whole try block,
  // rather than masking only that trailing assignment.
  const taskStart = Math.min(
    ...[
      text.indexOf('  audit.longTaskObservationUnsupported ='),
      text.indexOf('  try {\n    new PerformanceObserver'),
    ].filter((position) => position >= 0),
  );
  const taskEnd = text.indexOf('\n}\n\nexport function readPageProbe', taskStart);
  assert.ok(pageStart >= 0 && pageEnd > pageStart && taskStart > pageEnd && taskEnd > taskStart);
  return {
    unchanged: `${text.slice(0, pageStart)}[PAGE07]${text.slice(pageEnd, taskStart)}[LONGTASK]${text.slice(taskEnd)}`,
    page07: text.slice(pageStart, pageEnd),
    longtask: text.slice(taskStart, taskEnd),
  };
}

export function auditNavigation() {
  const inputs = new Map();
  const failures = [];
  let checkCount = 0;
  const check = (condition, name, context = null) => {
    checkCount++;
    if (condition !== true) failures.push({ name, context });
    return condition === true;
  };
  const read = (path) => {
    const absolute = resolve(workspaceDir, path);
    const bytes = readFileSync(absolute);
    const record = { path: relativePath(absolute), bytes: bytes.length, sha256: sha256(bytes) };
    if (inputs.has(record.path))
      check(same(inputs.get(record.path), record), 'input changed while reading', record.path);
    inputs.set(record.path, record);
    return { ...record, bytesValue: bytes };
  };
  const json = (path) => {
    const record = read(path);
    return {
      record: { path: record.path, bytes: record.bytes, sha256: record.sha256 },
      value: JSON.parse(record.bytesValue.toString('utf8').replace(/^\uFEFF/, '')),
    };
  };
  const verifyObject = (object, name, context) => {
    for (const [key, value] of Object.entries(object)) check(value, `${name}: ${key}`, context);
  };
  const before = read('.artifacts/11.4/page-observer-before-settings-fix-16.mjs');
  const after = read('scripts/performance-page-observer.mjs');
  const oldSections = observerSections(before.bytesValue.toString('utf8'));
  const newSections = observerSections(after.bytesValue.toString('utf8'));
  check(
    oldSections.unchanged === newSections.unchanged,
    'observer changed only PAGE07 and longtask support',
  );
  check(
    oldSections.page07.includes('avatar-preset') && newSections.page07.includes('tab-data'),
    'observer corrects default data panel',
  );
  check(
    newSections.longtask.includes("supportedEntryTypes?.includes('longtask')"),
    'longtask uses supported types',
  );
  const selected = [];
  const excluded = [];
  const sources = [];
  let referenceManifest = null;
  let referenceNetwork = null;
  for (const browser of browsers) {
    let previousVersion = null;
    for (const batch of ['formal-15', 'settings-16']) {
      const directory = `.artifacts/11.4/pages-${browser}-${batch}`;
      const { record: reportFile, value: report } = json(`${directory}/report.json`);
      const replacement = batch === 'settings-16';
      const expectedIds = replacement ? ['PAGE-07'] : performancePages.map((page) => page.id);
      const context = `${browser}/${batch}`;
      const observerHash =
        report.pageObserverSha256 ?? report.hashes?.['scripts/performance-page-observer.mjs'];
      verifyObject(
        {
          task: report.task === '11.4',
          baseline: report.baseline === 'PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
          exactScope: same(report.selectedPageIds, expectedIds),
          repetitions: report.repeatsPerState === 5,
          unchangedThresholds: same(report.thresholds, {
            everyCompleteNavigationMs: 2000,
            observationWindowMs: 5000,
            repeatsPerState: 5,
          }),
          originalFlagsPreserved:
            report.complete === !replacement &&
            report.debugRun === replacement &&
            report.allSamplesPass === false,
          noRunFailure:
            !report.failure && !report.hostCaptureFailure && !report.harnessFailures?.length,
          cleanup: same(report.cleanupErrors, []) && !report.cleanupFailures?.length,
          exactSampleAndCohortCounts:
            report.samples.length === expectedIds.length * 10 &&
            report.cohorts.length === expectedIds.length * 10,
          matchingObserverHash: observerHash === (replacement ? after.sha256 : before.sha256),
          sameBrowserVersion: previousVersion === null || report.browserVersion === previousVersion,
        },
        'source',
        context,
      );
      previousVersion = report.browserVersion;
      for (const [path, expected] of Object.entries(
        report.hashes ?? {
          'scripts/performance-pages.mjs': report.toolSha256,
          'scripts/performance-workloads.mjs': report.workloadDefinitionsSha256,
          'scripts/performance-browser.mjs': report.browserConfigurationSha256,
          'package-lock.json': report.packageLockSha256,
        },
      )) {
        if (path === 'scripts/performance-page-observer.mjs') continue;
        check(read(path).sha256 === expected, 'recorded tool/lock hash matches current source', {
          context,
          path,
        });
      }
      const start = json(`${directory}/host-start.json`);
      const end = json(`${directory}/host-end.json`);
      const qualification = qualifyPerformanceHost(start.value, end.value);
      check(
        same(report.hostConditions, start.value) && same(report.hostConditionsEnd, end.value),
        'embedded host endpoints match raw files',
        context,
      );
      check(
        qualification.satisfied && same(qualification, report.hostBaseline),
        'both actual host endpoints qualify',
        context,
      );
      const server = json(`${directory}/network-server.json`);
      const networkSummary = json(`${directory}/network-summary.json`);
      const requestFile = read(`${directory}/network-requests.jsonl`);
      const requests = requestFile.bytesValue
        .toString('utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const requestsById = new Map(requests.map((row) => [row.id, row]));
      const manifest = report.server.resourceManifest;
      if (referenceManifest === null) referenceManifest = manifest;
      if (referenceNetwork === null) referenceNetwork = report.server.network;
      verifyObject(
        {
          rawServerMetadataMatches: same(server.value, report.server),
          sameProductionResources: same(manifest, referenceManifest),
          sameNetworkConfiguration: same(report.server.network, referenceNetwork),
          productionRoot: report.server.root === 'web/dist',
          https:
            report.server.origin === `https://127.0.0.1:${browser === 'firefox' ? 4192 : 4190}`,
          fixedNetwork:
            report.server.network.downloadBitsPerSecond === 20_000_000 &&
            report.server.network.uploadBitsPerSecond === 5_000_000 &&
            report.server.network.roundTripPropagationMs === 40 &&
            report.server.network.lossInjected === 0 &&
            report.server.network.sharedAcrossAllConnectionsAndWorkers === true,
          requestLogComplete:
            requests.length === networkSummary.value.requestCount &&
            requestsById.size === requests.length,
          serverStopped:
            networkSummary.value.remainingSockets === 0 &&
            networkSummary.value.uplink.pendingPieces === 0 &&
            networkSummary.value.downlink.pendingPieces === 0,
          hostSpanEnclosesRun:
            Date.parse(report.startedAt) <= Date.parse(qualification.collectedAt.start) &&
            Date.parse(qualification.collectedAt.start) <= Date.parse(report.server.startedAt) &&
            Date.parse(networkSummary.value.endedAt) <= Date.parse(qualification.collectedAt.end) &&
            Date.parse(qualification.collectedAt.end) <= Date.parse(report.endedAt),
        },
        'server/environment',
        context,
      );
      check(
        read('scripts/serve-performance.mjs').sha256 === report.server.harnessSha256,
        'server source hash',
        context,
      );
      const cohortIds = new Set();
      for (const cohort of report.cohorts) {
        const file = json(`${directory}/${cohort.id}-cohort.json`);
        check(
          same(file.value, cohort) && !cohortIds.has(cohort.id),
          'raw unique cohort matches report',
          { context, id: cohort.id },
        );
        cohortIds.add(cohort.id);
        check(
          !cohort.failure &&
            !cohort.cleanupFailure &&
            (browser === 'firefox' ? cohort.sessionClosed === true : cohort.contextClosed === true),
          'cohort closed without failure',
          { context, id: cohort.id },
        );
      }
      if (browser === 'firefox') {
        check(
          report.ownedServicesStopped === true && report.distinctProfiles === report.cohorts.length,
          'stock Firefox cleanup and profile count',
          context,
        );
        check(
          new Set(report.cohorts.map((row) => row.capabilities?.['moz:profile'])).size ===
            report.cohorts.length,
          'stock Firefox profiles unique',
          context,
        );
        check(
          report.cohorts.every(
            (row) =>
              row.capabilities?.['moz:headless'] === false &&
              row.preloadRegisteredBeforeNavigation === true &&
              row.capabilities.browserVersion === report.browserVersion,
          ),
          'stock Firefox headful and preload',
          context,
        );
      } else {
        check(
          report.browserConfiguration.launchOptions.headless === false &&
            report.browserConfiguration.contextOptions.ignoreHTTPSErrors === false &&
            report.browserConfiguration.contextOptions.serviceWorkers === 'block',
          'Chromium headful and scoped certificate/cache controls',
          context,
        );
      }
      const sampleIds = new Set();
      for (const sample of report.samples) {
        const definition = performancePages.find((page) => page.id === sample.pageId);
        const legacy = !replacement && sample.pageId === 'PAGE-07';
        const key = `${context}/${sample.id}`;
        const file = json(`${directory}/${sample.id}.json`);
        check(
          same(file.value, sample) && !sampleIds.has(sample.id),
          'raw unique sample matches embedded report',
          key,
        );
        sampleIds.add(sample.id);
        check(
          definition !== undefined &&
            expectedIds.includes(sample.pageId) &&
            modes.includes(sample.mode) &&
            Number.isInteger(sample.repeat) &&
            sample.repeat >= 1 &&
            sample.repeat <= 5 &&
            sample.id === `${sample.pageId}-${sample.mode}-${sample.repeat}` &&
            cohortIds.has(sample.id),
          'exact sample identity/scope/cohort',
          key,
        );
        const inspected = inspectNavigationSample({
          sample,
          definition,
          browser,
          origin: report.server.origin,
          legacy,
        });
        verifyObject(
          inspected.checks,
          legacy ? 'retained observer failure' : 'selected sample',
          key,
        );
        const evidence = {
          browser,
          batch,
          id: sample.id,
          pageId: sample.pageId,
          route: sample.route,
          mode: sample.mode,
          repeat: sample.repeat,
          report: reportFile.path,
          file: file.record,
          completeMs: sample.completeMs,
          shellMs: sample.shellMs,
          contentMs: sample.contentMs,
          originalPassed: sample.passed,
          auditPassed: inspected.passed,
          longTaskObservationUnsupported: sample.audit.longTaskObservationUnsupported ?? null,
          longTaskEntries: sample.audit.longTasks.length,
        };
        const requestProof = (candidate) =>
          candidate.serverRequests.every((row) => {
            const final = requestsById.get(row.id);
            return final && Object.entries(row).every(([name, value]) => same(final[name], value));
          });
        check(requestProof(sample), 'sample server requests match final raw request log', key);
        if (sample.repeat === 1) {
          const screenshot = read(`${directory}/${sample.id}.png`);
          check(
            screenshot.bytesValue.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
            'original screenshot is PNG',
            key,
          );
          evidence.screenshot = {
            path: screenshot.path,
            bytes: screenshot.bytes,
            sha256: screenshot.sha256,
          };
        }
        if (sample.mode === 'warm') {
          const prewarm = json(`${directory}/${sample.id}-prewarm.json`);
          const prewarmAudit = inspectNavigationSample({
            sample: prewarm.value,
            definition,
            browser,
            origin: report.server.origin,
            legacy,
          });
          verifyObject(
            prewarmAudit.checks,
            legacy ? 'retained observer prewarm failure' : 'selected prewarm',
            key,
          );
          check(
            prewarm.value.prewarm === true &&
              prewarm.value.id === `${sample.id}-prewarm` &&
              requestProof(prewarm.value),
            'raw prewarm identity and request log',
            key,
          );
          const expected =
            browser === 'firefox'
              ? {
                  id: prewarm.value.id,
                  completeMs: prewarm.value.completeMs,
                  readinessConfirmed: prewarm.value.readinessConfirmed,
                  failure: prewarm.value.failure,
                }
              : {
                  shellMs: prewarm.value.shellMs,
                  contentMs: prewarm.value.contentMs,
                  completeMs: prewarm.value.completeMs,
                  failure: prewarm.value.failure,
                  audit: prewarm.value.audit,
                  network: prewarm.value.network,
                  archiveConfirmed: prewarm.value.controls.archiveConfirmed,
                  readinessConfirmed: prewarm.value.readinessConfirmed,
                };
          check(
            same(sample.prewarm, expected) && sample.controls.prewarmConfirmed === !legacy,
            'embedded prewarm and warm setup match raw evidence',
            key,
          );
          evidence.prewarm = prewarm.record;
        } else check(sample.prewarm === false, 'cold sample has no prewarm', key);
        if (replacement)
          check(
            typeof sample.audit.longTaskObservationUnsupported === 'boolean' &&
              (!sample.audit.longTaskObservationUnsupported || sample.audit.longTasks.length === 0),
            'new observer explicitly reports longtask API support',
            key,
          );
        if (legacy) {
          evidence.reason =
            'Old observer requires avatar controls on /settings, whose real default panel is data. Missing complete endpoint is retained as a failure; no endpoint or timing is reconstructed.';
          excluded.push(evidence);
        } else selected.push(evidence);
      }
      for (const page of performancePages)
        for (const mode of modes) {
          const samples = report.samples.filter(
            (sample) => sample.pageId === page.id && sample.mode === mode,
          );
          const summary = report.summary.find((row) => row.pageId === page.id && row.mode === mode);
          check(
            summary?.observed === samples.length &&
              summary?.passed === samples.filter((row) => row.passed).length &&
              summary?.allSamplesPass ===
                (samples.length === 5 && samples.every((row) => row.passed)),
            'original summary matches raw sample flags',
            { context, page: page.id, mode },
          );
        }
      sources.push({
        browser,
        batch,
        report: reportFile,
        browserVersion: report.browserVersion,
        originalComplete: report.complete,
        originalDebugRun: report.debugRun,
        originalAllSamplesPass: report.allSamplesPass,
        sampleCount: report.samples.length,
        originalPassed: report.samples.filter((sample) => sample.passed).length,
        observerSha256: observerHash,
        hostStart: start.record,
        hostEnd: end.record,
        hostQualification: qualification,
        manifestSha256: sha256(JSON.stringify(manifest)),
        network: report.server.network,
      });
    }
  }
  for (const entry of referenceManifest) {
    const path = resolve(workspaceDir, 'web/dist', `.${entry.path}`);
    const child = relative(resolve(workspaceDir, 'web/dist'), path);
    check(
      entry.path.startsWith('/') &&
        child !== '..' &&
        !child.startsWith(`..${sep}`) &&
        !isAbsolute(child),
      'resource remains in production root',
      entry.path,
    );
    const actual = read(path);
    check(
      actual.bytes === entry.rawBytes && actual.sha256 === entry.identitySha256,
      'actual production bytes match all six recorded manifests',
      entry.path,
    );
  }
  const matrix = browsers.flatMap((browser) =>
    performancePages.flatMap((page) =>
      modes.map((mode) => {
        const samples = selected.filter(
          (sample) =>
            sample.browser === browser && sample.pageId === page.id && sample.mode === mode,
        );
        const exact =
          samples.length === 5 &&
          same(samples.map((sample) => sample.repeat).sort(), [1, 2, 3, 4, 5]);
        check(exact, 'aggregate has exact five unique repetitions per browser/page/mode', {
          browser,
          page: page.id,
          mode,
        });
        return {
          browser,
          pageId: page.id,
          route: page.route,
          mode,
          expected: 5,
          observed: samples.length,
          originalPassed: samples.filter((sample) => sample.originalPassed).length,
          independentlyVerified: samples.filter((sample) => sample.auditPassed).length,
          completeMs: stats(samples.map((sample) => sample.completeMs).filter(finite)),
          samples: samples.map((sample) => sample.file.path),
          complete: exact,
        };
      }),
    ),
  );
  check(
    selected.length === 210 && excluded.length === 30,
    '210 selected plus 30 preserved observer failures',
  );
  check(
    new Set(selected.map((row) => `${row.browser}/${row.id}`)).size === 210,
    'no selected identity reused',
  );
  check(
    new Set(selected.map((row) => row.file.path)).size === 210 &&
      selected.every((row) => /^[a-f0-9]{64}$/.test(row.file.sha256)),
    '210 distinct raw paths and SHA256 recorded',
  );
  check(
    new Set(excluded.map((row) => row.file.path)).size === 30 &&
      excluded.every((row) => /^[a-f0-9]{64}$/.test(row.file.sha256)),
    '30 distinct retained failure paths and SHA256 recorded',
  );
  for (const input of inputs.values())
    check(
      sha256(readFileSync(resolve(workspaceDir, input.path))) === input.sha256,
      'source remained unchanged during audit',
      input.path,
    );
  return {
    task: '11.4',
    kind: 'Independent read-only audit and cross-run navigation evidence aggregate',
    auditedAt: new Date().toISOString(),
    auditScriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    fixedThresholdMs: 2000,
    aggregateCoverageComplete: matrix.every((cell) => cell.complete) && selected.length === 210,
    allSelectedSamplesVerified:
      failures.length === 0 && selected.every((sample) => sample.auditPassed),
    counts: {
      sourceReports: sources.length,
      rawMeasuredSamples: selected.length + excluded.length,
      selected: selected.length,
      retainedLegacyObserverFailures: excluded.length,
      matrixCells: matrix.length,
      expectedPerCell: 5,
      original180: selected.filter((sample) => sample.batch === 'formal-15').length,
      correctedSettings30: selected.filter((sample) => sample.batch === 'settings-16').length,
    },
    checks: { total: checkCount, passed: checkCount - failures.length, failed: failures.length },
    failures,
    browserSummary: browsers.map((browser) => ({
      browser,
      browserVersion: sources.find((source) => source.browser === browser).browserVersion,
      samples: selected.filter((sample) => sample.browser === browser).length,
      completeMs: stats(
        selected
          .filter((sample) => sample.browser === browser)
          .map((sample) => sample.completeMs)
          .filter(finite),
      ),
    })),
    production: {
      manifestSha256: sha256(JSON.stringify(referenceManifest)),
      resources: referenceManifest,
    },
    observerChange: {
      before: { path: before.path, sha256: before.sha256 },
      after: { path: after.path, sha256: after.sha256 },
      onlyAllowedSectionsChanged: oldSections.unchanged === newSections.unchanged,
      oldPage07: oldSections.page07,
      newPage07: newSections.page07,
      oldLongtask: oldSections.longtask,
      newLongtask: newSections.longtask,
    },
    sources,
    matrix,
    selectedSamples: selected,
    retainedLegacyFailures: excluded,
    inputFiles: [...inputs.values()],
    boundaries: [
      'The selected matrix uses all 180 PAGE01–06 samples from formal-15 and all 30 PAGE07 samples from settings-16. No slow or failed selected sample is removed or retried by this audit.',
      'All 30 original PAGE07 failures remain listed with original file SHA256. Their missing complete endpoints are never reconstructed or relabeled passed.',
      'Each settings-only source remains debugRun:true, complete:false and allSamplesPass:false. Only this separate aggregate checks the combined 210-sample matrix.',
      'Six runs preserve the same production resource manifest, workload definitions, browser versions per engine, 2000ms threshold, viewport, focus, network shaping and fixed fresh learning archive; observer changes are confined to PAGE07 default data-panel readiness and explicit longtask API support.',
      'Old observer reports omit longtask support metadata, so their empty arrays cannot prove zero long tasks. New settings samples preserve explicit unsupported flags. Navigation timing is not a playback, execution, retained-review, physical 60fps, public hosting or complete task 11.4 acceptance result.',
      'Two recorded host endpoints qualify each run and preserve exact display paths, dimensions and rational refresh. They cannot exclude a transient intervening host change or prove an idle OS.',
    ],
  };
}

function markdown(report) {
  const lines = [
    '# 11.4 导航证据独立聚合审查',
    '',
    `审查时间：${report.auditedAt}。仅读取已有证据，未启动浏览器、服务或新测量。`,
    '',
    `聚合覆盖：${report.aggregateCoverageComplete}；全部选定样本验证：${report.allSelectedSamplesVerified}。${report.checks.total} 项核对，${report.checks.failed} 项失败。`,
    '',
    '原正式轮 PAGE01—06 共180项，加设置页修正轮30项，共210项；3浏览器×7页×冷暖2态×5次。每个样本仍须≤2000ms，未删慢样本或更改焦点、缓存及网络条件。',
    '',
    '| 浏览器 | 实际版本 | 选定样本 | 最大完整入口 ms | p95 ms |',
    '| --- | --- | ---: | ---: | ---: |',
    ...report.browserSummary.map(
      (row) =>
        `| ${row.browser} | ${row.browserVersion} | ${row.samples} | ${row.completeMs.max} | ${row.completeMs.p95} |`,
    ),
    '',
    '## 来源与原始结论',
    '',
    '| 原始报告 | 样本/原通过 | complete / allSamplesPass | SHA256 |',
    '| --- | ---: | --- | --- |',
    ...report.sources.map(
      (source) =>
        `| [${source.report.path}](${source.report.path.replace(/^\.artifacts\/11\.4\//, './')}) | ${source.sampleCount}/${source.originalPassed} | ${source.originalComplete} / ${source.originalAllSamplesPass} | ${source.report.sha256} |`,
    ),
    '',
    '设置页补测报告仍为 debugRun:true、complete:false、allSamplesPass:false，本聚合没有修改这些报告。原轮30项PAGE07观察器失败全部保留在JSON retainedLegacyFailures中，逐项含源文件路径、SHA256及原始失败状态，未将其补造为通过。',
    '',
    `六轮${report.production.resources.length}项生产资源逐项SHA/字节一致，并与当前web/dist原件核对；清单SHA256：${report.production.manifestSha256}。每轮host-start/end原件与内嵌快照一致，独立重新计算资格均见JSON sources.hostQualification。`,
    '',
    `观察器旧SHA：${report.observerChange.before.sha256}；新SHA：${report.observerChange.after.sha256}。只修改PAGE07默认本地数据面板判据与longtask支持判断，其他代码字节在换行归一后相同。`,
    '',
    '## 每浏览器／页面／冷暖矩阵',
    '',
    '| 浏览器 | 页面 | 状态 | 样本 | 原通过/独立验证 | max ms |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...report.matrix.map(
      (row) =>
        `| ${row.browser} | ${row.pageId} | ${row.mode} | ${row.observed} | ${row.originalPassed}/${row.independentlyVerified} | ${row.completeMs.max} |`,
    ),
    '',
    '## 限制与交接',
    '',
    '原观察器未记录longtask API支持，空数组不能解释为没有长任务；新设置页保留明确支持标记。主机两端相同不能排除中途短暂变化。HTTPS和网络整形仍是原实验条件，不代表公网托管。',
    '',
    '本结果仅为导航矩阵，不代表真实提交执行、复盘、播放60fps或整个11.4验收。所有逐样本、预热、cohort、截图、网络日志、双端host及代码/构建原件路径和SHA见配套JSON inputFiles；输入在审查结束再次验SHA，未改动。下一步由协调窗口合入导航结论并继续其余验收。',
    '',
  ];
  if (report.failures.length)
    lines.push(
      '## 审查失败',
      '',
      ...report.failures.map((failure) => `- ${failure.name}: ${JSON.stringify(failure.context)}`),
      '',
    );
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.includes('--check-only');
  assert.ok(
    process.argv.slice(2).every((argument) => argument === '--check-only'),
    'Only --check-only is accepted',
  );
  const destination = join(workspaceDir, '.artifacts/11.4/navigation-aggregate-23');
  if (!checkOnly)
    assert.ok(
      !existsSync(`${destination}.json`) && !existsSync(`${destination}.md`),
      'Aggregate evidence is immutable; existing outputs are refused',
    );
  const report = auditNavigation();
  if (!checkOnly) {
    writeFileSync(`${destination}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(`${destination}.md`, markdown(report), { flag: 'wx' });
  }
  console.log(
    JSON.stringify(
      {
        checkOnly,
        aggregateCoverageComplete: report.aggregateCoverageComplete,
        allSelectedSamplesVerified: report.allSelectedSamplesVerified,
        counts: report.counts,
        checks: report.checks,
        browserSummary: report.browserSummary,
        failures: report.failures.slice(0, 12),
        output: checkOnly ? null : relativePath(`${destination}.json`),
      },
      null,
      2,
    ),
  );
  if (!report.allSelectedSamplesVerified || !report.aggregateCoverageComplete) process.exitCode = 1;
}
