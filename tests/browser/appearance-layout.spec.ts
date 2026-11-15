import { expect, test, type Page } from '@playwright/test';
import type { ThemeId } from '../../web/src/storage/model';

const themes: readonly ThemeId[] = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'];
const mainDestinations = [
  '/',
  '/courses',
  '/python',
  '/java',
  '/cpp',
  '/rust',
  '/mysql',
  '/practice',
  '/advanced',
  '/cases',
  '/custom-code',
  '/notebook',
  '/study-notes',
  '/achievements',
  '/settings',
];
const menu = (page: Page) => page.getByRole('button', { name: '展开或收起导航', exact: true });
const navigation = (page: Page) => page.getByRole('navigation', { name: '主导航', exact: true });

async function ready(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-config', 'ready');
}

async function openSettings(page: Page) {
  await page.goto('/#/settings?panel=appearance');
  await ready(page);
}

async function saveTheme(page: Page, theme: ThemeId) {
  await page.getByTestId(`theme-${theme}`).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
  await page.getByTestId('save-appearance').click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await expect(page.getByTestId('save-appearance')).toBeDisabled();
}

async function desktopGeometry(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  return page.evaluate(() => {
    const rectangle = (selector: string) => {
      const { x, y, width, height, right } = document
        .querySelector(selector)!
        .getBoundingClientRect();
      return { x, y, width, height, right };
    };
    const tiles = Array.from(document.querySelectorAll('.theme-option')).map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    return {
      viewport: document.documentElement.clientWidth,
      sidebar: rectangle('.sidebar'),
      main: rectangle('.main-content'),
      panel: rectangle('.settings-panel'),
      rightPadding: parseFloat(
        getComputedStyle(document.querySelector('.main-content')!).paddingRight,
      ),
      firstRowCount: tiles.filter((tile) => Math.abs(tile.y - tiles[0].y) < 1).length,
      tileCount: tiles.length,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function expectDrawerClosed(page: Page, focused = true) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-nav-open', 'false');
  await expect(navigation(page)).toBeHidden();
  await expect(page.locator('.app-content')).not.toHaveAttribute('inert');
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
  if (focused) await expect(menu(page)).toBeFocused();
}

test('theme change ripples from the pointer and persists the revealed mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto('/#/settings?panel=display');
  await ready(page);
  await expect(page.getByRole('tabpanel')).toBeVisible();
  const root = page.locator('html');
  const toggle = page.getByTestId('theme-mode-toggle');
  await expect(toggle).toBeEnabled();
  const supported = await page.evaluate(
    () => !!document.startViewTransition && typeof CSS.registerProperty === 'function',
  );
  const bounds = (await toggle.boundingBox())!;
  const x = Math.floor(bounds.x + 13);
  const y = Math.floor(bounds.y + 17);
  await page.mouse.click(x, y);
  if (supported) {
    await expect(root).toHaveAttribute('data-theme-reveal', 'active');
    expect(
      await root.evaluate((html) => [
        html.style.getPropertyValue('--theme-wave-x'),
        html.style.getPropertyValue('--theme-wave-y'),
      ]),
    ).toEqual([`${x}px`, `${y}px`]);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .getAnimations()
            .some(
              (effect) =>
                effect instanceof CSSAnimation && effect.animationName === 'theme-reveal-wave',
            ),
        ),
      )
      .toBe(true);
  }
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).not.toHaveAttribute('data-theme-reveal', 'active');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(root).toHaveAttribute('data-reduced-motion', 'on');
  await expect(toggle).toBeEnabled();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).not.toHaveAttribute('data-theme-reveal', 'active');
});

test('all six saved themes keep one left sidebar and use the available desktop settings width', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings(page);
  const samples = [];
  for (const theme of themes) {
    await saveTheme(page, theme);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('appearance-settings')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
    for (const width of [1366, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(menu(page)).toBeHidden();
      await expect(navigation(page)).toBeVisible();
      const geometry = await desktopGeometry(page);
      expect(geometry.sidebar.x).toBeCloseTo(0, 0);
      expect(geometry.sidebar.y).toBeCloseTo(0, 0);
      expect(geometry.sidebar.width).toBeCloseTo(216, 0);
      expect(geometry.main.x).toBeCloseTo(geometry.sidebar.right, 0);
      expect(geometry.main.right).toBeCloseTo(geometry.viewport, 0);
      expect(geometry.viewport - geometry.panel.right).toBeCloseTo(geometry.rightPadding, 0);
      expect(geometry.tileCount).toBe(6);
      expect(geometry.firstRowCount).toBe(width >= 1900 ? 6 : 3);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
      samples.push({ theme, viewportWidth: width, ...geometry });
      if (theme === 'cute' && width === 2560)
        await page.screenshot({ path: info.outputPath('cute-wide-settings.png'), fullPage: true });
    }
  }
  await info.attach('six-theme-desktop-geometry', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
});

test('the rounded route highlight slides, follows target width and settles after a small rebound', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await ready(page);
  const nav = navigation(page);
  const current = nav.locator('[aria-current="page"]');
  const pill = nav.locator('.sidebar-selection-pill');
  const link = (name: string) => nav.getByRole('link', { name, exact: true });

  // Exercise the same motion with different link widths, even in the regular full-width sidebar.
  await link('MySQL 课程').evaluate((element) => {
    element.style.width = '132px';
    element.style.marginInlineStart = '8px';
  });
  const sampleMotion = (leavePaused = false) =>
    pill.evaluate((element, leavePaused) => {
      const movement = element.getAnimations()[0];
      if (!movement?.effect) throw new Error('Expected an active highlight animation');
      const duration = Number(movement.effect.getComputedTiming().duration);
      movement.pause();
      const sample = (progress: number) => {
        movement.currentTime = duration * progress;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const samples = Array.from({ length: 21 }, (_, i) => sample(i / 20));
      const paused = leavePaused ? sample(0.35) : null;
      if (!leavePaused) movement.finish();
      return { samples, paused };
    }, leavePaused);

  await expect(current).toHaveText('学习首页');
  await expect(pill).toHaveCSS('clip-path', 'none');
  const home = (await current.boundingBox())!;
  const boundsDifference = (actual: typeof home | null, expected: typeof home | null) =>
    actual && expected
      ? Math.max(
          ...(['x', 'y', 'width', 'height'] as const).map((key) =>
            Math.abs(actual[key] - expected[key]),
          ),
        )
      : Infinity;
  await link('MySQL 课程').click();
  await expect(current).toHaveText('MySQL 课程');
  const mysql = (await current.boundingBox())!;
  const { samples: down } = await sampleMotion();
  expect(boundsDifference(down[0], home)).toBeLessThan(0.1);
  expect(down[7].y).toBeGreaterThan(home.y);
  expect(down[7].y).toBeLessThan(mysql.y);
  expect(down[7].width).toBeLessThan(home.width);
  expect(down[7].width).toBeGreaterThan(mysql.width);
  const downwardRebound = Math.max(...down.map(({ y }) => y)) - mysql.y;
  expect(downwardRebound).toBeGreaterThan(0.5);
  expect(downwardRebound).toBeLessThanOrEqual(3.1);
  expect(boundsDifference(await pill.boundingBox(), mysql)).toBeLessThan(0.1);

  await page.goBack();
  await expect(current).toHaveText('学习首页');
  const { samples: up, paused } = await sampleMotion(true);
  expect(boundsDifference(up[0], mysql)).toBeLessThan(0.1);
  expect(up[7].y).toBeGreaterThan(home.y);
  expect(up[7].y).toBeLessThan(mysql.y);
  expect(up[7].width).toBeGreaterThan(mysql.width);
  expect(up[7].width).toBeLessThan(home.width);
  expect(Math.min(...up.map(({ y }) => y))).toBeLessThan(home.y - 0.5);

  await link('Python 课程').click();
  await expect(current).toHaveText('Python 课程');
  const { samples: interrupted } = await sampleMotion();
  expect(boundsDifference(interrupted[0], paused)).toBeLessThan(0.1);
  expect(boundsDifference(await pill.boundingBox(), await current.boundingBox())).toBeLessThan(0.1);

  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
  await expect
    .poll(async () => boundsDifference(await pill.boundingBox(), await current.boundingBox()))
    .toBeLessThan(0.1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'on');
  await link('学习首页').focus();
  await page.keyboard.press('Enter');
  await expect(current).toHaveText('学习首页');
  expect(await pill.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(boundsDifference(await pill.boundingBox(), await current.boundingBox())).toBeLessThan(0.1);
});

test('every theme opens a left vertical drawer on narrow screens and Escape restores the opener', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings(page);
  const samples = [];
  for (const theme of themes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await saveTheme(page, theme);
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expectDrawerClosed(page, false);
      await menu(page).click();
      await expect(navigation(page)).toBeVisible();
      await expect(page.getByRole('button', { name: '收起导航', exact: true })).toBeFocused();
      await expect(page.locator('.app-content')).toHaveAttribute('inert');
      const geometry = await navigation(page).evaluate((element) => {
        const sidebar = element.closest('.sidebar')!.getBoundingClientRect();
        const links = Array.from(element.querySelectorAll('a')).map((link) => {
          const { x, y, width, height } = link.getBoundingClientRect();
          return { x, y, width, height, href: link.getAttribute('href') };
        });
        return { x: sidebar.x, y: sidebar.y, width: sidebar.width, links };
      });
      expect(geometry.x).toBeCloseTo(0, 0);
      expect(geometry.y).toBeCloseTo(0, 0);
      expect(geometry.width).toBeCloseTo(216, 0);
      expect(geometry.links.map((link) => link.href)).toEqual(
        mainDestinations.map((destination) => '#' + destination),
      );
      const links = navigation(page).getByRole('link');
      for (const [index, link] of geometry.links.entries()) {
        expect(link.width).toBeGreaterThan(100);
        expect(link.x).toBeCloseTo(geometry.links[0].x, 0);
        if (index > 0)
          expect(link.y).toBeGreaterThanOrEqual(
            geometry.links[index - 1].y + geometry.links[index - 1].height,
          );
        const target = links.nth(index);
        await target.scrollIntoViewIfNeeded();
        expect(
          await target.evaluate((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            const hit = document.elementFromPoint(x + width / 2, y + height / 2);
            return element.contains(hit);
          }),
        ).toBe(true);
      }
      samples.push({ theme, viewportWidth: width, ...geometry });
      if (theme === 'cute' && width === 390)
        await page.screenshot({ path: info.outputPath('cute-mobile-left-drawer.png') });
      await page.keyboard.press('Escape');
      await expectDrawerClosed(page);
    }
  }
  await info.attach('six-theme-narrow-drawer-geometry', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
});

test('drawer close, backdrop, current-page navigation and viewport expansion remove the inert background', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openSettings(page);
  await saveTheme(page, 'cute');
  await menu(page).click();
  await page.getByRole('button', { name: '收起导航', exact: true }).click();
  await expectDrawerClosed(page);

  await menu(page).click();
  const backdrop = page.getByRole('button', { name: '关闭导航遮罩', exact: true });
  const box = await backdrop.boundingBox();
  expect(box).not.toBeNull();
  await backdrop.click({ position: { x: box!.width - 20, y: 120 } });
  await expectDrawerClosed(page);

  await menu(page).click();
  await navigation(page).getByRole('link', { name: '设置', exact: true }).click();
  await expectDrawerClosed(page);
  await expect(page.getByTestId('appearance-settings')).toBeVisible();

  await menu(page).click();
  await expect(page.locator('.app-content')).toHaveAttribute('inert');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-nav-open', 'false');
  await expect(page.locator('.app-content')).not.toHaveAttribute('inert');
  await expect(menu(page)).toBeHidden();
  await expect(navigation(page)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await expectDrawerClosed(page, false);
  await expect(page.getByTestId('theme-minimal')).toBeEnabled();
});
