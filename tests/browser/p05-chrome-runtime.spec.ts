import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { c6TeachingRelease } from '../../web/src/content/c6-teaching-release.generated';
import { c6LearningRelease } from '../../web/src/c6-learning/release.generated';
import { decodeResult, type ExecuteRequest, type TraceObject } from '../../web/src/engine/protocol';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

const evidenceRoot = `.artifacts/21.6/runtime/${process.env.TASK_EVIDENCE_LABEL ?? 'current'}`;
const sourceLock = JSON.parse(readFileSync('content/build/source-lock.json', 'utf8')) as {
  releaseVersion: string;
};
const registrationPath = `content/c/p0/blockly-release-${sourceLock.releaseVersion}.json`;
const buildIndexPath = '.artifacts/artifact-hashes.json';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const proof = (path: string) => ({ path, sha256: sha(readFileSync(path)) });

// Playwright's page fixture creates a disposable context. This spec only visits
// the separately served production build, never an existing personal browser.
async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.getByTestId('learning-temporary-status')).toHaveCount(0);
}

test('registered course saves settings and displays both real sorting traces', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60_000);
  const projects = {
    chrome: { engine: 'chromium', channel: 'chrome' },
    edge: { engine: 'chromium', channel: 'msedge' },
    'firefox-automation': { engine: 'firefox', channel: undefined },
  } as const;
  expect(Object.keys(projects)).toContain(info.project.name);
  const expectedBrowser = projects[info.project.name as keyof typeof projects];
  expect(browser.browserType().name()).toBe(expectedBrowser.engine);
  expect(info.project.use.channel).toBe(expectedBrowser.channel);
  const folder = `${evidenceRoot}/${info.project.name}`;
  expect(info.retry).toBe(0);
  const registration = JSON.parse(readFileSync(registrationPath, 'utf8')) as {
    releaseVersion: string;
  };
  expect(registration.releaseVersion).toBe(sourceLock.releaseVersion);
  const registeredProof = proof(registrationPath);
  const buildProof = proof(buildIndexPath);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const optionalResourceErrors: { message: string; url: string }[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    if (
      url === new URL('/favicon.ico', page.url()).href &&
      message.text().includes('404 (Not Found)')
    )
      optionalResourceErrors.push({ message: message.text(), url });
    else consoleErrors.push(`${message.text()} (${url})`);
  });
  await observeCaseSetExecution(page);
  await page.goto('/#/courses');
  await ready(page);
  await expect(page.locator('.c6-node-list > li')).toHaveCount(19);
  const manifestResponse = await page.request.get(
    `/content/c/primer6-teaching/${c6TeachingRelease.manifestFile}`,
  );
  expect(manifestResponse.ok()).toBe(true);
  const manifestBytes = await manifestResponse.body();
  expect(sha(manifestBytes)).toBe(c6TeachingRelease.manifestSha256);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { nodes: unknown[] };
  expect(manifest.nodes).toHaveLength(650);
  const indexResponse = await page.request.get(
    `/content/c/primer6-learning/${c6LearningRelease.file}`,
  );
  expect(indexResponse.ok()).toBe(true);
  const indexBytes = await indexResponse.body();
  expect(sha(indexBytes)).toBe(c6LearningRelease.sha256);
  const index = JSON.parse(indexBytes.toString('utf8')) as {
    packageRef: unknown;
    lessons: unknown[];
    exercises: unknown[];
  };
  expect(index.packageRef).toEqual(c6LearningRelease.packageRef);
  expect(index.lessons).toHaveLength(404);
  expect(index.exercises).toHaveLength(44);

  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toBeVisible();

  await mkdir(folder, { recursive: true });
  const screenshots: { path: string; sha256: string }[] = [];
  const runs: { caseId: string; producer: string; steps: number; cursor: number }[] = [];
  for (const name of ['bubble-sort', 'selection-sort']) {
    const caseId = `case.c.${name}`;
    await page.goto(`/#/visualize/${caseId}`);
    await ready(page);
    const panel = page.getByTestId('case-execution');
    await expect(panel).toHaveAttribute('data-state', 'ready');
    await panel.getByRole('button', { name: '运行示例', exact: true }).click();
    await expect(panel).toHaveAttribute('data-state', 'completed');
    const worker = await observedCaseSetExecute(page);
    expect(worker).toMatchObject({ moduleSeen: true, responseOk: true, terminated: true });
    expect(worker.responseOperationId).toBe(worker.operationId);
    const request = JSON.parse(
      Buffer.from(worker.requestBytes!).toString('utf8'),
    ) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
    expect(request.subjectRef?.id).toBe(caseId);
    expect(request.packageRef).toEqual({ id: 'content.c.p05', version: '1.0.0' });
    expect(request.input.values.values).toHaveLength(7);
    expect(result.producer).toBe('rust');
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(result.trace?.completeness).toBe('complete');
    const declaration = result.resolvedBindings.find(
      (binding) => binding.bindingKey === 'param.values',
    )?.declarationNodeId;
    expect(declaration).toBeTruthy();
    const initialized = result.trace!.steps.findIndex(
      (step) =>
        step.kind === 'value.initialize' &&
        step.changes.some(
          (change) =>
            change.op === 'record' &&
            change.table === 'objects' &&
            change.after !== null &&
            (change.after as TraceObject).declarationNodeId === declaration,
        ),
    );
    expect(initialized).toBeGreaterThanOrEqual(0);
    const cursor = initialized + 1;
    const controls = panel.getByTestId('player-controls');
    await page.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
    await expect(controls).toHaveAttribute('data-cursor', '0');
    await panel.getByTestId('player-workspace').focus();
    for (let index = 0; index < cursor; index++) await page.keyboard.press('ArrowRight');
    await expect(controls).toHaveAttribute('data-cursor', String(cursor));
    const array = panel.getByTestId('trace-array');
    await expect(array).toBeVisible();
    await expect(array).toHaveAttribute('data-logical-length', '7');
    await expect(array.getByTestId('trace-array-cell')).toHaveCount(7);
    const trace = panel.getByTestId('trace-view');
    const before = await trace.innerHTML();
    await controls.getByRole('button', { name: '前进', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', String(cursor + 1));
    await controls.getByRole('button', { name: '后退', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', String(cursor));
    await expect(trace).toHaveAttribute('data-cursor', String(cursor));
    expect(await trace.innerHTML()).toBe(before);
    const path = `${folder}/${process.env.TASK_EVIDENCE_LABEL ?? 'runtime'}-${name}.png`;
    const bytes = await panel.getByTestId('animation-panel').screenshot();
    await writeFile(path, bytes, { flag: 'wx' });
    screenshots.push({ path, sha256: sha(bytes) });
    runs.push({ caseId, producer: result.producer, steps: result.trace!.steps.length, cursor });
  }
  await ready(page);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(proof(registrationPath)).toEqual(registeredProof);
  expect(proof(buildIndexPath)).toEqual(buildProof);
  await writeFile(
    `${folder}/runtime-final.json`,
    JSON.stringify(
      {
        task: 'P0.5-09',
        status: 'passed',
        browser: info.project.name,
        browserType: browser.browserType().name(),
        browserVersion: browser.version(),
        channel: info.project.use.channel ?? null,
        userAgent: await page.evaluate(() => navigator.userAgent),
        registration: registeredProof,
        buildIndex: buildProof,
        pageErrors,
        consoleErrors,
        optionalResourceErrors,
        checks: {
          registeredCourse: true,
          storageReady: true,
          saveSurvivesReload: true,
          bubbleVisualization: true,
          selectionVisualization: true,
        },
        runs,
        screenshots,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
});
