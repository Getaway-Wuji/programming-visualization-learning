import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { C6LearningIndex } from '../../web/src/c6-learning/index';
import type { C6TeachingManifest } from '../../web/src/content/c6-teaching-types';
import { initSync } from '../../web/src/generated/c_viz_wasm';
import { decodeC6Response, type C6Request } from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import {
  archive,
  ready,
  confirm as confirmLegacy,
  openAnswer as answerLegacy,
  submit as submitLegacy,
} from './notebook-helpers';
import {
  confirmCurrentLesson as confirm,
  openCurrentAnswer as openAnswer,
  submitCurrent as submit,
} from './current-course-helpers';
import { installC6Packets, observedC6Packet } from './c6-observation';

const index = JSON.parse(
  readFileSync('content/c/primer6-learning/index-1.0.0.json', 'utf8'),
) as C6LearningIndex;
const manifest = JSON.parse(
  readFileSync('content/c/primer6-teaching/manifest-2.0.0.json', 'utf8'),
) as C6TeachingManifest;
const folder = `.artifacts/15.1/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const graph = (page: Page) => page.getByTestId('c6-knowledge-map');
const count = (page: Page) => graph(page).getByRole('heading', { level: 2 });
const row = (page: Page, id: string) =>
  graph(page)
    .locator('.c6-knowledge-list > li')
    .filter({ has: page.locator(`a[href="#/lessons/${id}"]`) });
async function home(page: Page) {
  await page.goto('/#/');
  await expect(graph(page)).toBeVisible();
  await expect(graph(page).locator('details')).toHaveCount(17);
  await ready(page);
  await expect.poll(async () => (await archive(page)).settings.goalTemplate).not.toBeNull();
}
async function capture(page: Page, name: string) {
  const actual = await observedC6Packet(page);
  expect(actual.moduleSeen).toBe(true);
  expect(actual.terminated).toBe(true);
  expect(actual.response).not.toBeNull();
  const request = JSON.parse(Buffer.from(actual.request!, 'base64').toString('utf8')) as C6Request;
  const bytes = Uint8Array.from(Buffer.from(actual.response!, 'base64'));
  const decoded = await decodeC6Response(bytes.buffer, request, engineBuild.wasmSha256);
  expect(decoded).toHaveProperty('cases');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(actual)), { flag: 'wx' });
}
test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

test('15.1 common: empty graph, every exact lesson destination and selection are read-only', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(installC6Packets);
  await home(page);
  const before = await archive(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  await expect(graph(page).locator('.c6-knowledge-list > li')).toHaveCount(404);
  for (const lesson of index.lessons) {
    const title = manifest.nodes.find((n) => `node.${n.id}` === lesson[1])!.titleDisplay;
    await expect(row(page, lesson[0]).locator('a')).toHaveText(title);
    await expect(row(page, lesson[0]).locator('a')).toHaveAttribute(
      'href',
      `#/lessons/${lesson[0]}`,
    );
    await expect(row(page, lesson[0]).locator('small')).toHaveText('未学完');
  }
  for (const chapter of index.knowledge.filter((k) => k[2] === 'chapter')) {
    const lesson = index.lessons.find((l) => l[2] === chapter[1])!;
    const detail = row(page, lesson[0]).locator('xpath=ancestor::details');
    await detail.locator('summary').click();
    await row(page, lesson[0]).locator('a').click();
    await expect(page.locator('main h1')).toHaveText(
      manifest.nodes.find((n) => `node.${n.id}` === lesson[1])!.titleDisplay,
    );
    await expect(page.locator('.c6-teaching-reading')).toBeVisible();
    await page.goBack();
    await expect(graph(page)).toBeVisible();
  }
  expect(await archive(page)).toEqual(before);
  expect(await page.evaluate(() => window.c6CurrentPackets.length)).toBe(0);
  await mkdir(folder, { recursive: true });
  await writeFile(
    `${folder}/no-side-effects.json`,
    JSON.stringify({ before, after: await archive(page), workers: 0 }, null, 2),
  );
});

test('15.1 common: keyboard selection, three widths and refresh preserve empty state', async ({
  page,
}) => {
  await home(page);
  const before = await archive(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const details = graph(page).locator('details').first();
    const summary = details.locator('summary');
    await summary.focus();
    const open = await details.getAttribute('open');
    await page.keyboard.press('Enter');
    if (open === null) await expect(details).toHaveAttribute('open', '');
    else await expect(details).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await mkdir(folder, { recursive: true });
    await graph(page).screenshot({ path: `${folder}/empty-${width}.png` });
  }
  await page.reload();
  await ready(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  expect(await archive(page)).toEqual(before);
});

test('15.1 formal: real completion lights only related nodes and both-end edges, refresh/repeat/clear restore correctly', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(installC6Packets);
  await home(page);
  const other = await context.newPage();
  await home(other);
  await confirm(page, 'lesson.c6.s1.1');
  await home(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 1 / 421 已点亮');
  await expect(row(page, 'lesson.c6.s1.1').locator('small')).toHaveText('已点亮');
  await confirm(page, 'lesson.c6.s2.1');
  await home(page);
  await expect(row(page, 'lesson.c6.s2.1').locator('small')).toHaveText('未学完');
  await openAnswer(page, 'exercise.c6.s2.1');
  await submit(page);
  await capture(page, 'current-four-cases');
  await home(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 2 / 421 已点亮');
  await expect(row(page, 'lesson.c6.s2.1').locator('small')).toHaveText('已点亮');
  await expect(row(page, 'lesson.c6.s2.2.2').locator('small')).toHaveText('未学完');
  await expect(count(other)).toHaveText('我的知识图谱 · 2 / 421 已点亮');
  const saved = await archive(page);
  expect(saved.progress.filter((p) => p.eventType === 'lesson.completed')).toHaveLength(2);
  await page.reload();
  await ready(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 2 / 421 已点亮');
  await row(page, 'lesson.c6.s2.1').locator('xpath=ancestor::details').locator('summary').click();
  await row(page, 'lesson.c6.s2.1').locator('a').click();
  await ready(page);
  expect(await archive(page)).toEqual(saved);
  await openAnswer(page, 'exercise.c6.s2.1');
  await submit(page);
  expect((await archive(page)).ledger).toEqual(saved.ledger);
  await home(page);
  await mkdir(folder, { recursive: true });
  await graph(page).screenshot({ path: `${folder}/lit-1440.png` });
  await writeFile(`${folder}/saved-completion.json`, JSON.stringify(await archive(page), null, 2));
  await page.goto('/#/settings?panel=data');
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(count(other)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  expect((await archive(other)).progress).toEqual([]);
  await other.reload();
  await ready(other);
  await expect(count(other)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
});

test('15.1 formal: failed native transaction keeps graph unlearned until original event retry is acknowledged', async ({
  page,
}) => {
  await page.addInitScript(installC6Packets);
  await page.addInitScript(() => {
    const control = { armed: false, ids: [] as string[] };
    Object.assign(window, { __knowledgeQuota: control });
    for (const method of ['put', 'add'] as const) {
      const add = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        const r = value as { eventType?: string; eventId: string };
        if (this.name === 'receipts' && r.eventType === 'exercise.passed') {
          control.ids.push(r.eventId);
          if (control.armed) {
            control.armed = false;
            throw new DOMException('15.1 native current quota', 'QuotaExceededError');
          }
        }
        return key === undefined ? add.call(this, value) : add.call(this, value, key);
      };
    }
  });
  await confirm(page, 'lesson.c6.s2.1');
  await openAnswer(page, 'exercise.c6.s2.1');
  const before = await archive(page);
  await page.evaluate(() => {
    (window as unknown as { __knowledgeQuota: { armed: boolean } }).__knowledgeQuota.armed = true;
  });
  await page.getByRole('button', { name: '判定全部四组', exact: true }).click();
  await expect(page.getByRole('heading', { name: '四组全部通过', exact: true })).toBeVisible();
  await expect(page.getByTestId('learning-save-status')).toContainText('尚未保存');
  await expect(page.getByRole('button', { name: '重试未保存操作', exact: true })).toBeVisible();
  await capture(page, 'quota-accepted-current-four-cases');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'unsaved',
  );
  const failed = await archive(page);
  expect(failed.progress).toEqual(before.progress);
  expect(failed.ledger).toEqual(before.ledger);
  await page.goto('/#/');
  await expect(count(page)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await ready(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 1 / 421 已点亮');
  const saved = await archive(page);
  expect(saved.progress.filter((p) => p.eventType === 'lesson.completed')).toHaveLength(1);
  expect(saved.ledger.filter((l) => l.points === 10)).toHaveLength(1);
  const ids = await page.evaluate(
    () => (window as unknown as { __knowledgeQuota: { ids: string[] } }).__knowledgeQuota.ids,
  );
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(new Set(ids).size).toBe(1);
  expect(await page.evaluate(() => window.c6CurrentPackets.length)).toBe(1);
  await page.reload();
  await ready(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 1 / 421 已点亮');
  expect((await archive(page)).ledger).toEqual(saved.ledger);
});

test('15.1 formal: real original-course completion survives the reviewed 32-lesson upgrade without rewriting history', async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = resolve('.artifacts/21.5/legacy-production');
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL as string).origin)
      return route.continue();
    const file = resolve(
      root,
      '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
    );
    if (!file.startsWith(root + sep) || !existsSync(file)) return route.abort();
    await route.fulfill({
      body: readFileSync(file),
      contentType: mime[extname(file)] ?? 'application/octet-stream',
    });
  });
  await confirmLegacy(page, 'lesson.c.variables-output');
  await answerLegacy(page, 'exercise.c.echo');
  await submitLegacy(page);
  const old = await archive(page);
  expect(old.progress.some((p) => p.eventType === 'lesson.completed')).toBe(true);
  expect(old.ledger.some((l) => (l.points ?? 0) > 0)).toBe(true);
  await page.unroute('**/*');
  await page.reload();
  await home(page);
  const current = await archive(page);
  expect(current.meta.generation).not.toBe(old.meta.generation);
  expect(current.meta.schemaVersion).toBe('10.0.0');
  expect(current.progress).toEqual([]);
  expect(current.ledger).toEqual([]);
  expect(current.settings.theme).toBe(old.settings.theme);
  await expect(count(page)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  await page.reload();
  await ready(page);
  expect((await archive(page)).meta.generation).toBe(current.meta.generation);
  expect((await archive(page)).progress).toEqual([]);
});

test('15.1 common: unavailable storage is pending confirmation and recovers without a fake completion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    let blocked = true;
    Object.assign(window, {
      __knowledgeRestoreStorage: () => {
        blocked = false;
      },
    });
    indexedDB.open = (...args: Parameters<IDBFactory['open']>) => {
      if (blocked) throw new DOMException('15.1 storage fault', 'SecurityError');
      return open(...args);
    };
  });
  await page.goto('/#/');
  await expect(count(page)).toHaveText('我的知识图谱 · 学习记录待确认');
  await expect(graph(page).getByText('记录待确认', { exact: true })).toHaveCount(404);
  await expect(graph(page)).not.toContainText('0 / 421 已点亮');
  await page.evaluate(() =>
    (window as unknown as { __knowledgeRestoreStorage(): void }).__knowledgeRestoreStorage(),
  );
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重新读取档案', exact: true })
    .click();
  await ready(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  expect((await archive(page)).progress).toEqual([]);
});

test('15.1 common: unavailable reading fails locally and normal course retry restores the map', async ({
  page,
}) => {
  const pattern = '**/content/c/primer6-teaching/manifest-2.0.0.json';
  await page.route(pattern, (route) =>
    route.fulfill({ status: 404, body: 'Explicit unavailable current manifest' }),
  );
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: '课程暂时无法读取', exact: true })).toBeVisible();
  await expect(graph(page)).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(graph(page)).toBeVisible();
  await ready(page);
  await expect(count(page)).toHaveText('我的知识图谱 · 0 / 421 已点亮');
  expect((await archive(page)).progress).toEqual([]);
});
