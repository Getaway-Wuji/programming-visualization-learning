/* global window, document, requestAnimationFrame, indexedDB, getComputedStyle */
// Read-only curriculum views and ordinary local appearance controls. Fixed public examples only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { delimiter, dirname, isAbsolute, resolve, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve('.');
const taskDirectory = resolve('.artifacts/P0.5-09');
const chosen = process.env.P05_VISUAL_DIR ?? `visual-${Date.now()}`;
const directory =
  isAbsolute(chosen) || /[\\/]/.test(chosen) ? resolve(chosen) : resolve(taskDirectory, chosen);
assert.ok(
  directory.startsWith(taskDirectory + sep),
  'Visual output must stay under .artifacts/P0.5-09.',
);
const baseURL = 'http://127.0.0.1:4178';
const themes = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'];
const widths = [1440, 768, 390];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const read = (path) => readFileSync(resolve(root, path));
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const registrationPath =
  process.env.P05_VISUAL_REGISTRATION ?? 'content/c/p0/blockly-release-1.0.15.json';
const registration = json(registrationPath);
assert.match(registration.releaseVersion, /^1\.0\.\d+$/);
assert.ok(Number(registration.releaseVersion.split('.')[2]) >= 14);
const manifest = json('web/public/content/course/manifest.json');
assert.equal(
  manifest.registered,
  true,
  'Run visual acceptance only against a registered production course.',
);
assert.match(manifest.file, /^content\/course\/[A-Za-z0-9.-]+\.json$/);
const bundleBytes = read(`web/dist/${manifest.file}`);
assert.equal(bundleBytes.length, manifest.bytes);
assert.equal(sha(bundleBytes), manifest.sha256);
const bundle = JSON.parse(bundleBytes.toString('utf8'));
assert.equal(bundle.registered, true);
assert.deepEqual(bundle.reading.packageRef, { id: 'content.c.p05', version: '1.0.0' });
assert.equal(bundle.reading.chapters.length, 8);
assert.equal(bundle.reading.lessons.length, 32);
const lesson = bundle.reading.lessons.find((entry) => entry.id === 'lesson.c.short-circuit-safety');
const firstExercise = bundle.practice.exercises.find(
  (entry) => entry.id === 'exercise.c.first-output',
);
const firstProgram = bundle.practice.programs.find(
  (entry) => entry.id === firstExercise?.programRef.id,
);
assert.ok(lesson && firstExercise && firstProgram);
assert.deepEqual(firstProgram.bindings, []);
const solutions = json('tests/fixtures/p05-reference-solutions.json').solutions;
const reference = solutions.find((entry) => entry.exerciseRef.id === firstExercise.id)?.source;
assert.equal(typeof reference, 'string');
const build = {
  registration: {
    path: registrationPath,
    version: registration.releaseVersion,
    sha256: sha(read(registrationPath)),
  },
  manifest: {
    path: 'web/public/content/course/manifest.json',
    sha256: sha(read('web/public/content/course/manifest.json')),
  },
  bundle: {
    path: `web/dist/${manifest.file}`,
    sha256: sha(bundleBytes),
    bytes: bundleBytes.length,
  },
  staticIndex: { path: 'web/dist/index.html', sha256: sha(read('web/dist/index.html')) },
};

await mkdir(taskDirectory, { recursive: true });
await mkdir(directory, { recursive: false }); // A rerun requires a new label; failed evidence stays intact.
const report = {
  task: 'P0.5-09',
  status: 'running',
  createdAtUtc: new Date().toISOString(),
  expectedScenes: 66,
  browserVersion: null,
  build,
  scenes: [],
  runtimeChecks: [],
  limits: [
    'The six existing approved themes and their fonts/soft gradients are retained; no fresh art direction is claimed.',
    'Chrome screenshots at 1440/768/390, 900px height and DPR 1. Physical DPI, touch and screen-reader behavior are not measured here.',
    'Screenshots show real course material and independent empty answer skeletons. One separate fixed public example is genuinely run once; it is never submitted or credited as learning.',
    'Source/index/assets/registration before-and-after hash closure and human screenshot review are recorded separately by root.',
  ],
  ownedServer: { pid: null, started: false, stopped: false },
  pageErrors: [],
};
let browser;
let server;
let serverLog = '';
let failure;
async function portIsFree() {
  return new Promise((resolveFree, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 4178 });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolveFree(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Cannot establish exclusive QA port ownership.'));
    });
    socket.once('error', (error) =>
      error.code === 'ECONNREFUSED' ? resolveFree(true) : reject(error),
    );
  });
}
async function frame(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
  });
}
async function ready(page) {
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
async function archive(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolveDatabase, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'];
      const transaction = db.transaction(names, 'readonly');
      const finished = new Promise((resolveTransaction, reject) => {
        transaction.oncomplete = resolveTransaction;
        transaction.onabort = () => reject(transaction.error);
      });
      const entries = await Promise.all(
        names.map(async (name) => {
          const rows = await new Promise((resolveRows, reject) => {
            const request = transaction.objectStore(name).getAll();
            request.onsuccess = () => resolveRows(request.result);
            request.onerror = () => reject(request.error);
          });
          return [name, rows];
        }),
      );
      await finished;
      return {
        databaseVersion: db.version,
        stores: Array.from(db.objectStoreNames),
        business: Object.fromEntries(entries),
      };
    } finally {
      db.close();
    }
  });
}
function noLearning(data) {
  assert.equal(data.databaseVersion, 2);
  assert.equal(data.stores.length, 11);
  for (const rows of Object.values(data.business)) assert.deepEqual(rows, []);
}
async function observe(page) {
  await page.addInitScript(() => {
    const record = { execute: 0, analysis: 0, prepare: 0, request: null, response: null };
    Object.assign(window, { __p05CourseVisual: record });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.p05IsExecute = false;
        this.addEventListener('message', (event) => {
          if (this.p05IsExecute && event.data?.buffer instanceof ArrayBuffer)
            record.response = event.data.buffer.slice(0);
        });
      }
      postMessage(message, options = []) {
        if (message?.kind === 'execute') {
          record.execute++;
          this.p05IsExecute = true;
          if (message.buffer instanceof ArrayBuffer) record.request = message.buffer.slice(0);
        }
        if (message?.kind === 'analyze-code') record.analysis++;
        if (message?.kind === 'prepare' || message?.kind === 'prepare-input') record.prepare++;
        return super.postMessage(message, options);
      }
    };
  });
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
}
async function counts(page) {
  return page.evaluate(() => ({
    execute: window.__p05CourseVisual.execute,
    analysis: window.__p05CourseVisual.analysis,
    prepare: window.__p05CourseVisual.prepare,
  }));
}
async function setMode(page, value) {
  if ((await page.locator('html').getAttribute('data-theme')) !== value)
    await page.getByTestId('theme-mode-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await ready(page);
  await frame(page);
}
async function setTheme(page, theme) {
  await page.goto(`${baseURL}/#/settings?panel=appearance`);
  await ready(page);
  await expect(page.getByTestId('appearance-settings')).toBeVisible();
  await page.getByTestId(`theme-${theme}`).click();
  if (await page.getByTestId('save-appearance').isEnabled())
    await page.getByTestId('save-appearance').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await ready(page);
  await setMode(page, 'light');
}
async function chooseBlocks(page, value) {
  const choice = page
    .getByTestId('block-workspace-preference')
    .getByRole('combobox', { name: '积木显示', exact: true });
  if ((await choice.inputValue()) !== value) {
    await choice.selectOption(value);
    await expect(page.getByTestId('block-preference-save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
  }
  await expect(page.getByTestId('practice-editor-layout')).toHaveAttribute(
    'data-blocks-visible',
    value === 'show' ? 'yes' : 'no',
  );
  if (value === 'show') {
    const tab = page
      .locator('[data-testid="workbench"][data-kind="practice"]')
      .getByRole('tab', { name: '积木', exact: true });
    if (await tab.isVisible()) await tab.click();
    await expect(
      page.getByRole('region', { name: '积木工作区', exact: true }).locator('.blocklySvg'),
    ).toBeVisible();
  }
  await ready(page);
  await frame(page);
}
async function geometry(page) {
  return page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rectangle = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      return {
        x: rectangle.x,
        y: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: style.overflowX,
        fontSize: parseFloat(style.fontSize),
        fontFamily: style.fontFamily,
        visible: rectangle.width > 0 && rectangle.height > 0,
      };
    };
    return {
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      pageOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      scrollY: window.scrollY,
      html: { ...document.documentElement.dataset },
      chapters: document.querySelectorAll('.course-grid > .chapter-card').length,
      lessonLinks: document.querySelectorAll('[data-course-lesson]').length,
      body: bounds('main'),
      code: bounds('[data-testid="draft-code-editor"] textarea'),
      blocks: bounds('[aria-label="积木工作区"]'),
      preference: bounds('[data-testid="block-workspace-preference"] select'),
      examples: Array.from(
        document.querySelectorAll('[data-testid="lesson-reading"] pre.sample-source'),
      ).map((element) => {
        const style = getComputedStyle(element),
          rectangle = element.getBoundingClientRect();
        return {
          text: element.textContent,
          width: rectangle.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: style.overflowX,
          fontSize: parseFloat(style.fontSize),
          fontFamily: style.fontFamily,
          whiteSpace: style.whiteSpace,
          tabIndex: element.tabIndex,
        };
      }),
    };
  });
}
async function screenshot(page, { theme, width, mode, screen, preference = null }) {
  await frame(page);
  const measured = await geometry(page);
  assert.equal(
    measured.pageOverflow,
    0,
    `${theme}/${mode}/${width}/${screen}: page horizontal overflow`,
  );
  if (screen === 'catalog') {
    assert.equal(measured.chapters, 8);
    assert.equal(measured.lessonLinks, 32);
  }
  if (screen === 'lesson') {
    assert.ok(measured.examples.length > 0, 'A complete C example must be rendered.');
    for (const example of measured.examples) {
      assert.ok(
        example.text.includes('int main'),
        'The lesson example must be a complete program.',
      );
      assert.ok(example.fontSize >= 11);
      assert.ok(example.width > 0 && example.width <= width);
      if (example.scrollWidth > example.clientWidth + 1)
        assert.ok(
          ['auto', 'scroll'].includes(example.overflowX),
          'Long code must remain scrollable inside its own frame.',
        );
      assert.ok(example.tabIndex >= 0, 'Code remains keyboard reachable.');
    }
  }
  if (screen === 'practice') {
    const text = await page.getByTestId('draft-code-editor').locator('textarea').inputValue();
    assert.ok(!text.includes('printf('), 'Independent practice must not start with answer logic.');
    assert.ok(text.includes('main'));
    assert.equal(await page.getByTestId('practice-execution').getAttribute('data-state'), 'ready');
    if (preference === 'hide')
      await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toBeEditable();
    assert.ok(measured.preference?.height >= 44, 'The display control retains a 44px target.');
  }
  const file = `${theme}-${mode}-${width}-${screen}`;
  assert.ok(!report.scenes.some((scene) => scene.file === file));
  await page.screenshot({ path: resolve(directory, `${file}.png`) });
  await page.screenshot({ path: resolve(directory, `${file}-full.png`), fullPage: true });
  const scene = {
    theme,
    width,
    mode,
    screen,
    preference,
    geometry: measured,
    workers: await counts(page),
    file,
  };
  await writeFile(resolve(directory, `${file}.json`), JSON.stringify(scene, null, 2) + '\n', {
    flag: 'wx',
  });
  report.scenes.push(scene);
  console.log(`${file}: actual content, no page overflow`);
}
async function settleTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await frame(page);
}
async function recordEmptyScreens() {
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    try {
      const page = await context.newPage();
      await observe(page);
      await setTheme(page, theme);
      await page.goto(`${baseURL}/#/courses`);
      await ready(page);
      await expect(page.getByTestId('course-reading')).toHaveAttribute('data-state', 'ready');
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await settleTop(page);
        await screenshot(page, { theme, width, mode: 'light', screen: 'catalog' });
      }
      await page.goto(`${baseURL}/#/lessons/${lesson.id}`);
      await ready(page);
      await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
      await expect(
        page.getByRole('heading', { name: lesson.title, exact: true, level: 1 }),
      ).toBeVisible();
      for (const objective of lesson.teaching.objectives)
        await expect(page.getByTestId('lesson-reading')).toContainText(objective);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await settleTop(page);
        await screenshot(page, { theme, width, mode: 'light', screen: 'lesson' });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await setMode(page, 'dark');
      await settleTop(page);
      await screenshot(page, { theme, width: 1440, mode: 'dark', screen: 'lesson' });
      await setMode(page, 'light');
      await page.goto(`${baseURL}/#/practice/${firstExercise.id}`);
      await ready(page);
      await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
      await chooseBlocks(page, 'hide');
      await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#practice-answer').scrollIntoViewIfNeeded();
        await screenshot(page, {
          theme,
          width,
          mode: 'light',
          screen: 'practice',
          preference: 'hide',
        });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await setMode(page, 'dark');
      await chooseBlocks(page, 'show');
      await page.locator('#practice-answer').scrollIntoViewIfNeeded();
      await screenshot(page, {
        theme,
        width: 1440,
        mode: 'dark',
        screen: 'practice',
        preference: 'show',
      });
      assert.equal(
        (await counts(page)).execute,
        0,
        'Passive browsing and empty answer presentation never execute.',
      );
      noLearning(await archive(page));
    } finally {
      await context.close();
    }
  }
}
async function runtimePresentationChecks() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  try {
    const page = await context.newPage();
    await observe(page);
    await page.goto(`${baseURL}/#/practice/${firstExercise.id}`);
    await ready(page);
    await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
    await chooseBlocks(page, 'hide');
    const panel = page.getByTestId('practice-execution'),
      editor = page.getByTestId('draft-code-editor');
    await page.getByRole('textbox', { name: '编辑 C 代码', exact: true }).fill(reference);
    await expect(editor).toHaveAttribute('data-sync', 'synced');
    await panel.getByRole('button', { name: '运行本组', exact: true }).click();
    await expect(panel).toHaveAttribute('data-state', 'ran');
    await expect(page.getByTestId('practice-stdout')).toHaveText(
      firstExercise.tests[0].expectedStdout,
    );
    const accepted = await page.evaluate(() => ({
      request: JSON.parse(new TextDecoder().decode(window.__p05CourseVisual.request)),
      result: JSON.parse(new TextDecoder().decode(window.__p05CourseVisual.response)),
    }));
    assert.equal(accepted.request.subjectRef.id, firstExercise.id);
    assert.deepEqual(accepted.request.input.values, {});
    assert.equal(accepted.result.producer, 'rust');
    assert.equal(accepted.result.terminal.status, 'completed');
    assert.equal(accepted.result.judgeResult.status, 'met');
    assert.deepEqual(accepted.result.identity, accepted.request.identity);
    const revision = await editor.getAttribute('data-document-revision');
    const workers = await counts(page);
    assert.equal(workers.execute, 1);
    const original = await archive(page);
    noLearning(original);
    await writeFile(
      resolve(directory, 'single-real-run.request.json'),
      JSON.stringify(accepted.request, null, 2) + '\n',
      { flag: 'wx' },
    );
    await writeFile(
      resolve(directory, 'single-real-run.result.json'),
      JSON.stringify(accepted.result, null, 2) + '\n',
      { flag: 'wx' },
    );
    for (const theme of themes) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      await page.goto(`${baseURL}/#/practice/${firstExercise.id}`);
      await ready(page);
      for (const width of widths)
        for (const preference of ['hide', 'show']) {
          await page.setViewportSize({ width, height: 900 });
          await chooseBlocks(page, preference);
          await frame(page);
          const measured = await geometry(page);
          assert.equal(measured.pageOverflow, 0);
          assert.equal(await editor.locator('textarea').inputValue(), reference);
          assert.equal(await editor.getAttribute('data-document-revision'), revision);
          assert.equal(await panel.getAttribute('data-state'), 'ran');
          assert.deepEqual(
            await counts(page),
            workers,
            'Theme/viewport/display choices cannot execute or reanalyze the current document.',
          );
          report.runtimeChecks.push({
            theme,
            width,
            mode: 'light',
            preference,
            documentRevision: revision,
            acceptedRunId: accepted.request.identity.runId,
            workers,
            geometry: measured,
          });
        }
      await page.setViewportSize({ width: 1440, height: 900 });
      await setMode(page, 'dark');
      await chooseBlocks(page, 'show');
      assert.equal(await editor.locator('textarea').inputValue(), reference);
      assert.equal(await editor.getAttribute('data-document-revision'), revision);
      assert.equal(await panel.getAttribute('data-state'), 'ran');
      assert.deepEqual(await counts(page), workers);
      const measured = await geometry(page);
      assert.equal(measured.pageOverflow, 0);
      report.runtimeChecks.push({
        theme,
        width: 1440,
        mode: 'dark',
        preference: 'show',
        documentRevision: revision,
        acceptedRunId: accepted.request.identity.runId,
        workers,
        geometry: measured,
      });
    }
    const final = await archive(page);
    noLearning(final);
    assert.deepEqual(final.business, original.business);
    report.singleRealRun = {
      exerciseRef: accepted.request.subjectRef,
      documentRevision: revision,
      acceptedRunId: accepted.request.identity.runId,
      workers,
      checks: report.runtimeChecks.length,
      learningBefore: original,
      learningAfter: final,
    };
  } finally {
    await context.close();
  }
}
try {
  assert.equal(
    await portIsFree(),
    true,
    'Port 4178 already has a process; this runner refuses to attach to another server.',
  );
  const environment = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
  };
  delete environment.P05_HIDE_COURSE_BUNDLE;
  server = spawn(process.execPath, ['scripts/serve-checks.mjs'], {
    cwd: root,
    windowsHide: true,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.ownedServer.pid = server.pid;
  let ownReady = false,
    spawnError;
  server.on('error', (error) => {
    spawnError = error;
  });
  server.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
    if (serverLog.includes('Static engineering checks at http://127.0.0.1:4178')) ownReady = true;
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  for (let attempt = 0; ; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Owned QA server stopped: ${serverLog}`);
    if (ownReady) {
      const response = await fetch(baseURL);
      if (response.ok) break;
    }
    if (attempt >= 100) throw new Error('Owned QA server did not become ready.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  report.ownedServer.started = true;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  report.browserVersion = browser.version();
  await recordEmptyScreens();
  await runtimePresentationChecks();
  assert.equal(report.scenes.length, 66);
  assert.equal(report.runtimeChecks.length, 42);
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  if (browser) await browser.close();
  if (server?.pid) {
    if (server.exitCode === null) server.kill();
    for (
      let attempt = 0;
      server.exitCode === null && server.signalCode === null && attempt < 100;
      attempt++
    )
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    report.ownedServer.stopped = server.exitCode !== null || server.signalCode !== null;
    if (!report.ownedServer.stopped && !failure) {
      failure = new Error('Owned QA server did not stop.');
      report.status = 'failed';
      report.error = { message: failure.message };
    }
  } else report.ownedServer.stopped = true;
  report.completedAtUtc = new Date().toISOString();
  report.screenshots = report.scenes.length * 2;
  await writeFile(resolve(directory, 'server.log'), serverLog, { flag: 'wx' });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    task: 'P0.5-09',
    scenes: report.scenes.length,
    screenshots: report.screenshots,
    runtimePresentationChecks: report.runtimeChecks.length,
    directory,
    ownedServerStopped: report.ownedServer.stopped,
  }),
);
