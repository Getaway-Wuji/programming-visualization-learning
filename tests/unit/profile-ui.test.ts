// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { continueLesson, type CourseReading } from '../../web/src/content/reading';
import { projectLearning } from '../../web/src/learning/domain';
import {
  loadProfileConfiguration,
  type ProfileConfiguration,
} from '../../web/src/learning/profile';
import type { LearningServiceState } from '../../web/src/learning/service';
import type { LearningProjection } from '../../web/src/learning/types';
import {
  createMeta,
  emptySnapshot,
  type Avatar,
  type Progress,
  type Ref,
  type StorageSnapshot,
} from '../../web/src/storage/model';
import { validateSnapshot } from '../../web/src/storage/validation';

// This suite isolates profile/points UI; real review context is covered by its own native tests.
vi.mock('../../web/src/achievements/react', () => ({ AchievementSummary: () => null }));
vi.mock('../../web/src/review-scheduler/react', () => ({ ReviewDueSummary: () => null }));

const learning = vi.hoisted(() => ({
  state: null as LearningServiceState | null,
  service: {
    reloadProfileConfiguration: vi.fn(),
    refresh: vi.fn(),
    getState: vi.fn(),
    saveAvatar: vi.fn(),
    saveDisplay: vi.fn(),
    settleRewards: vi.fn(),
  },
}));
vi.mock('../../web/src/learning/react', () => ({
  useLearning: () => ({ state: learning.state, service: learning.service }),
  // Isolate the global status strip; the settings form and its async handlers are actual TSX.
  LearningSaveStatus: ({ onRefresh, dirty }: { onRefresh?: () => void; dirty?: boolean }) =>
    createElement(
      'div',
      { 'data-testid': 'learning-save-status', 'data-save-status': dirty ? 'unsaved' : 'ready' },
      createElement('span', null, dirty ? '当前更改尚未保存' : '本地档案已读取'),
      onRefresh && createElement('button', { onClick: onRefresh }, '重新读取档案'),
    ),
}));

let components: {
  ProfileSummary: ComponentType;
  AvatarPicture: ComponentType<{
    avatar: Avatar;
    configuration?: ProfileConfiguration | null;
    testId?: string;
  }>;
  savedCourseProjection: (state: LearningServiceState) => LearningProjection | null;
};
let root: Root;
let container: HTMLDivElement;
let pages: { SettingsPage: ComponentType; HomePage: ComponentType };
const dialogDescriptors = new Map(
  ['showModal', 'close'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
  ]),
);
const at = '2026-10-20T02:00:00.000Z';
const later = '2026-10-20T03:00:00.000Z';
const configuration = await loadProfileConfiguration();
// These are isolated projection fixtures, never production learning/reward evidence.
const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;

function archive(): StorageSnapshot {
  return emptySnapshot(
    createMeta({
      generation: '11300000-0000-4000-8000-000000000010',
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: reading.packageRef,
    }),
  );
}
function started(ref: Ref, learningRevision = 1, lastAt = at): Progress {
  return {
    eventType: 'lesson.started',
    result: 'started',
    subjectRef: { ...ref },
    packageRef: { ...reading.packageRef },
    learningRevision,
    firstAt: at,
    lastAt,
  };
}
function initialState(): LearningServiceState {
  const snapshot = archive();
  return {
    status: 'ready',
    profileStatus: 'ready',
    profileConfiguration: configuration,
    reading,
    readingStatus: 'ready',
    snapshot,
    projection: projectLearning(snapshot, reading.catalog),
    errorCode: null,
    lastSaved: false,
    capabilities: {
      learning: true,
      goalsConfigurable: false,
      avatarPresets: configuration.avatars.map((avatar) => avatar.presetId),
    },
    timeZoneFallback: false,
    recovery: null,
    temporary: false,
    pendingCount: 0,
    sessionEpoch: 0,
    cleared: false,
  };
}
async function render(component: ComponentType = components.ProfileSummary, path = '/') {
  await act(async () =>
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(component))),
  );
}
function level() {
  return container.querySelector('[data-testid="learning-level"]')!;
}
function confirmedAwards(snapshot: StorageSnapshot) {
  const subjects = [
    {
      eventType: 'exercise.passed',
      result: 'passed',
      subjectRef: reading.catalog.exercises[0].ref,
      sourceId: 'reward.exercise.first-pass',
      points: 10,
    },
    {
      eventType: 'lesson.completed',
      result: 'completed',
      subjectRef: reading.catalog.lessons[0].ref,
      sourceId: 'reward.lesson.first-completion',
      points: 20,
    },
    {
      eventType: 'case.view-confirmed',
      result: 'confirmed',
      subjectRef: { id: 'case.c.assignment', version: '1.0.1' },
      sourceId: 'reward.case.first-view',
      points: 5,
    },
  ] as const;
  for (const subject of subjects) {
    snapshot.progress.push({
      eventType: subject.eventType,
      result: subject.result,
      subjectRef: { ...subject.subjectRef },
      packageRef: { ...reading.packageRef },
      learningRevision: 1,
      firstAt: at,
      lastAt: at,
    } as Progress);
    snapshot.ledger.push({
      sourceId: subject.sourceId,
      subjectId: subject.subjectRef.id,
      occurredAt: at,
      localDate: '2026-10-20',
      status: 'posted',
      points: subject.points,
      policyRef: { id: 'reward.policy.p0', version: '1.0.0' },
    });
  }
}

beforeAll(async () => {
  // Actual TSX goes through Vite while the tool TypeScript target remains .ts-only.
  components = await vi.importActual<typeof components>(
    '../../web/src/learning/profile-components',
  );
  const settings = await vi.importActual<{ default: ComponentType }>(
    '../../web/src/pages/SettingsPage',
  );
  const home = await vi.importActual<{ HomePage: ComponentType }>('../../web/src/pages/HomePage');
  pages = { SettingsPage: settings.default, HomePage: home.HomePage };
});
beforeEach(() => {
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
  for (const [name, descriptor] of dialogDescriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  vi.unstubAllGlobals();
});

describe('11.3 saved profile presentation and continuation', () => {
  it('keeps level, saved course progress and continuation on durable rows while a temporary projection claims completion and 35 points', async () => {
    const state = learning.state!;
    const before = structuredClone(state.snapshot!);
    const temporary = structuredClone(state.projection!);
    temporary.ledger.totalPoints = '35';
    temporary.lessons[0] = { ...temporary.lessons[0], started: true, completed: true };
    temporary.history.push(started(reading.catalog.lessons[1].ref, 1, later));
    learning.state = {
      ...state,
      status: 'unsaved',
      temporary: true,
      pendingCount: 1,
      projection: temporary,
    };
    await render();
    expect(level().getAttribute('data-level')).toBe('1');
    expect(container.textContent).toContain('还需 30 分');
    const saved = components.savedCourseProjection(learning.state)!;
    expect(saved.lessons.filter((lesson) => lesson.completed)).toHaveLength(0);
    expect(saved.ledger.totalPoints).toBe('0');
    expect(continueLesson(reading, saved)).toBe(reading.lessons[0].id);
    expect(continueLesson(reading, temporary)).toBe(reading.lessons[1].id);
    expect(state.snapshot).toEqual(before);
  });

  it('derives Lv.2 from valid posted 35 points while pending rights and a much larger cached projection do not count', async () => {
    const snapshot = learning.state!.snapshot!;
    confirmedAwards(snapshot);
    snapshot.progress.push({
      eventType: 'case.view-confirmed',
      result: 'confirmed',
      subjectRef: { id: 'case.c.branch', version: '1.0.1' },
      packageRef: reading.packageRef,
      learningRevision: 1,
      firstAt: at,
      lastAt: at,
    });
    snapshot.ledger.push({
      sourceId: 'reward.case.first-view',
      subjectId: 'case.c.branch',
      occurredAt: at,
      localDate: '2026-10-20',
      status: 'pending',
      points: null,
      policyRef: null,
    });
    expect(validateSnapshot(snapshot)).toBe(true);
    learning.state!.projection!.ledger.totalPoints = '90071992547409910';
    const before = structuredClone(snapshot);
    await render();
    expect(level().getAttribute('data-level')).toBe('2');
    expect(container.textContent).toContain('距离 Lv.3 还需 65 分');
    expect(container.querySelector('progress')!.value).toBe(7);
    expect(snapshot).toEqual(before);
  });

  it('withdraws level and progress when the ledger is uncertain or the archive has not been read, preserving every original row', async () => {
    const snapshot = learning.state!.snapshot!;
    confirmedAwards(snapshot);
    const before = structuredClone(snapshot);
    learning.state = {
      ...learning.state!,
      status: 'readonly',
      recovery: {
        writable: false,
        appearanceReadOnly: false,
        appearanceCanReset: true,
        ledgerUncertain: true,
        issues: [{ store: 'ledger', count: 1 }],
        canClear: true,
        resettable: [],
        errorCode: 'S_RECORD_INVALID',
      },
    };
    await render();
    expect(level().textContent).toBe('等级暂不可确认');
    expect(level().getAttribute('data-level')).toBe('');
    expect(container.querySelector('progress')).toBeNull();
    expect(snapshot).toEqual(before);
    learning.state = { ...learning.state!, status: 'loading', snapshot: null };
    await render();
    expect(level().textContent).toBe('等级暂不可确认');
    expect(container.querySelector('[data-testid="learning-avatar"]')).toBeNull();
    expect(components.savedCourseProjection(learning.state)).toBeNull();
  });

  it('labels an unknown historical preset as unavailable without drawing or silently substituting a leaf', async () => {
    const avatar = { presetId: 'avatar.basic.99', accentColor: '#A246C8' };
    const before = structuredClone(avatar);
    await render(() => createElement(components.AvatarPicture, { avatar, configuration }));
    const picture = container.querySelector('[role="img"]')!;
    expect(picture.getAttribute('data-avatar-state')).toBe('unavailable');
    expect(picture.getAttribute('data-avatar-preset')).toBe('avatar.basic.99');
    expect(picture.getAttribute('aria-label')).toContain('形象资源暂不可用');
    expect(picture.querySelector('svg')).toBeNull();
    expect(picture.textContent).toContain('暂不可用');
    expect(avatar).toEqual(before);
  });

  it('uses a safe SVG fill for an invalid in-progress color rather than interpreting a URL paint value', async () => {
    const avatar = {
      presetId: 'avatar.basic.04',
      accentColor: 'url(https://avatar.invalid/image.svg#paint)',
    };
    await render(() => createElement(components.AvatarPicture, { avatar, configuration }));
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('fill')).toBe('#168A72');
    expect(svg.querySelectorAll('[href], [style], image, foreignObject')).toHaveLength(0);
    expect([...svg.attributes].some((attribute) => attribute.value.includes('url('))).toBe(false);
    expect(avatar.accentColor).toBe('url(https://avatar.invalid/image.svg#paint)');
  });

  it('continues from compatible saved prior versions or explicit aliases, rejects a newer wrong revision, and never creates learning facts', () => {
    const target = reading.catalog.lessons[1];
    const current: CourseReading = {
      ...structuredClone(reading),
      catalog: {
        ...structuredClone(reading.catalog),
        lessons: reading.catalog.lessons.map((lesson, index) =>
          index === 1 ? { ...lesson, acceptedPriorVersions: ['1.0.0'] } : lesson,
        ),
      },
    };
    const snapshot = learning.state!.snapshot!;
    snapshot.progress.push(
      started(current.catalog.lessons[0].ref),
      started({ id: target.ref.id, version: '1.0.0' }, 1, later),
    );
    learning.state = { ...learning.state!, reading: current };
    let before = structuredClone(snapshot);
    let projection = components.savedCourseProjection(learning.state)!;
    expect(continueLesson(current, projection, snapshot.aliases)).toBe(target.ref.id);
    expect(snapshot).toEqual(before);

    snapshot.progress[1].learningRevision = 2;
    before = structuredClone(snapshot);
    projection = components.savedCourseProjection(learning.state)!;
    expect(continueLesson(current, projection, snapshot.aliases)).toBe(current.lessons[0].id);
    expect(snapshot).toEqual(before);

    const old = { id: 'lesson.c.historical', version: '1.0.0' };
    snapshot.progress[1] = started(old, 1, later);
    snapshot.aliases.push({
      kind: 'lesson',
      fromRef: old,
      toRef: { ...target.ref },
      fromAcceptedPriorVersions: [],
      learningRevision: 1,
      manifestRef: { id: 'aliases.c.p0', version: '1.0.0' },
    });
    before = structuredClone(snapshot);
    projection = components.savedCourseProjection(learning.state)!;
    expect(continueLesson(current, projection, snapshot.aliases)).toBe(target.ref.id);
    expect(snapshot).toEqual(before);
    expect(snapshot.receipts).toEqual([]);
    expect(snapshot.dailyFacts).toEqual([]);
    expect(snapshot.ledger).toEqual([]);
    expect(snapshot.goals).toEqual([]);
  });

  it('offers an independent profile configuration retry without claiming a level or modifying saved course rows', async () => {
    const before = structuredClone(learning.state!.snapshot!);
    learning.state = {
      ...learning.state!,
      profileStatus: 'failed',
      profileConfiguration: null,
      profileError: 'PROFILE_CONFIGURATION_INVALID',
    };
    await render();
    expect(level().textContent).toBe('等级规则暂不可用');
    expect(container.querySelector('progress')).toBeNull();
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '重试形象与等级规则',
    )!;
    await act(async () => retry.click());
    expect(learning.service.reloadProfileConfiguration).toHaveBeenCalledTimes(1);
    expect(learning.state!.readingStatus).toBe('ready');
    expect(learning.state!.snapshot).toEqual(before);
  });

  it('removes avatar controls from settings while preserving compatible saved archives', async () => {
    const original = structuredClone(learning.state!.snapshot!);
    await render(pages.SettingsPage, '/settings?panel=data');
    expect(container.querySelector('input[aria-label="强调色十六进制"]')).toBeNull();
    expect(container.querySelector('[data-testid="avatar-preview"]')).toBeNull();
    expect(
      [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
    ).not.toContain('基础形象');
    expect(learning.service.saveAvatar).not.toHaveBeenCalled();
    expect(learning.state!.snapshot).toEqual(original);
  });

  it('keeps temporary reward rights out of the actual home points dialog and offers no durable settlement retry for them', async () => {
    const temporary = archive();
    confirmedAwards(temporary);
    temporary.ledger = temporary.ledger.map((entry) => ({
      ...entry,
      status: 'pending',
      points: null,
      policyRef: null,
    }));
    learning.state = {
      ...learning.state!,
      status: 'unsaved',
      temporary: true,
      pendingCount: 1,
      projection: projectLearning(temporary, reading.catalog),
    };
    expect(learning.state.projection!.ledger.pending).toHaveLength(3);
    const before = structuredClone(learning.state.snapshot!);
    // jsdom has no native modal methods; only its open/close mechanics are stubbed here.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.setAttribute('open', '');
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.removeAttribute('open');
        },
      },
    });
    await render(pages.HomePage, '/?panel=points');
    const dialog = container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('暂无积分记录');
    expect(dialog.textContent).toContain('当前仅临时使用');
    expect(dialog.querySelector('.reward-ledger')).toBeNull();
    expect(
      [...dialog.querySelectorAll('button')].some(
        (button) => button.textContent === '重试奖励入账',
      ),
    ).toBe(false);
    expect(learning.state.snapshot).toEqual(before);
    expect(learning.service.settleRewards).not.toHaveBeenCalled();
  });
});
