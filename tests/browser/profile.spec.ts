import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import type { Avatar, StorageSnapshot } from '../../web/src/storage/model';
import { blockWorkspace, correctStarter, showPracticeBlocks } from './block-ui';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';

const firstDay = new Date('2026-10-20T12:00:00.000Z');
const exerciseId = 'exercise.c.echo';
const lessonId = 'lesson.c.variables-output';
const nextLessonId = 'lesson.c.expressions';
const defaultAvatar: Avatar = { presetId: 'avatar.basic.01', accentColor: '#168A72' };
const status = (page: Page) => page.getByTestId('learning-save-status');
const saveButton = (page: Page) => page.getByRole('button', { name: '保存基础形象', exact: true });
const preview = (page: Page) => page.getByTestId('avatar-preview');

/** This helper only reads the actual eleven stores. It cannot issue learning facts. */
async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const rows = await Promise.all(
        names.map(async (name) => {
          const value = await new Promise<unknown>((resolve, reject) => {
            const store = tx.objectStore(name);
            const request = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
              ? store.get('current')
              : store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return [name, value];
        }),
      );
      await done;
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}

function noLearningChange(before: StorageSnapshot, after: StorageSnapshot) {
  for (const store of [
    'settings',
    'progress',
    'receipts',
    'ledger',
    'dailyFacts',
    'goals',
    'aliases',
  ] as const)
    expect(after[store]).toEqual(before[store]);
  expect(after.meta.generation).toBe(before.meta.generation);
}

function postedTotal(data: StorageSnapshot) {
  return data.ledger
    .filter((row) => row.status === 'posted')
    .reduce((sum, row) => sum + BigInt(row.points!), 0n)
    .toString();
}

async function evidence(testInfo: TestInfo, page: Page, label: string, value: unknown) {
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.3',
    'browser',
    testInfo.project.name,
    label,
  );
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'native-ui.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        browserVersion: page.context().browser()?.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        clockScope:
          'Only Date is fixed; production performance deadline and actual Rust remain active.',
        value,
      },
      null,
      2,
    ) + '\n',
  );
  await testInfo.attach(label, { path, contentType: 'application/json' });
  return directory;
}

async function ready(page: Page) {
  await expect(status(page)).toHaveAttribute('data-save-status', 'ready');
}

async function openAvatar(page: Page) {
  await page.goto('/#/settings?panel=avatar');
  await ready(page);
  await expect(page.getByRole('radiogroup', { name: '选择基础形象', exact: true })).toBeVisible();
  await expect(page.getByLabel('形象强调色', { exact: true })).toBeEnabled();
}

async function setAvatar(page: Page, label: string, color: string) {
  await page.getByRole('radio', { name: label, exact: true }).check();
  await page.getByLabel('形象强调色', { exact: true }).fill(color.toLowerCase());
  await expect(preview(page)).toHaveAttribute('data-avatar-color', color.toUpperCase());
  await expect(page.getByText('形象预览尚未保存。', { exact: true })).toBeVisible();
}

async function saveAvatar(page: Page, value: Avatar) {
  await saveButton(page).click();
  await ready(page);
  await expect.poll(async () => (await snapshot(page)).avatar).toEqual(value);
  await expect(page.getByText('形象预览尚未保存。', { exact: true })).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
}

async function assertHome(page: Page, avatar: Avatar, level: number, points: string) {
  await expect(page.getByTestId('learning-profile')).toBeVisible();
  await expect(page.getByTestId('learning-avatar')).toHaveAttribute(
    'data-avatar-preset',
    avatar.presetId,
  );
  await expect(page.getByTestId('learning-avatar')).toHaveAttribute(
    'data-avatar-color',
    avatar.accentColor,
  );
  await expect(page.getByTestId('learning-level')).toHaveAttribute('data-level', String(level));
  await expect(page.getByTestId('learning-level')).toContainText(`Lv.${level}`);
  await expect(page.getByTestId('learning-posted-points')).toHaveText(points);
  await expect(page.getByTestId('learning-level-progress')).toBeVisible();
}

async function openHome(page: Page) {
  await page.goto('/#/');
  await ready(page);
}

async function completeFirstLesson(page: Page, testInfo: TestInfo, label: string) {
  await page.goto(`/#/lessons/${lessonId}`);
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  await ready(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: '确认已学习', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).receipts.length)
    .toBeGreaterThan(before.receipts.length);
  await ready(page);
  await page.goto(`/#/practice/${exerciseId}`);
  const practice = page.getByTestId('practice-execution');
  await expect(practice).toHaveAttribute('data-state', 'ready');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page)).toBeVisible();
  await ready(page);
  await correctStarter(page, exerciseId);
  await practice.getByRole('button', { name: '准备代码', exact: true }).click();
  await expect(practice.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  await practice.getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(practice).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', 'saved');
  await ready(page);
  const learned = await snapshot(page);
  expect(postedTotal(learned)).toBe('35');
  expect(learned.ledger).toHaveLength(3);
  expect(learned.ledger.map((row) => row.sourceId).sort()).toEqual([
    'reward.daily-goal.once',
    'reward.exercise.first-pass',
    'reward.lesson.first-completion',
  ]);
  const captured = await page.evaluate(() =>
    window.__verticalObservation.workers
      .filter((worker) => worker.kind === 'execute')
      .map((worker) => ({
        ...(
          worker as typeof worker & {
            captureEncoded(): { requestBase64: string | null; responseBase64: string | null };
          }
        ).captureEncoded(),
        moduleSeen: worker.moduleSeen,
        terminated: worker.terminated,
      })),
  );
  expect(captured).toHaveLength(3);
  const directory = join(
    '.artifacts',
    process.env.TASK_EVIDENCE_TASK ?? '11.3',
    'browser',
    testInfo.project.name,
    label,
    'runs',
  );
  await mkdir(directory, { recursive: true });
  for (const [index, run] of captured.entries()) {
    expect(run.moduleSeen).toBe(true);
    expect(run.terminated).toBe(true);
    expect(run.requestBase64).toBeTruthy();
    expect(run.responseBase64).toBeTruthy();
    const requestBytes = Buffer.from(run.requestBase64!, 'base64');
    const resultBytes = Buffer.from(run.responseBase64!, 'base64');
    const request = JSON.parse(requestBytes.toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(resultBytes).buffer, request);
    expect(request.mode).toBe('exercise-test');
    expect(request.subjectRef?.id).toBe(exerciseId);
    expect(request.remainingMs).toBeGreaterThan(0);
    expect(request.remainingMs).toBeLessThanOrEqual(1000);
    expect(result.producer).toBe('rust');
    expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
    expect(result.judgeResult?.status).toBe('met');
    const prefix = `${index + 1}-${request.identity.testCaseKey}`;
    await writeFile(join(directory, `${prefix}.request.json`), requestBytes);
    await writeFile(join(directory, `${prefix}.result.json`), resultBytes);
  }
  return learned;
}

test('four public presets and accent colors persist through refresh and home navigation without producing learning facts', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(firstDay);
  await openAvatar(page);
  const before = await snapshot(page);
  const hex = page.getByRole('textbox', { name: '强调色十六进制', exact: true });
  await hex.fill('#12');
  await expect(hex).toHaveValue('#12');
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByText('形象预览尚未保存。', { exact: true })).toBeVisible();
  await expect(preview(page).locator('svg')).toHaveAttribute('fill', /^#[0-9A-Fa-f]{6}$/);
  await expect(preview(page).locator('svg')).not.toHaveAttribute('fill', '#12');
  const invalidColorUnchanged = await snapshot(page);
  expect(invalidColorUnchanged).toEqual(before);
  await hex.fill('#a246c8');
  await expect(hex).toHaveValue('#A246C8');
  await expect(saveButton(page)).toBeEnabled();
  await saveAvatar(page, { presetId: 'avatar.basic.01', accentColor: '#A246C8' });
  const validHexSaved = await snapshot(page);
  noLearningChange(before, validHexSaved);
  const variants = [
    { label: '芽苗', presetId: 'avatar.basic.02', accentColor: '#A246C8' },
    { label: '方块', presetId: 'avatar.basic.03', accentColor: '#246AC8' },
    { label: '星光', presetId: 'avatar.basic.04', accentColor: '#CA6432' },
    { label: '嫩叶', presetId: 'avatar.basic.01', accentColor: '#168A72' },
  ];
  for (const variant of variants) {
    const avatar = { presetId: variant.presetId, accentColor: variant.accentColor };
    await setAvatar(page, variant.label, variant.accentColor);
    await expect(preview(page)).toHaveAttribute('data-avatar-preset', variant.presetId);
    expect((await snapshot(page)).avatar).not.toEqual(avatar);
    await saveAvatar(page, avatar);
    await page.reload();
    await ready(page);
    await expect(page.getByRole('radio', { name: variant.label, exact: true })).toBeChecked();
    await expect(preview(page)).toHaveAttribute('data-avatar-preset', variant.presetId);
    await openHome(page);
    await assertHome(page, avatar, 1, '0');
    await expect(page.getByTestId('home-continue-learning')).toHaveAttribute(
      'href',
      `#/lessons/${lessonId}`,
    );
    noLearningChange(before, await snapshot(page));
    await openAvatar(page);
  }
  const after = await snapshot(page);
  const directory = await evidence(testInfo, page, 'preset-save-refresh', {
    before,
    after,
    variants,
    invalidHexInput: { value: '#12', saveDisabled: true, invalidColorUnchanged },
    validHexSaved,
  });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: join(directory, `settings-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await openHome(page);
    await assertHome(page, defaultAvatar, 1, '0');
    await page.screenshot({ path: join(directory, `home-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await openAvatar(page);
  }
});

test('a real complete three-group Rust pass raises the posted profile to Lv.2 and continues at the next compatible lesson', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await observeCaseSetExecution(page);
  await openHome(page);
  await assertHome(page, defaultAvatar, 1, '0');
  const learned = await completeFirstLesson(page, testInfo, 'real-35-level');
  const executeCapture = await observedCaseSetExecute(page);
  await openHome(page);
  await assertHome(page, defaultAvatar, 2, '35');
  await expect(page.getByTestId('learning-course-progress')).toContainText('1/6');
  await expect(page.getByTestId('learning-pending-rewards')).toHaveText('0');
  await expect(page.getByTestId('home-continue-learning')).toHaveAttribute(
    'href',
    `#/lessons/${nextLessonId}`,
  );
  const homeText = await page.getByTestId('learning-profile').innerText();
  const beforeRefresh = await snapshot(page);
  await page.reload();
  await ready(page);
  await assertHome(page, defaultAvatar, 2, '35');
  expect(await snapshot(page)).toEqual(beforeRefresh);
  const directory = await evidence(testInfo, page, 'real-35-level', {
    scope: 'Actual Rust results and genuine learning transactions; no seeded rewards.',
    learned,
    homeText,
    beforeRefresh,
    restored: await snapshot(page),
    executeCapture,
  });
  await page.screenshot({ path: join(directory, 'home-level-2.png'), fullPage: true });
  await page.getByTestId('home-continue-learning').click();
  await expect(page).toHaveURL(new RegExp(`/#/lessons/${nextLessonId}$`));
});

test('a native avatar write failure preserves its draft and old saved home profile until explicit retry succeeds', async ({
  page,
  context,
}, testInfo) => {
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(() => {
    const fault = { armed: false, hits: 0 };
    Object.assign(window, { __profileAvatarFault: fault });
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'avatar' && fault.armed) {
        fault.armed = false;
        fault.hits++;
        throw new DOMException('Isolated avatar native put failure', 'QuotaExceededError');
      }
      return key === undefined ? native.call(this, value) : native.call(this, value, key);
    };
  });
  await openAvatar(page);
  const peer = await context.newPage();
  await peer.clock.setFixedTime(firstDay);
  await openHome(peer);
  const before = await snapshot(page);
  const changed = { presetId: 'avatar.basic.04', accentColor: '#A246C8' };
  await setAvatar(page, '星光', changed.accentColor);
  await page.evaluate(() => {
    (
      window as typeof window & { __profileAvatarFault: { armed: boolean } }
    ).__profileAvatarFault.armed = true;
  });
  await saveButton(page).click();
  await expect(status(page)).toHaveAttribute('data-save-status', 'unsaved');
  await expect(preview(page)).toHaveAttribute('data-avatar-preset', changed.presetId);
  await expect(page.getByText('形象预览尚未保存。', { exact: true })).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await assertHome(peer, defaultAvatar, 1, '0');
  await saveAvatar(page, changed);
  await expect(peer.getByTestId('learning-avatar')).toHaveAttribute(
    'data-avatar-preset',
    changed.presetId,
  );
  await assertHome(peer, changed, 1, '0');
  const after = await snapshot(page);
  noLearningChange(before, after);
  const fault = await page.evaluate(
    () =>
      (window as typeof window & { __profileAvatarFault: { hits: number } }).__profileAvatarFault,
  );
  expect(fault.hits).toBe(1);
  await evidence(testInfo, page, 'native-avatar-quota-retry', {
    scope: 'Explicit native API quota injection, not actual disk exhaustion.',
    before,
    after,
    fault,
  });
});

test('two dirty production avatar forms retain their original revisions and reject a stale save without replacing the winning profile', async ({
  page,
  context,
}, testInfo) => {
  await page.clock.setFixedTime(firstDay);
  await openAvatar(page);
  const peer = await context.newPage();
  await peer.clock.setFixedTime(firstDay);
  await openAvatar(peer);
  const before = await snapshot(page);
  const winner = { presetId: 'avatar.basic.02', accentColor: '#A246C8' };
  await setAvatar(page, '芽苗', winner.accentColor);
  await setAvatar(peer, '方块', '#246AC8');
  await saveAvatar(page, winner);
  await expect(preview(peer)).toHaveAttribute('data-avatar-preset', 'avatar.basic.03');
  await expect(peer.getByText('形象预览尚未保存。', { exact: true })).toBeVisible();
  await saveButton(peer).click();
  await expect(status(peer)).toHaveAttribute('data-save-status', 'conflict');
  await expect(preview(peer)).toHaveAttribute('data-avatar-preset', 'avatar.basic.03');
  const saved = await snapshot(peer);
  expect(saved.avatar).toEqual(winner);
  expect(saved.meta.revision).toBe(before.meta.revision + 1);
  noLearningChange(before, saved);
  const losingText = await peer.locator('main').innerText();
  await peer.getByRole('button', { name: '采用已保存形象', exact: true }).click();
  await expect(preview(peer)).toHaveAttribute('data-avatar-preset', winner.presetId);
  await expect(peer.getByText('形象预览尚未保存。', { exact: true })).toHaveCount(0);
  await evidence(testInfo, peer, 'native-avatar-cas', {
    before,
    saved,
    losingText,
    adoptedWithoutOverwrite: await snapshot(peer),
  });
});

test('a real learned profile resets to Lv.1 and a default avatar when a peer clear discards the old dirty form', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await observeCaseSetExecution(page);
  const learned = await completeFirstLesson(page, testInfo, 'clear-real-35');
  await openAvatar(page);
  await setAvatar(page, '星光', '#A246C8');
  const peer = await context.newPage();
  await peer.clock.setFixedTime(firstDay);
  await openHome(peer);
  await assertHome(peer, defaultAvatar, 2, '35');
  await peer.goto('/#/settings?panel=data');
  await ready(peer);
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(status(peer)).toContainText('本地数据已清除');
  await expect(preview(page)).toHaveAttribute('data-avatar-preset', defaultAvatar.presetId);
  await expect(page.getByText('形象预览尚未保存。', { exact: true })).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  const cleared = await snapshot(page);
  expect(cleared.meta.generation).not.toBe(learned.meta.generation);
  expect(cleared.avatar).toEqual(defaultAvatar);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
    expect(cleared[store]).toEqual([]);
  await openHome(page);
  await assertHome(page, defaultAvatar, 1, '0');
  await expect(page.getByTestId('home-continue-learning')).toHaveAttribute(
    'href',
    `#/lessons/${lessonId}`,
  );
  await page.reload();
  await ready(page);
  await assertHome(page, defaultAvatar, 1, '0');
  expect(await snapshot(page)).toEqual(cleared);
  await evidence(testInfo, page, 'clear-discards-profile-draft', {
    learned,
    cleared,
    restored: await snapshot(page),
  });
});

test('a deliberately corrupt native ledger makes points and level unconfirmed instead of claiming a zero-point Lv.1', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(firstDay);
  await openHome(page);
  const before = await snapshot(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('c-viz-learning');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['meta', 'ledger'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        const meta = tx.objectStore('meta').get('current');
        meta.onsuccess = () =>
          tx
            .objectStore('ledger')
            .put({ damaged: true }, [
              (meta.result as StorageSnapshot['meta']).generation,
              'reward.exercise.first-pass',
              'exercise.c.echo',
            ]);
      });
    } finally {
      db.close();
    }
  });
  const damaged = await snapshot(page);
  await page.reload();
  await expect(status(page)).not.toHaveAttribute('data-save-status', 'loading');
  await expect(page.getByTestId('learning-posted-points')).toContainText('暂不可确认');
  await expect(page.getByTestId('learning-level')).toContainText('暂不可确认');
  await expect(page.getByTestId('learning-level')).not.toHaveAttribute('data-level', /[1-5]/);
  expect(await snapshot(page)).toEqual(damaged);
  await evidence(testInfo, page, 'corrupt-ledger-level-unconfirmed', {
    scope: 'Deliberate native malformed-row fault injection; not a genuine learning reward.',
    before,
    damaged,
    preserved: await snapshot(page),
  });
});

test('explicit historical-shape simulation preserves an unknown preset and displays exact posted sums above safe integer range', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(firstDay);
  await observeCaseSetExecution(page);
  const real = await completeFirstLesson(page, testInfo, 'historical-shape-original-real-pass');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('c-viz-learning');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['avatar', 'ledger'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        const cursor = tx.objectStore('ledger').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) {
            row.update({ ...row.value, points: Number.MAX_SAFE_INTEGER });
            row.continue();
          }
        };
        tx.objectStore('avatar').put(
          { presetId: 'avatar.basic.99', accentColor: '#246AC8' },
          'current',
        );
      });
    } finally {
      db.close();
    }
  });
  const simulated = await snapshot(page);
  expect(simulated.progress).toEqual(real.progress);
  expect(simulated.receipts).toEqual(real.receipts);
  expect(simulated.dailyFacts).toEqual(real.dailyFacts);
  const exact = (3n * BigInt(Number.MAX_SAFE_INTEGER)).toString();
  await openHome(page);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('learning-posted-points')).toHaveText(exact);
  await expect(page.getByTestId('learning-level')).toHaveAttribute('data-level', '5');
  await expect(page.getByTestId('learning-level')).toContainText('Lv.5');
  expect((await snapshot(page)).avatar.presetId).toBe('avatar.basic.99');
  await openAvatar(page);
  await expect(page.getByRole('radio', { name: '嫩叶', exact: true })).not.toBeChecked();
  expect((await snapshot(page)).avatar.presetId).toBe('avatar.basic.99');
  await setAvatar(page, '嫩叶', '#246AC8');
  await saveAvatar(page, { presetId: 'avatar.basic.01', accentColor: '#246AC8' });
  const replaced = await snapshot(page);
  noLearningChange(simulated, replaced);
  await evidence(testInfo, page, 'historical-shape-exact-total-and-unknown-preset', {
    scope:
      'Explicit simulation: modifies points on three genuine existing posted rights and sets an unknown prior preset ID. It proves exact aggregation and safe preservation/replacement only; these modified values are not genuine earned points or historical app execution evidence.',
    real,
    simulated,
    exact,
    replaced,
  });
});
