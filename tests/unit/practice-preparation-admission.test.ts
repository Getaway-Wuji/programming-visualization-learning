// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningServiceState } from '../../web/src/learning/service';
import type { PreparationEngine } from '../../web/src/engine/preparation';
import { bugQuestions } from '../../web/src/bugs/content';

const ports = vi.hoisted(() => ({
  prepare: vi.fn(),
  state: null as LearningServiceState | null,
  listeners: new Set<() => void>(),
  invalidate: new Set<() => void>(),
  service: {
    getState: vi.fn(),
    subscribeSessionInvalidation: vi.fn(),
    recordPracticePass: vi.fn(),
    recordPracticeAttempt: vi.fn(),
  },
  sessions: [] as {
    current: { exerciseId?: string; phase: string; accepted?: boolean };
    enter: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  }[],
  analysis: vi.fn(),
}));
vi.mock('../../web/src/engine/preparation', () => ({ prepareEngine: ports.prepare }));
vi.mock('../../web/src/learning/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useLearning: () => ({
      service: ports.service,
      state: useSyncExternalStore(
        (listener) => {
          ports.listeners.add(listener);
          return () => ports.listeners.delete(listener);
        },
        () => ports.state!,
      ),
    }),
  };
});
vi.mock('../../web/src/practice/session', () => ({
  PracticeSession: class {
    current: { exerciseId?: string; phase: string; accepted?: boolean } = { phase: 'empty' };
    player = { pause: vi.fn(), setRate: vi.fn() };
    getSnapshot = () => this.current;
    close = vi.fn(() => {
      this.current = { phase: 'empty' };
    });
    cancel = vi.fn(() => {
      if (['running', 'preparing'].includes(this.current.phase))
        this.current = { ...this.current, phase: 'cancelled', accepted: false };
    });
    checkDeadline = vi.fn();
    enter = vi.fn((id?: string, review = false) => {
      if (!id) this.close();
      else if (review && this.current.exerciseId === id) this.player.pause();
      else {
        this.current = { exerciseId: id, phase: review ? 'empty' : 'ready' };
        if (!review) ports.analysis(id);
      }
    });
    constructor() {
      ports.sessions.push(this);
    }
  },
}));

let Gate: ComponentType<{ engine: PreparationEngine; children: ReactNode }>;
let AdmissionProvider: ComponentType<{ scope: string; children: ReactNode }>;
let PracticeProvider: ComponentType<{ children: ReactNode }>;
let useLearning: () => { state: LearningServiceState };
let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
let attempts: { engine: PreparationEngine; signal: AbortSignal; resolve(): void; reject(): void }[];
const bug = bugQuestions[0].exerciseRef.id;
const otherBug = bugQuestions[1].exerciseRef.id;

function Pane() {
  const { pathname } = useLocation();
  const engine = pathname === '/python/workbench' ? 'python' : 'c';
  if (pathname.endsWith('/review') || pathname === '/settings' || pathname === '/courses')
    return createElement('h1', null, '保留的阅读或复盘页面');
  return createElement(Gate, {
    engine,
    children: createElement('h1', { 'data-workspace': true }, '练习工作区'),
  });
}
function Scope() {
  const { pathname } = useLocation();
  const { state } = useLearning();
  return createElement(AdmissionProvider, {
    scope: JSON.stringify([pathname, state.sessionEpoch, state.snapshot?.meta.generation]),
    children: createElement(PracticeProvider, { children: createElement(Pane) }),
  });
}
async function render(path = `/practice/${bug}`) {
  router = createMemoryRouter([{ path: '*', element: createElement(Scope) }], {
    initialEntries: [path],
  });
  await act(async () => root.render(createElement(RouterProvider, { router })));
}
const session = () => ports.sessions[0];

beforeAll(async () => {
  ({ EnginePreparationGate: Gate } = await vi.importActual(
    '../../web/src/components/EnginePreparationGate',
  ));
  ({ PreparationAdmissionProvider: AdmissionProvider } = await vi.importActual(
    '../../web/src/components/engine-preparation-state',
  ));
  ({ PracticeProvider } = await vi.importActual('../../web/src/practice/react'));
  ({ useLearning } = await import('../../web/src/learning/react'));
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  ports.listeners.clear();
  ports.invalidate.clear();
  ports.sessions = [];
  ports.analysis.mockReset();
  ports.prepare.mockReset();
  ports.service.recordPracticePass.mockReset();
  ports.service.recordPracticeAttempt.mockReset();
  ports.service.getState.mockImplementation(() => ports.state);
  ports.service.subscribeSessionInvalidation.mockImplementation((callback: () => void) => {
    ports.invalidate.add(callback);
    return () => ports.invalidate.delete(callback);
  });
  ports.state = {
    sessionEpoch: 1,
    c6: { status: 'ready' },
    snapshot: { meta: { generation: 'generation-a' }, settings: { playbackRate: 1 } },
  } as LearningServiceState;
  attempts = [];
  ports.prepare.mockImplementation(
    (engine: PreparationEngine, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) =>
        attempts.push({
          engine,
          signal,
          resolve,
          reject: () => reject(new Error('download failed')),
        }),
      ),
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

describe('global practice provider uses explicit prepared route admission', () => {
  it('does not enter or analyze an old C exercise until its preparation succeeds', async () => {
    await render();
    expect(session().enter).not.toHaveBeenCalled();
    expect(ports.analysis).not.toHaveBeenCalled();
    expect(container.querySelector('[data-workspace]')).toBeNull();
    await act(async () => attempts[0].resolve());
    expect(session().enter).toHaveBeenCalledWith(bug, false, undefined);
    expect(ports.analysis).toHaveBeenCalledTimes(1);
    expect(ports.service.recordPracticePass).not.toHaveBeenCalled();
  });

  it('does not enter after a preparation failure and enters normally after an explicit retry', async () => {
    await render();
    await act(async () => attempts[0].reject());
    expect(ports.analysis).not.toHaveBeenCalled();
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '重试加载',
    );
    await act(async () => retry!.click());
    expect(attempts[0].signal.aborted).toBe(true);
    expect(session().enter).not.toHaveBeenCalled();
    await act(async () => attempts[1].resolve());
    expect(ports.analysis).toHaveBeenCalledExactlyOnceWith(bug);
  });

  it('cancels a departed route and rejects its late ready after switching language', async () => {
    await render();
    const old = attempts[0];
    await act(async () => router.navigate('/python/workbench'));
    expect(old.signal.aborted).toBe(true);
    await act(async () => old.resolve());
    expect(ports.analysis).not.toHaveBeenCalled();
    await act(async () => attempts[1].resolve());
    expect(ports.analysis).not.toHaveBeenCalled();
  });

  it('requires the new route ticket even when another exercise uses the same engine', async () => {
    await render();
    const old = attempts[0];
    await act(async () => router.navigate(`/practice/${otherBug}`));
    expect(old.signal.aborted).toBe(true);
    await act(async () => old.resolve());
    expect(ports.analysis).not.toHaveBeenCalled();
    await act(async () => attempts[1].resolve());
    expect(ports.analysis).toHaveBeenCalledExactlyOnceWith(otherBug);
  });

  it('never lets a prior archive generation admit a new-generation practice session', async () => {
    await render();
    const old = attempts[0];
    await act(async () => {
      ports.state = {
        ...ports.state!,
        sessionEpoch: 2,
        snapshot: {
          ...ports.state!.snapshot!,
          meta: { ...ports.state!.snapshot!.meta, generation: 'generation-b' },
        },
      };
      ports.invalidate.forEach((invalidate) => invalidate());
      ports.listeners.forEach((listener) => listener());
    });
    expect(old.signal.aborted).toBe(true);
    await act(async () => old.resolve());
    expect(ports.analysis).not.toHaveBeenCalled();
    await act(async () => attempts[1].resolve());
    expect(ports.analysis).toHaveBeenCalledExactlyOnceWith(bug);
  });

  it('preserves a stable accepted result through settings and a pure retained review', async () => {
    await render();
    await act(async () => attempts[0].resolve());
    session().current.accepted = true;
    await act(async () => router.navigate('/settings'));
    expect(session().current.accepted).toBe(true);
    await act(async () => router.navigate(`/practice/${bug}/review`));
    expect(session().enter).toHaveBeenLastCalledWith(bug, true, undefined);
    expect(session().current.accepted).toBe(true);
    expect(ports.analysis).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
  });

  it('drops an accepted old-generation session on state change even before an invalidation notification', async () => {
    await render();
    await act(async () => attempts[0].resolve());
    session().current.accepted = true;
    await act(async () => {
      ports.state = {
        ...ports.state!,
        sessionEpoch: 2,
        snapshot: {
          ...ports.state!.snapshot!,
          meta: { ...ports.state!.snapshot!.meta, generation: 'generation-b' },
        },
      };
      ports.listeners.forEach((listener) => listener());
    });
    expect(session().current.phase).toBe('empty');
    expect(session().current.accepted).toBeUndefined();
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(ports.analysis).toHaveBeenCalledTimes(1);
    await act(async () => attempts[1].resolve());
    expect(ports.analysis).toHaveBeenCalledTimes(2);
  });

  it('closes unfinished exercise loading when leaving instead of letting it analyze later', async () => {
    await render();
    await act(async () => attempts[0].resolve());
    session().current = { exerciseId: bug, phase: 'loading' };
    await act(async () => router.navigate('/settings'));
    expect(session().current.phase).toBe('empty');
    expect(ports.analysis).toHaveBeenCalledTimes(1);
  });
});
