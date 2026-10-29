/* global window, document */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve('.');
const baseURL = 'http://127.0.0.1:4178';
const label = process.env.TASK_EVIDENCE_LABEL ?? 'initial';
const directory = resolve('.artifacts/P0.5-08', `visual-${label}`);
await mkdir(directory, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-checks.mjs'], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk.toString()));
server.stderr.on('data', (chunk) => (serverLog += chunk.toString()));
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`QA server stopped: ${serverLog}`);
    try {
      const response = await fetch(baseURL);
      if (response.ok) break;
    } catch {
      // Wait only for this owned local server to become reachable.
    }
    if (attempt >= 100) throw new Error('Owned static QA server did not start.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const scenarios = [];
  for (const theme of ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const counters = { execute: 0, analysis: 0 };
      Object.assign(window, { __p05PresentationVisual: counters });
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, options = []) {
          if (message?.kind === 'execute') counters.execute++;
          if (message?.kind === 'analyze-code') counters.analysis++;
          return super.postMessage(message, options);
        }
      };
    });
    await page.goto(`${baseURL}/#/settings?panel=appearance`);
    await page.getByTestId('appearance-settings').waitFor();
    await page.getByTestId(`theme-${theme}`).click();
    if (await page.getByTestId('save-appearance').isEnabled())
      await page.getByTestId('save-appearance').click();
    await page.locator('html[data-appearance-draft="false"]').waitFor();
    await page.goto(`${baseURL}/#/practice/exercise.c.echo`);
    const panel = page.getByTestId('practice-execution');
    const preference = page.getByTestId('block-workspace-preference');
    const choice = preference.getByRole('combobox', { name: '积木显示', exact: true });
    const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
    const editor = page.getByTestId('draft-code-editor');
    await page.locator('[data-testid="practice-execution"][data-state="ready"]').waitFor();
    await page.locator('.app-shell[data-learning-storage-status="ready"]').waitFor();
    await choice.selectOption('hide');
    await page
      .locator('[data-testid="block-preference-save-status"][data-save-state="saved"]')
      .waitFor();
    await code.waitFor();
    const text =
      '#include <stdio.h>\nint main(void) {\n  int x = 7;\n  // 当前代码由 Rust 真实执行\n  printf("%d\\n", x);\n  return 0;\n}\n';
    await code.fill(text);
    await page.locator('[data-testid="draft-code-editor"][data-sync="synced"]').waitFor();
    await panel.getByRole('button', { name: '运行本组', exact: true }).click();
    await page.locator('[data-testid="practice-execution"][data-state="ran"]').waitFor();
    const revision = await editor.getAttribute('data-document-revision');
    const workerCounts = await page.evaluate(() => ({ ...window.__p05PresentationVisual }));
    const themeScenarios = [
      ...[1440, 768, 390].flatMap((width) =>
        ['hide', 'show'].map((value) => ({ width, value, mode: 'light' })),
      ),
      ...['hide', 'show'].map((value) => ({ width: 1440, value, mode: 'dark' })),
    ];
    for (const { width, value, mode } of themeScenarios) {
      await page.setViewportSize({ width, height: 900 });
      if (
        mode === 'dark' &&
        (await page.locator('html').getAttribute('data-color-mode')) !== 'dark'
      ) {
        const darkAlready = await page
          .locator('html')
          .evaluate(
            (element) => element.dataset.theme === 'dark' || element.dataset.colorMode === 'dark',
          );
        if (!darkAlready) await page.getByTestId('theme-mode-toggle').click();
      }
      if ((await choice.inputValue()) !== value) await choice.selectOption(value);
      await page
        .locator('[data-testid="block-preference-save-status"][data-save-state="saved"]')
        .waitFor();
      await page
        .locator(
          `[data-testid="practice-editor-layout"][data-blocks-visible="${value === 'show' ? 'yes' : 'no'}"]`,
        )
        .waitFor();
      if (value === 'show') {
        const workbench = page.locator('[data-testid="workbench"][data-kind="practice"]');
        const tab = workbench.getByRole('tab', { name: '积木', exact: true });
        if (await tab.isVisible()) await tab.click();
        await page
          .getByRole('region', { name: '积木工作区', exact: true })
          .locator('.blocklySvg')
          .waitFor();
      }
      await page.locator('#practice-answer').scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => {
        const bounds = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            visible: rect.width > 0 && rect.height > 0,
          };
        };
        return {
          viewportWidth: document.documentElement.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          editor: bounds('[data-testid="draft-code-editor"]'),
          blocks: bounds('[aria-label="积木工作区"]'),
          answer: bounds('#practice-answer'),
          preference: bounds('[data-testid="block-workspace-preference"]'),
          html: { ...document.documentElement.dataset },
          workers: { ...window.__p05PresentationVisual },
        };
      });
      if (geometry.pageOverflow > 1)
        throw new Error(`${theme}/${width}/${value} overflows by ${geometry.pageOverflow}px`);
      if (
        geometry.workers.execute !== workerCounts.execute ||
        geometry.workers.analysis !== workerCounts.analysis
      )
        throw new Error(`${theme}/${width}/${value} presentation caused execution or reanalysis`);
      if ((await editor.getAttribute('data-document-revision')) !== revision)
        throw new Error('Presentation changed the logical document revision.');
      if ((await editor.locator('textarea').inputValue()) !== text)
        throw new Error('Presentation changed the draft bytes.');
      if ((await panel.getAttribute('data-state')) !== 'ran')
        throw new Error('Presentation discarded the accepted run.');
      const file = `${theme}-${mode}-${width}-${value}`;
      await page.screenshot({ path: resolve(directory, `${file}.png`) });
      await page.screenshot({ path: resolve(directory, `${file}-full.png`), fullPage: true });
      scenarios.push({ theme, mode, width, preference: value, revision, text, geometry, file });
      console.log(`${file}: retained real run and draft`);
    }
    await context.close();
  }
  await writeFile(
    resolve(directory, 'report.json'),
    JSON.stringify(
      { createdAtUtc: new Date().toISOString(), browserVersion: browser.version(), scenarios },
      null,
      2,
    ),
  );
  console.log(
    `Visual evidence complete: ${scenarios.length} scenes, ${scenarios.length * 2} screenshots.`,
  );
} finally {
  if (browser) await browser.close();
  server.kill();
  await writeFile(resolve(directory, 'server.log'), serverLog);
}
