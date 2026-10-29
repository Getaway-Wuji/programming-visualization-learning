// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningServiceState } from '../../web/src/learning/service';
import { createMeta, emptySnapshot, type Appearance } from '../../web/src/storage/model';
import {
  BlockWorkspacePreference,
  useBlockWorkspacePreference,
} from '../../web/src/appearance/BlockWorkspacePreference';

const learning = vi.hoisted(() => ({
  state: null as LearningServiceState | null,
  service: {
    getState: vi.fn(),
    saveAppearance: vi.fn(),
    refresh: vi.fn(),
  },
}));
vi.mock('../../web/src/learning/react', () => ({
  useLearning: () => ({ state: learning.state, service: learning.service }),
}));

let root: Root;
let container: HTMLDivElement;
let control: ReturnType<typeof useBlockWorkspacePreference>;
function Control() {
  const current = useBlockWorkspacePreference();
  useEffect(() => {
    control = current;
  }, [current]);
  return createElement(BlockWorkspacePreference, { control: current, recommendation: 'code' });
}
function state() {
  return learning.state!;
}
async function render() {
  await act(async () => root.render(createElement(Control)));
}
async function choose(value: string) {
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function saved(value: Appearance, revision: number) {
  const current = state();
  current.snapshot!.appearance = structuredClone(value);
  current.snapshot!.meta.revision = revision + 1;
  current.status = 'ready';
  current.lastSaved = true;
  current.errorCode = null;
  current.appearanceError = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const snapshot = emptySnapshot(
    createMeta({
      generation: '55300000-0000-4000-8000-000000000010',
      createdAt: '2026-10-26T03:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      activePackageRef: { id: 'course.c.p0', version: '1.0.0' },
    }),
  );
  learning.state = {
    status: 'ready',
    snapshot,
    sessionEpoch: 0,
    recovery: null,
    appearanceReadOnly: false,
    errorCode: null,
    lastSaved: false,
  } as LearningServiceState;
  learning.service.getState.mockImplementation(() => state());
  learning.service.refresh.mockResolvedValue(undefined);
  learning.service.saveAppearance.mockImplementation(async (value: Appearance, revision: number) =>
    saved(value, revision),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('block display preferences preserve independent saved fields and guarded temporary choices', () => {
  it('selects and confirms only after the saved row contains the requested display value', async () => {
    const before = structuredClone(state().snapshot!.appearance);
    before.preset = 'cute';
    before.layout.sidebar = 'collapsed';
    before.themeOverrides.cool.accentColor = '#223344';
    state().snapshot!.appearance = before;
    const revision = state().snapshot!.meta.revision;
    await render();
    await choose('hide');
    expect(learning.service.saveAppearance).toHaveBeenCalledWith(
      { ...before, blockWorkspace: 'hide' },
      revision,
    );
    expect(control.value).toBe('hide');
    expect(control.dirty).toBe(false);
    expect(container.querySelector('[data-save-state="saved"]')?.textContent).toContain('已保存');
  });

  it('keeps a failed choice through an external update and refreshes before explicit retry', async () => {
    learning.service.saveAppearance.mockImplementationOnce(async () => {
      state().status = 'conflict';
      state().appearanceError = 'S_REVISION_CONFLICT';
      state().lastSaved = false;
    });
    await render();
    await choose('hide');
    expect(control.failed).toBe(true);
    const peer = structuredClone(state().snapshot!.appearance);
    peer.preset = 'tech';
    peer.layout.splitRatios.practice = 65;
    state().snapshot!.appearance = peer;
    state().snapshot!.meta.revision = 12;
    state().status = 'ready';
    await render();
    expect(control.value).toBe('hide');
    await choose('show');
    expect(learning.service.saveAppearance).toHaveBeenCalledTimes(1);
    expect(control.value).toBe('show');
    learning.service.refresh.mockImplementationOnce(async () => {
      state().snapshot!.meta.revision = 15;
    });
    await act(async () => control.retry());
    expect(learning.service.refresh).toHaveBeenCalledTimes(1);
    expect(learning.service.saveAppearance).toHaveBeenLastCalledWith(
      { ...peer, blockWorkspace: 'show' },
      15,
    );
    expect(control.failed).toBe(false);
    expect(control.dirty).toBe(false);
  });

  it('discards the temporary display choice when archive generation or session epoch changes', async () => {
    learning.service.saveAppearance.mockImplementationOnce(async () => {
      state().status = 'unsaved';
      state().appearanceError = 'S_QUOTA';
      state().lastSaved = false;
    });
    await render();
    await choose('hide');
    expect(control.value).toBe('hide');
    state().snapshot!.meta.generation = '55300000-0000-4000-8000-000000000011';
    state().sessionEpoch += 1;
    state().status = 'ready';
    state().snapshot!.appearance.blockWorkspace = 'show';
    await render();
    expect(control.value).toBe('show');
    expect(control.failed).toBe(false);
    expect(control.dirty).toBe(false);
    await act(async () => control.retry());
    expect(learning.service.saveAppearance).toHaveBeenCalledTimes(1);
  });

  it('does not confirm a completed write whose saved value differs from the requested choice', async () => {
    learning.service.saveAppearance.mockImplementationOnce(async () => {
      state().status = 'ready';
      state().lastSaved = true;
    });
    await render();
    await choose('hide');
    expect(control.value).toBe('hide');
    expect(control.failed).toBe(true);
    expect(container.querySelector('[data-save-state="temporary"]')).not.toBeNull();
    await act(async () => control.discard());
    expect(control.value).toBe('auto');
    expect(control.dirty).toBe(false);
  });

  it('does not write from a read-only archive and withdraws an earlier saved confirmation after reset', async () => {
    await render();
    await choose('show');
    expect(control.confirmed).toBe(true);
    state().sessionEpoch += 1;
    state().snapshot!.meta.generation = '55300000-0000-4000-8000-000000000012';
    state().snapshot!.appearance.blockWorkspace = 'auto';
    state().appearanceReadOnly = true;
    await render();
    expect(control.confirmed).toBe(false);
    expect(container.querySelector('select')!.disabled).toBe(true);
    await act(async () => control.choose('hide'));
    expect(learning.service.saveAppearance).toHaveBeenCalledTimes(1);
  });
});
