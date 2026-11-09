// @vitest-environment jsdom
import { act, createElement, useEffect, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparationEngine } from '../../web/src/engine/preparation';

const preparation = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../web/src/engine/preparation', () => ({ prepareEngine: preparation.run }));

interface Attempt {
  engine: PreparationEngine;
  signal: AbortSignal;
  resolve(): void;
  reject(cause: unknown): void;
}
let Gate: ComponentType<{ engine: PreparationEngine; label?: string; children: ReactNode }>;
let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
let attempts: Attempt[];
let mounted: PreparationEngine[];

function Workspace({ engine }: { engine: PreparationEngine }) {
  useEffect(() => {
    mounted.push(engine);
  }, [engine]);
  return createElement('h1', { tabIndex: -1, 'data-workspace': engine }, `${engine} workspace`);
}
function RoutedPage() {
  const { engine } = useParams();
  return createElement(
    'main',
    { id: 'main-content', tabIndex: -1 },
    engine === 'reading'
      ? createElement('h1', null, '课程阅读')
      : createElement(Gate, {
          engine: engine as PreparationEngine,
          children: createElement(Workspace, { engine: engine as PreparationEngine }),
        }),
  );
}
async function render(path = '/mysql') {
  router = createMemoryRouter([{ path: '/:engine', element: createElement(RoutedPage) }], {
    initialEntries: [path],
  });
  await act(async () => root.render(createElement(RouterProvider, { router })));
}
const status = () => container.querySelector<HTMLElement>('[data-testid="engine-preparation"]');

beforeAll(async () => {
  const actual = await vi.importActual<{ EnginePreparationGate: typeof Gate }>(
    '../../web/src/components/EnginePreparationGate',
  );
  Gate = actual.EnginePreparationGate;
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  attempts = [];
  mounted = [];
  preparation.run.mockReset();
  preparation.run.mockImplementation(
    (engine: PreparationEngine, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => attempts.push({ engine, signal, resolve, reject })),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

describe('route engine preparation boundary', () => {
  it('does not mount an executable child before preparation, then mounts it exactly once', async () => {
    await render();
    expect(status()?.dataset).toMatchObject({ engine: 'mysql', state: 'loading' });
    expect(container.textContent).toContain('当前尚未开始运行程序');
    expect(container.querySelector('[data-workspace]')).toBeNull();
    expect(mounted).toEqual([]);
    await act(async () => attempts[0].resolve());
    expect(status()?.dataset.state).toBe('ready');
    expect(mounted).toEqual(['mysql']);
    expect(container.querySelector('[data-workspace="mysql"]')).not.toBeNull();
  });

  it('aborts the old route and ignores its late ready while the next engine is still preparing', async () => {
    await render('/mysql');
    const old = attempts[0];
    await act(async () => router.navigate('/python'));
    expect(old.signal.aborted).toBe(true);
    expect(attempts[1].engine).toBe('python');
    await act(async () => old.resolve());
    expect(status()?.dataset).toMatchObject({ engine: 'python', state: 'loading' });
    expect(mounted).toEqual([]);
    await act(async () => attempts[1].resolve());
    expect(mounted).toEqual(['python']);
  });

  it('keeps reading navigation available, aborts preparation and ignores a late failure', async () => {
    await render('/mysql');
    const old = attempts[0];
    const link = container.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(link?.textContent).toBe('返回学习首页');
    await act(async () => router.navigate('/reading'));
    expect(old.signal.aborted).toBe(true);
    await act(async () => old.reject(new Error('late download failure')));
    expect(status()).toBeNull();
    expect(container.textContent).toBe('课程阅读');
    expect(mounted).toEqual([]);
  });

  it('shows a failure and retries with a fresh signal before opening the workspace', async () => {
    await render();
    await act(async () => attempts[0].reject({ code: 'E_PREPARATION_TIMEOUT' }));
    expect(status()?.dataset.state).toBe('failed');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('本次准备已停止');
    const retry = container.querySelector('button');
    expect(retry?.textContent).toBe('重试加载');
    await act(async () => retry!.click());
    expect(attempts[0].signal.aborted).toBe(true);
    expect(attempts[1].signal.aborted).toBe(false);
    expect(status()?.dataset.state).toBe('loading');
    expect(mounted).toEqual([]);
    await act(async () => attempts[1].resolve());
    expect(mounted).toEqual(['mysql']);
  });

  it('hands an owned preparation title focus to the finished title', async () => {
    await render();
    container.querySelector<HTMLElement>('h1')!.focus();
    await act(async () => attempts[0].resolve());
    expect(document.activeElement).toBe(container.querySelector('[data-workspace]'));
  });

  it('does not steal focus when the user has moved to another navigation control', async () => {
    await render();
    container.querySelector<HTMLElement>('h1')!.focus();
    const control = document.createElement('button');
    document.body.append(control);
    control.focus();
    await act(async () => attempts[0].resolve());
    expect(document.activeElement).toBe(control);
    control.remove();
  });

  it('prepares again on a later route entry instead of retaining a permanent ready flag', async () => {
    await render();
    await act(async () => attempts[0].resolve());
    await act(async () => router.navigate('/reading'));
    await act(async () => router.navigate('/mysql'));
    expect(attempts).toHaveLength(2);
    expect(status()?.dataset.state).toBe('loading');
    expect(mounted).toEqual(['mysql']);
    await act(async () => attempts[1].resolve());
    expect(mounted).toEqual(['mysql', 'mysql']);
  });
});
