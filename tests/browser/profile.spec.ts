import { expect, test, type Page } from '@playwright/test';
import { completeCurrentFirstGroup } from './current-course-helpers';
import { installC6Packets } from './c6-observation';
import type { Avatar, StorageSnapshot } from '../../web/src/storage/model';

const firstDay = new Date('2026-11-05T04:00:00.000Z');
const defaultAvatar: Avatar = { presetId: 'avatar.basic.01', accentColor: '#168A72' };
/** This helper only reads the actual stores. It cannot issue learning facts. */
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

function postedTotal(data: StorageSnapshot) {
  return data.ledger
    .filter((row) => row.status === 'posted')
    .reduce((sum, row) => sum + BigInt(row.points!), 0n)
    .toString();
}

// The retired avatar form and home level widgets are intentionally absent.
// Browser coverage now checks the current public profile, its retained archive,
// real earned points, failure recovery and cross-tab data boundaries.
const points = (page: Page, amount: string) =>
  page.getByRole('button', {
    name: `积分 ${amount}，查看明细`,
    exact: true,
  });
async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
async function home(page: Page) {
  await page.goto('/#/');
  await ready(page);
}
async function display(page: Page) {
  await page.goto('/#/settings?panel=display');
  await ready(page);
}
async function saveDisplay(page: Page, mode: string) {
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption(mode);
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
}
async function realPass(page: Page) {
  await completeCurrentFirstGroup(page);
  await ready(page);
  const saved = await snapshot(page);
  expect(postedTotal(saved)).toBe('35');
  expect(saved.ledger).toHaveLength(3);
  expect(saved.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(1);
  return saved;
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(firstDay);
  await page.addInitScript(installC6Packets);
});

test('current settings preserve the stored avatar and expose themes without retired profile controls', async ({
  page,
  context,
}) => {
  await home(page);
  const before = await snapshot(page);
  expect(before.avatar).toEqual(defaultAvatar);
  await page.goto('/#/settings?panel=avatar');
  await expect(page.getByRole('tab', { name: '外观与主题', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('radiogroup', { name: '选择基础形象', exact: true })).toHaveCount(0);
  await display(page);
  await saveDisplay(page, 'dark');
  await page.reload();
  await ready(page);
  expect((await snapshot(page)).avatar).toEqual(before.avatar);
  expect((await snapshot(page)).progress).toEqual(before.progress);
  const reopened = await context.newPage();
  await home(reopened);
  await expect(points(reopened, '0')).toBeVisible();
  expect((await snapshot(reopened)).settings.theme).toBe('dark');
  expect((await snapshot(reopened)).avatar).toEqual(before.avatar);
});

test('a real complete four-case pass updates current header points and refresh never duplicates awards', async ({
  page,
}) => {
  const saved = await realPass(page);
  await home(page);
  await expect(points(page, '35')).toBeVisible();
  await expect(page.getByTestId('learning-profile')).toHaveCount(0);
  await points(page, '35').click();
  await expect(
    page.getByRole('dialog', { name: '积分明细' }).locator('.reward-ledger > li'),
  ).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.reload();
  await ready(page);
  expect((await snapshot(page)).ledger).toEqual(saved.ledger);
  await expect(points(page, '35')).toBeVisible();
});

test('a failed native preference save preserves the stored avatar and points until explicit retry succeeds', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const control = { armed: false, hits: 0 };
    Object.assign(window, { profilePreferenceFault: control });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'settings' && control.armed) {
        control.armed = false;
        control.hits++;
        throw new DOMException('Profile preference QA fault', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await home(page);
  await display(page);
  const before = await snapshot(page);
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.evaluate(() => {
    (
      window as unknown as { profilePreferenceFault: { armed: boolean } }
    ).profilePreferenceFault.armed = true;
  });
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'unsaved',
  );
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await ready(page);
  const saved = await snapshot(page);
  expect(saved.settings.theme).toBe('dark');
  expect(saved.avatar).toEqual(before.avatar);
  expect(saved.ledger).toEqual(before.ledger);
  expect(saved.progress).toEqual(before.progress);
});

test('a peer observes genuinely earned points without replacing its saved preferences or avatar', async ({
  page,
  context,
}) => {
  await home(page);
  const peer = await context.newPage();
  await home(peer);
  const original = await snapshot(peer);
  await realPass(page);
  await peer.bringToFront();
  await peer.reload();
  await ready(peer);
  await expect(points(peer, '35')).toBeVisible();
  const saved = await snapshot(peer);
  expect(saved.avatar).toEqual(original.avatar);
  expect(saved.settings.theme).toBe(original.settings.theme);
  const ledger = saved.ledger;
  await peer.reload();
  await ready(peer);
  expect((await snapshot(peer)).ledger).toEqual(ledger);
});

test('a peer clear removes real points and restores the retained avatar without reviving an old profile', async ({
  page,
  context,
}) => {
  const learned = await realPass(page);
  await home(page);
  const peer = await context.newPage();
  await peer.goto('/#/settings?panel=data');
  await ready(peer);
  await peer.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await peer.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).meta.generation)
    .not.toBe(learned.meta.generation);
  await expect(points(page, '0')).toBeVisible();
  const cleared = await snapshot(page);
  expect(cleared.avatar).toEqual(defaultAvatar);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(cleared[store]).toEqual([]);
  await page.reload();
  await ready(page);
  await expect(points(page, '0')).toBeVisible();
  expect((await snapshot(page)).progress).toEqual([]);
});

async function alterArchive(page: Page, mode: 'corrupt' | 'large') {
  await page.evaluate(async (mode) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('c-viz-learning');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['meta', 'avatar', 'ledger'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        if (mode === 'corrupt') {
          const meta = tx.objectStore('meta').get('current');
          meta.onsuccess = () =>
            tx
              .objectStore('ledger')
              .put({ damaged: true }, [
                meta.result.generation,
                'reward.exercise.first-pass',
                'exercise.c.echo',
              ]);
        } else {
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
        }
      });
    } finally {
      db.close();
    }
  }, mode);
}

test('a deliberately corrupt ledger leaves current header points unconfirmed and preserves the damaged evidence', async ({
  page,
}) => {
  await home(page);
  await alterArchive(page, 'corrupt');
  const damaged = await snapshot(page);
  await page.reload();
  await expect(
    page.getByRole('button', { name: '积分暂不可确认，查看明细', exact: true }),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(damaged);
});

test('an explicit large-sum simulation preserves an unknown stored avatar and exact points across current settings', async ({
  page,
}) => {
  await realPass(page);
  await alterArchive(page, 'large');
  const simulated = await snapshot(page);
  const exact = (3n * BigInt(Number.MAX_SAFE_INTEGER)).toString();
  await home(page);
  await page.reload();
  await ready(page);
  await expect(points(page, exact)).toBeVisible();
  await display(page);
  await saveDisplay(page, 'dark');
  const saved = await snapshot(page);
  expect(saved.avatar).toEqual(simulated.avatar);
  expect(saved.avatar.presetId).toBe('avatar.basic.99');
  expect(saved.ledger).toEqual(simulated.ledger);
  expect(saved.progress).toEqual(simulated.progress);
  await page.reload();
  await ready(page);
  await expect(points(page, exact)).toBeVisible();
});
