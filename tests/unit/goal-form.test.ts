// @vitest-environment jsdom
import { act, createElement, Fragment, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningServiceState } from '../../web/src/learning/service';
import { loadGoalConfiguration } from '../../web/src/learning/goals';
import { createMeta, emptySnapshot, type StorageSnapshot } from '../../web/src/storage/model';

const learning = vi.hoisted(() => ({
  state: null as LearningServiceState | null,
  service: {
    getState: vi.fn(),
    saveGoalTemplate: vi.fn(),
    refresh: vi.fn(),
  },
}));
vi.mock('../../web/src/learning/react', () => ({
  useLearning: () => ({ state: learning.state, service: learning.service }),
}));

let components: {
  DailyGoalSettings: ComponentType;
  DailyGoalSummary: ComponentType;
  GoalHistory: ComponentType;
};
let root: Root;
let container: HTMLDivElement;
let currentComponent: ComponentType;
const at = '2026-10-20T02:00:00.000Z';
const configuration = await loadGoalConfiguration();

function archive(): StorageSnapshot {
  const snapshot = emptySnapshot(
    createMeta({
      generation: '11200000-0000-4000-8000-000000000010',
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: { id: 'content.c.p0', version: '1.0.1' },
      revision: 10,
    }),
  );
  snapshot.settings.goalTemplate = {
    revision: 1,
    targets: { ...configuration.recommended },
  };
  return snapshot;
}
function initialState(): LearningServiceState {
  return {
    status: 'ready',
    goalStatus: 'ready',
    goalConfiguration: configuration,
    snapshot: archive(),
    projection: null,
    errorCode: null,
    lastSaved: false,
    capabilities: { learning: true, goalsConfigurable: true, avatarPresets: ['avatar.basic.01'] },
    timeZoneFallback: false,
    recovery: null,
    temporary: false,
    pendingCount: 0,
    sessionEpoch: 0,
    cleared: false,
  };
}
function publish(state: LearningServiceState) {
  learning.state = state;
  root.render(createElement(currentComponent));
}
async function render(component: ComponentType) {
  currentComponent = component;
  await act(async () => root.render(createElement(component)));
}
function input(label: string) {
  const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(element).not.toBeNull();
  return element!;
}
async function fill(label: string, value: string) {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === text,
  );
  expect(button).not.toBeUndefined();
  await act(async () => button!.click());
}

beforeAll(async () => {
  // Load actual TSX through Vite while this project's tool TypeScript target remains .ts-only.
  components = await vi.importActual<typeof components>('../../web/src/learning/goal-components');
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(at));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  learning.state = initialState();
  learning.service.getState.mockImplementation(() => learning.state);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('11.2 goal form and saved check-in UI', () => {
  it('retains a conflicted draft and its original CAS revision after failed refresh, then adopts a confirmed refreshed template', async () => {
    await render(components.DailyGoalSettings);
    await fill('每日练习数', '2');
    expect(input('每日练习数').value).toBe('2');

    const concurrent = structuredClone(learning.state!.snapshot!);
    concurrent.meta.revision = 11;
    concurrent.settings.goalTemplate = {
      revision: 2,
      targets: { exercise: 3, lesson: 0, case: 0 },
    };
    await act(async () => publish({ ...learning.state!, snapshot: concurrent }));
    learning.service.saveGoalTemplate.mockImplementation(async () => {
      publish({
        ...learning.state!,
        status: 'conflict',
        errorCode: 'S_REVISION_CONFLICT',
        lastSaved: false,
      });
    });
    await click('保存自定义目标');
    expect(learning.service.saveGoalTemplate).toHaveBeenLastCalledWith(
      { exercise: 2, lesson: 1, case: 0 },
      10,
    );

    // refresh resolves just like the real service, which reports failures through state.
    learning.service.refresh.mockImplementationOnce(async () => {
      publish({
        ...learning.state!,
        status: 'unsaved',
        errorCode: 'S_STORAGE_UNAVAILABLE',
        lastSaved: false,
      });
    });
    await click('重新读取目标');
    expect(input('每日练习数').value).toBe('2');
    expect(input('每日小节数').value).toBe('1');
    expect(container.textContent).toContain('重新读取失败');
    expect(container.textContent).not.toContain('已重新读取');

    await click('保存自定义目标');
    expect(learning.service.saveGoalTemplate).toHaveBeenLastCalledWith(
      { exercise: 2, lesson: 1, case: 0 },
      10,
    );

    const latest = structuredClone(concurrent);
    latest.meta.revision = 20;
    latest.settings.goalTemplate = {
      revision: 3,
      targets: { exercise: 4, lesson: 0, case: 0 },
    };
    learning.service.refresh.mockImplementationOnce(async () => {
      publish({
        ...learning.state!,
        snapshot: latest,
        status: 'ready',
        errorCode: null,
        lastSaved: false,
      });
    });
    await click('重新读取目标');
    expect(input('每日练习数').value).toBe('4');
    expect(input('每日小节数').value).toBe('0');
    expect(container.textContent).toContain('已重新读取');

    learning.service.saveGoalTemplate.mockImplementationOnce(async () => {
      publish({ ...learning.state!, status: 'ready', lastSaved: true });
    });
    await click('保存自定义目标');
    expect(learning.service.saveGoalTemplate).toHaveBeenLastCalledWith(
      { exercise: 4, lesson: 0, case: 0 },
      20,
    );
    expect(container.textContent).toContain('目标已保存');
  });

  it('shows saved counts and no check-in when only the temporary projection has achieved a goal', async () => {
    const snapshot = learning.state!.snapshot!;
    const goal = {
      localDate: '2026-10-20',
      goalVersion: 1,
      targets: { exercise: 1, lesson: 1, case: 0 },
      achievedAt: null,
    };
    snapshot.goals.push(goal);
    learning.state = {
      ...learning.state!,
      status: 'unsaved',
      temporary: true,
      pendingCount: 1,
      projection: {
        lessons: [],
        exercises: [],
        cases: [],
        history: [],
        settings: snapshot.settings,
        avatar: snapshot.avatar,
        ledger: { totalPoints: '35', pending: [], history: [] },
        goals: [
          {
            ...goal,
            achievedAt: at,
            counts: { exercise: 1, lesson: 1, case: 0 },
            remaining: { exercise: 0, lesson: 0, case: 0 },
            reachable: true,
          },
        ],
      },
    };
    await render(() =>
      createElement(
        Fragment,
        null,
        createElement(components.DailyGoalSummary),
        createElement(components.GoalHistory),
      ),
    );
    const summary = container.querySelector('[data-testid="daily-goal-summary"]')!;
    expect(summary.getAttribute('data-goal-state')).toBe('active');
    expect(summary.querySelector('[data-testid="goal-progress-exercise"]')!.textContent).toContain(
      '0 / 1',
    );
    expect(summary.querySelector('[data-testid="goal-progress-lesson"]')!.textContent).toContain(
      '0 / 1',
    );
    expect(summary.textContent).toContain('未保存的学习尚未计入打卡');
    expect(summary.textContent).not.toContain('今日已打卡');
    expect(summary.textContent).not.toContain('打卡已保存');
    const history = container.querySelector('[data-testid="goal-history"]')!;
    expect(history.textContent).toContain('已保存 0 天打卡');
    expect(history.textContent).toContain('未达成');
    expect(snapshot.goals[0].achievedAt).toBeNull();
  });
});
