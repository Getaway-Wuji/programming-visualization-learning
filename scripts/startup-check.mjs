// Owned, temporary dev/preview processes; never attach to or stop a user's server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { checkEnvironment } from './environment.mjs';
import { workspaceDir } from './process.mjs';
import { engineBuild } from '../web/src/generated/engine-build.ts';

const environment = checkEnvironment({ bindgen: true });
const records = [];
// A recurring QA run must not overwrite archived 03.4/09.x evidence.
const evidenceTask = process.env.TASK_EVIDENCE_TASK ?? 'current';
assert.match(evidenceTask, /^(?:[0-9]{2}\.[0-9]+|P0\.5-(?:0[1-9]|10)|current)$/);
const qaPrefix = process.env.STARTUP_QA_PREFIX ?? `.artifacts/${evidenceTask}/startup-current`;

async function available(port) {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => {
      const selected = listener.address().port;
      listener.close(() => resolve(selected));
    });
  });
}

async function ownedPort(preferred) {
  try {
    return await available(preferred);
  } catch (error) {
    if (!['EACCES', 'EADDRINUSE'].includes(error.code)) throw error;
    // Windows can reserve a port without a listening process. Ask the OS for
    // another QA port; never attach to or terminate the existing owner's server.
    const selected = await available(0);
    console.log(`QA port ${preferred} unavailable (${error.code}); using owned port ${selected}.`);
    return selected;
  }
}

async function waitForOwnedServer(server, output, port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null || output.error) {
      throw new Error(`Owned ${port} startup failed: ${output.text}`);
    }
    // Readiness must come from this process, never an unrelated HTTP response.
    if (output.text.includes(`http://127.0.0.1:${port}/`)) {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: globalThis.AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    }
    await delay(50);
  }
  throw new Error(`Owned ${port} startup timed out: ${output.text}`);
}

await mkdir(dirname(join(workspaceDir, qaPrefix)), { recursive: true });
try {
  for (const [mode, preferredPort] of [
    ['dev', 5174],
    ['preview', 4174],
  ]) {
    const port = await ownedPort(preferredPort);
    const server = spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        ...(mode === 'preview' ? ['preview'] : []),
        '--config',
        'vite.config.ts',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      { cwd: workspaceDir, stdio: 'pipe', windowsHide: true },
    );
    const output = { text: '', error: false };
    server.on('error', (error) => {
      output.error = true;
      output.text += error.message;
    });
    for (const stream of [server.stdout, server.stderr])
      stream.on('data', (value) => {
        output.text += value.toString();
      });
    let browser;
    try {
      await waitForOwnedServer(server, output, port);
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.addInitScript(
        ({ wasmBytes }) => {
          const audit = (globalThis.startupAudit = {
            workers: [],
            writes: 0,
            databaseOpens: 0,
            wasmFetches: 0,
            compiles: 0,
            moduleHashes: [],
          });
          const nativeFetch = globalThis.fetch;
          globalThis.fetch = (...args) => {
            if (/\.wasm(?:\?|$)/.test(String(args[0]))) audit.wasmFetches++;
            return nativeFetch(...args);
          };
          const compile = globalThis.WebAssembly.compile.bind(globalThis.WebAssembly);
          globalThis.WebAssembly.compile = (...args) => {
            audit.compiles++;
            return compile(...args);
          };
          const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
          globalThis.crypto.subtle.digest = async (algorithm, data) => {
            const result = await digest(algorithm, data);
            if (data.byteLength === wasmBytes)
              audit.moduleHashes.push(
                Array.from(new Uint8Array(result), (byte) =>
                  byte.toString(16).padStart(2, '0'),
                ).join(''),
              );
            return result;
          };
          const NativeWorker = globalThis.Worker;
          globalThis.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              this.record = { terminated: false };
              audit.workers.push(this.record);
              this.addEventListener('message', (event) => {
                if (event.data.buffer instanceof ArrayBuffer) {
                  this.record.build = JSON.parse(
                    new TextDecoder('utf-8', { fatal: true }).decode(event.data.buffer),
                  );
                  this.record.workerInstanceId = event.data.workerInstanceId;
                }
              });
            }
            postMessage(message, options = []) {
              this.record.nonce = message.nonce;
              this.record.kinds ??= [];
              this.record.kinds.push(message.kind);
              super.postMessage(message, options);
            }
            terminate() {
              this.record.terminated = true;
              super.terminate();
            }
          };
          const setItem = globalThis.Storage.prototype.setItem;
          globalThis.Storage.prototype.setItem = function (...args) {
            audit.writes++;
            return setItem.apply(this, args);
          };
          const open = globalThis.indexedDB.open.bind(globalThis.indexedDB);
          globalThis.indexedDB.open = (...args) => {
            audit.databaseOpens++;
            return open(...args);
          };
        },
        { wasmBytes: engineBuild.wasmBytes },
      );
      const requests = [];
      const pageErrors = [];
      page.on('request', (request) =>
        requests.push({
          path: new URL(request.url()).pathname,
          method: request.method(),
          origin: new URL(request.url()).origin,
        }),
      );
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const origin = `http://127.0.0.1:${port}`;
      await page.goto(`${origin}/#/lessons/lesson.c.variables-output`);
      await page.locator('[data-testid="lesson-reading"][data-state="ready"]').waitFor();
      assert.ok(
        (await page.getByTestId('lesson-reading').locator('pre').allTextContents()).some((source) =>
          source.includes('int main(void)'),
        ),
      );
      await page.getByRole('link', { name: '进入练习工作区' }).click();
      await page.locator('[data-testid="practice-execution"][data-state="ready"]').waitFor();
      await page.locator('[data-testid="draft-code-editor"][data-sync="synced"]').waitFor();
      const answerCode = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
      assert.match(await answerCode.inputValue(), /int main\(void\)/);
      assert.equal(await answerCode.getAttribute('readonly'), null);
      assert.equal(
        await page.getByRole('button', { name: '提交练习', exact: true }).isEnabled(),
        true,
      );
      assert.equal(
        await page.getByRole('button', { name: '准备代码', exact: true }).isEnabled(),
        true,
      );
      assert.equal(await page.getByTestId('engine-connection').count(), 0);
      assert.equal(await page.getByTestId('player-controls').getAttribute('data-length'), '0');
      assert.equal(await page.getByTestId('practice-stdout').count(), 0);
      assert.equal(await page.getByTestId('step-output').count(), 0);
      const passivePractice = await page.evaluate(() => globalThis.startupAudit);
      assert.equal(passivePractice.workers.length, 1);
      assert.deepEqual(passivePractice.workers[0].kinds, ['analyze-code']);
      assert.equal(passivePractice.workers[0].build.kind, 'analysisResult');
      assert.equal(passivePractice.workers[0].build.status, 'valid');
      assert.equal(passivePractice.workers[0].build.analysisVersion, '1.0.0');
      assert.equal(passivePractice.writes, 0);
      assert.equal(passivePractice.wasmFetches, 1);
      assert.equal(passivePractice.compiles, 1);
      assert.deepEqual(passivePractice.moduleHashes, [engineBuild.wasmSha256]);
      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link', { name: '算法与演示', exact: true })
        .click();
      await page.locator('main a[href="#/visualize/case.c.assignment"]').click();
      await page
        .locator(
          '[data-page-id="PAGE-06"][data-mode="case"] [data-testid="content-sample"][data-state="ready"]',
        )
        .waitFor();
      assert.match(await page.getByTestId('content-sample').innerText(), /已审核案例 · 独立观看/);
      assert.equal(
        await page.getByTestId('content-sample').getAttribute('data-content-scope'),
        'case-view',
      );
      assert.ok(
        (await page.getByTestId('content-sample').innerText()).includes(
          `内容版本 ${existsSync(join(workspaceDir, 'content/c/p0/blockly-release-1.0.14.json')) ? '1.0.0' : '1.0.2'}`,
        ),
      );
      await page.locator('[data-testid="case-execution"][data-state="ready"]').waitFor();
      assert.match(
        await page.getByTestId('code-panel').locator('textarea').inputValue(),
        /int main\(void\)/,
      );
      assert.equal(
        await page.getByRole('button', { name: '运行示例', exact: true }).isEnabled(),
        true,
      );
      assert.equal(await page.getByTestId('player-controls').getAttribute('data-length'), '0');
      assert.equal(await page.getByTestId('execution-output').count(), 0);
      assert.equal(await page.getByTestId('step-output').count(), 0);
      const passiveCase = await page.evaluate(() => globalThis.startupAudit);
      assert.equal(passiveCase.workers.length, 1);
      assert.equal(passiveCase.workers[0].terminated, true);
      assert.deepEqual(passiveCase.workers[0].kinds, ['analyze-code']);
      assert.equal(passiveCase.wasmFetches, 1);
      assert.equal(passiveCase.compiles, 1);
      assert.deepEqual(passiveCase.moduleHashes, [engineBuild.wasmSha256]);
      await page.getByRole('button', { name: '检查执行模块' }).click();
      await page.locator('[data-testid="engine-connection"][data-state="ready"]').waitFor();
      const audit = await page.evaluate(() => globalThis.startupAudit);
      assert.equal(audit.workers.length, 2);
      assert.equal(audit.workers[1].terminated, true);
      assert.deepEqual(audit.workers[1].build, {
        kind: 'build-probe',
        probeVersion: '1.0.0',
        nonce: audit.workers[1].nonce,
        engineVersion: '0.1.0',
        interpreterReady: false,
      });
      assert.equal(audit.writes, 0);
      assert.equal(audit.wasmFetches, 1);
      assert.equal(audit.compiles, 1);
      assert.deepEqual(audit.moduleHashes, [engineBuild.wasmSha256]);
      assert.ok(audit.databaseOpens >= 1);
      const learningRows = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = globalThis.indexedDB.open('c-viz-learning', 7);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          const names = ['progress', 'dailyFacts', 'goals', 'ledger', 'receipts', 'aliases'];
          const tx = db.transaction(names, 'readonly');
          const businessCounts = await Promise.all(
            names.map(
              (name) =>
                new Promise((resolve, reject) => {
                  const req = tx.objectStore(name).count();
                  req.onsuccess = () => resolve(req.result);
                  req.onerror = () => reject(req.error);
                }),
            ),
          );
          return { storeNames: Array.from(db.objectStoreNames).sort(), businessCounts };
        } finally {
          db.close();
        }
      });
      assert.deepEqual(learningRows.storeNames, [
        'achievements',
        'aliases',
        'appearance',
        'appearanceAssets',
        'avatar',
        'dailyFacts',
        'editHistory',
        'goals',
        'knowledgeMarks',
        'ledger',
        'meta',
        'progress',
        'receipts',
        'reviewCards',
        'settings',
      ]);
      assert.deepEqual(learningRows.businessCounts, [0, 0, 0, 0, 0, 0]);
      assert.match(
        await page.getByTestId('code-panel').locator('textarea').inputValue(),
        /int main\(void\)/,
      );
      assert.equal(await page.getByRole('button', { name: '运行程序', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '提交练习', exact: true }).count(), 0);
      assert.equal(
        await page.getByRole('button', { name: '运行示例', exact: true }).isEnabled(),
        true,
      );
      assert.equal(await page.getByTestId('case-execution').getAttribute('data-state'), 'ready');
      assert.equal(await page.getByTestId('player-controls').getAttribute('data-length'), '0');
      assert.equal(await page.getByTestId('execution-output').count(), 0);
      assert.deepEqual(pageErrors, []);
      assert.ok(requests.every((request) => request.origin === origin && request.method === 'GET'));
      await page.screenshot({
        path: join(workspaceDir, `${qaPrefix}-${mode}.png`),
        fullPage: true,
      });
      records.push({
        mode,
        preferredPort,
        port,
        browserVersion: browser.version(),
        contentReady: true,
        practiceReady: true,
        passivePractice,
        passiveCase,
        interpreterReady: false,
        audit,
        requests,
        pageErrors,
      });
    } finally {
      try {
        await browser?.close();
      } finally {
        if (server.exitCode === null && server.signalCode === null) {
          const closed = new Promise((resolve) => server.once('exit', resolve));
          server.kill();
          await closed;
        }
        await available(port);
      }
    }
  }
  await writeFile(
    join(workspaceDir, `${qaPrefix}.json`),
    JSON.stringify(
      {
        evidenceLevel: 'real-owned-dev-and-preview-startup',
        environment,
        records,
        ownedProcessesStopped: true,
        userPreviewPort4173Untouched: true,
        freshMachineInstallTested: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Owned dev and preview: real content / Rust-WASM checks passed; processes stopped.');
} catch (error) {
  await writeFile(
    join(workspaceDir, `${qaPrefix}-failure.json`),
    JSON.stringify(
      {
        completed: records,
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
}
