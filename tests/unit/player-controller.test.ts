// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_STEP_MS, PLAYER_RATES, PlayerController } from '../../web/src/player/controller';
import {
  decodeResult,
  makeAdapterResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';

const base = resolve('项目文档/验收/07.3-真实轨迹');
let request: ExecuteRequest;
let completed: ExecuteResult;
let failed: ExecuteResult;

async function archive(key: string) {
  const req = JSON.parse(readFileSync(join(base, key, 'request.json'), 'utf8')) as ExecuteRequest;
  const bytes = readFileSync(join(base, key, 'result.json'));
  return { request: req, result: await decodeResult(Uint8Array.from(bytes).buffer, req) };
}

function loaded(result = completed, rate = 1) {
  const controller = new PlayerController(rate);
  expect(controller.acceptValidated(controller.begin(result.identity), result)).toBe(true);
  return controller;
}

function keyboard(controller: PlayerController) {
  const area = document.createElement('section');
  area.tabIndex = 0;
  const handled: boolean[] = [];
  area.addEventListener('keydown', (event) => handled.push(controller.handleKey(event)));
  document.body.append(area);
  return {
    area,
    press(target: Element, key: string, init: KeyboardEventInit = {}, prevented = false) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      if (prevented) event.preventDefault();
      target.dispatchEvent(event);
      return { event, handled: handled.at(-1) };
    },
  };
}

beforeAll(async () => {
  ({ request, result: completed } = await archive('assignment'));
  failed = (await archive('assignment-div-zero')).result;
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('08.2 single scheduler over validated real Rust traces', () => {
  it('key playback restores exact full states and changing detail cancels its pending tick', () => {
    const controller = loaded(),
      all = loaded();
    controller.setDetail('key');
    const cursors = [0];
    while (controller.getSnapshot().view.cursor! < completed.trace!.steps.length) {
      controller.step(1);
      const view = controller.getSnapshot().view;
      all.seek(view.cursor!);
      expect(view.state).toEqual(all.getSnapshot().view.state);
      cursors.push(view.cursor!);
    }
    expect(cursors.length).toBeLessThan(completed.trace!.steps.length + 1);
    for (const cursor of cursors.slice(0, -1).reverse()) {
      controller.step(-1);
      all.seek(cursor);
      expect(controller.getSnapshot().view).toEqual(all.getSnapshot().view);
    }
    controller.play();
    controller.setDetail('all');
    const paused = controller.getSnapshot();
    vi.advanceTimersByTime(BASE_STEP_MS * 2);
    expect(controller.getSnapshot()).toBe(paused);
    controller.step(1);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    controller.setAdvanceGuard(() => false);
    controller.setDetail('key');
    expect(controller.getSnapshot().detail).toBe('all');
    controller.play();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('caches snapshots and publishes once per mutation, with detachable subscriptions', () => {
    const controller = new PlayerController();
    const { getSnapshot, subscribe } = controller;
    const initial = getSnapshot();
    expect(getSnapshot()).toBe(initial);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const token = controller.begin(completed.identity);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe(getSnapshot());
    expect(getSnapshot()).not.toBe(initial);
    expect(getSnapshot().view.status).toBe('loading');
    expect(controller.acceptValidated(Symbol(), completed)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.acceptValidated(token, completed)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    controller.play();
    expect(listener).toHaveBeenCalledTimes(3);
    controller.play();
    controller.setRate(1);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    unsubscribe();
    vi.advanceTimersByTime(BASE_STEP_MS);
    expect(getSnapshot().view.cursor).toBe(1);
    expect(listener).toHaveBeenCalledTimes(3);
    // Detaching a view does not invalidate or permanently dispose the reusable instance.
    const reattach = subscribe(listener);
    controller.pause();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(getSnapshot().view.cursor).toBe(1);
    reattach();
  });

  it('never stacks timers on rapid play and stays unchanged after pausing', () => {
    const controller = loaded();
    for (let i = 0; i < 20; i++) controller.play();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(BASE_STEP_MS);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    controller.pause();
    const paused = controller.getSnapshot();
    expect(paused.view.status).toBe('paused');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(controller.getSnapshot()).toBe(paused);
    controller.pause();
    expect(controller.getSnapshot()).toBe(paused);
  });

  it.each(PLAYER_RATES)(
    'uses the frozen %s× interval while preserving the current state',
    (rate) => {
      const controller = loaded();
      controller.step(1);
      const state = controller.getSnapshot().view.state;
      controller.setRate(rate);
      expect(controller.getSnapshot()).toMatchObject({ rate, view: { cursor: 1, state } });
      controller.play();
      vi.advanceTimersByTime(Math.floor(BASE_STEP_MS / rate) - 1);
      expect(controller.getSnapshot().view.cursor).toBe(1);
      vi.advanceTimersByTime(1);
      expect(controller.getSnapshot().view.cursor).toBe(2);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it('replaces a playing speed timer without letting an already queued callback clear it', () => {
    const controller = loaded();
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    controller.play();
    const oldCallback = timeouts.mock.calls[0][0] as () => void;
    vi.advanceTimersByTime(200);
    controller.setRate(4);
    const changed = controller.getSnapshot();
    expect(changed).toMatchObject({ rate: 4, view: { status: 'playing', cursor: 0 } });
    oldCallback();
    expect(controller.getSnapshot()).toBe(changed);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(124);
    expect(controller.getSnapshot().view.cursor).toBe(0);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(['pause', 'step', 'replay', 'begin', 'invalidate'] as const)(
    'rejects callbacks queued before %s and preserves any replacement timer',
    (action) => {
      const controller = loaded();
      const timeouts = vi.spyOn(globalThis, 'setTimeout');
      controller.play();
      const oldCallback = timeouts.mock.calls[0][0] as () => void;
      if (action === 'step') controller.step(1);
      else if (action === 'begin') controller.begin(completed.identity);
      else controller[action]();
      const current = controller.getSnapshot();
      const count = vi.getTimerCount();
      oldCallback();
      expect(controller.getSnapshot()).toBe(current);
      expect(vi.getTimerCount()).toBe(count);
      expect(count).toBe(action === 'replay' ? 1 : 0);
    },
  );

  it('takes only one step after a delayed callback and schedules from that callback', () => {
    const controller = loaded();
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    controller.play();
    const delayedCallback = timeouts.mock.calls[0][0] as () => void;
    vi.clearAllTimers();
    vi.setSystemTime(Date.now() + 30_000);
    delayedCallback();
    expect(controller.getSnapshot().view.cursor).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(BASE_STEP_MS - 1);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().view.cursor).toBe(2);
  });

  it('single-steps atomically, stops at both boundaries and replays from the initial state', () => {
    const controller = loaded();
    const initial = controller.getSnapshot();
    controller.step(-1);
    expect(controller.getSnapshot()).toBe(initial);
    controller.play();
    vi.advanceTimersByTime(BASE_STEP_MS * 4);
    expect(controller.getSnapshot().view.state!.objects[0].cells[0].value).toBe(-5);
    controller.step(-1);
    expect(controller.getSnapshot().view).toMatchObject({ status: 'paused', cursor: 3 });
    expect(controller.getSnapshot().view.state!.objects[0].cells[0].value).toBe(-7);
    expect(vi.getTimerCount()).toBe(0);
    controller.play();
    vi.runAllTimers();
    expect(controller.getSnapshot().view).toMatchObject({
      status: 'ended',
      cursor: completed.trace!.steps.length,
      state: { output: '-5\n', objects: [], frames: [], scopes: [] },
    });
    expect(vi.getTimerCount()).toBe(0);
    const end = controller.getSnapshot();
    controller.step(1);
    controller.play();
    expect(controller.getSnapshot()).toBe(end);
    controller.setRate(2);
    controller.replay();
    expect(controller.getSnapshot()).toMatchObject({
      rate: 2,
      view: { status: 'playing', cursor: 0, state: completed.trace!.initialState },
    });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(BASE_STEP_MS / 2);
    expect(controller.getSnapshot().view.cursor).toBe(1);
  });

  it('keeps real failure prefixes reviewable and makes no-trace adapter failures inert', () => {
    const controller = loaded(failed);
    controller.play();
    vi.runAllTimers();
    expect(controller.getSnapshot().view).toMatchObject({
      status: 'failed',
      cursor: failed.trace!.steps.length,
      outcome: { status: 'program-error' },
      terminal: { diagnostics: [{ code: 'E_DIV_ZERO' }] },
    });
    controller.step(-1);
    expect(controller.getSnapshot().view).toMatchObject({
      status: 'paused',
      outcome: { status: 'program-error' },
      terminal: null,
    });
    controller.replay();
    expect(controller.getSnapshot().view).toMatchObject({
      status: 'playing',
      cursor: 0,
      outcome: { status: 'program-error' },
    });
    const adapter = makeAdapterResult(request, 'cancelled', 'E_CANCELLED');
    expect(controller.acceptValidated(controller.begin(adapter.identity), adapter)).toBe(true);
    const current = controller.getSnapshot();
    controller.play();
    controller.step(1);
    controller.step(-1);
    controller.replay();
    expect(controller.getSnapshot()).toBe(current);
    expect(current.view).toMatchObject({ status: 'failed', cursor: null, state: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears old runs and remains reusable after repeated lifecycle cleanup', () => {
    const controller = loaded();
    controller.play();
    const oldToken = controller.begin(completed.identity);
    controller.invalidate();
    controller.invalidate();
    expect(controller.acceptValidated(oldToken, completed)).toBe(false);
    expect(controller.getSnapshot().view).toMatchObject({
      status: 'idle',
      identity: null,
      cursor: null,
      state: null,
      outcome: null,
    });
    expect(vi.getTimerCount()).toBe(0);
    const token = controller.begin(completed.identity);
    expect(controller.acceptValidated(token, completed)).toBe(true);
    controller.play();
    vi.advanceTimersByTime(BASE_STEP_MS);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('honors a synchronous pause or speed change from a subscriber without duplicating timers', () => {
    const controller = loaded();
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().view.cursor === 1) controller.pause();
    });
    controller.play();
    vi.advanceTimersByTime(BASE_STEP_MS);
    expect(controller.getSnapshot().view).toMatchObject({ status: 'paused', cursor: 1 });
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
    controller.subscribe(() => {
      if (controller.getSnapshot().view.cursor === 2) controller.setRate(4);
    });
    controller.play();
    vi.advanceTimersByTime(BASE_STEP_MS);
    expect(controller.getSnapshot()).toMatchObject({ rate: 4, view: { cursor: 2 } });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(BASE_STEP_MS / 4);
    expect(controller.getSnapshot().view.cursor).toBe(3);
  });

  it('does not schedule another old-run timer when a tick subscriber begins a new load', () => {
    const controller = loaded();
    controller.subscribe(() => {
      if (controller.getSnapshot().view.cursor === 1) controller.begin(completed.identity);
    });
    controller.play();
    vi.advanceTimersByTime(BASE_STEP_MS);
    expect(controller.getSnapshot().view).toMatchObject({ status: 'loading', cursor: null });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(BASE_STEP_MS * 20);
    expect(controller.getSnapshot().view.cursor).toBeNull();
  });

  it('rejects unsupported speed changes atomically', () => {
    expect(() => new PlayerController(3)).toThrow(RangeError);
    const controller = loaded();
    controller.play();
    const current = controller.getSnapshot();
    for (const rate of [0, -1, 3, NaN, Infinity]) {
      expect(() => controller.setRate(rate)).toThrow(RangeError);
      expect(controller.getSnapshot()).toBe(current);
      expect(vi.getTimerCount()).toBe(1);
    }
  });
});

describe('08.2 keyboard scope and focus protection', () => {
  it('consumes Space and arrows only when the corresponding action is available', () => {
    const controller = loaded();
    const h = keyboard(controller);
    h.area.focus();
    expect(h.press(h.area, 'ArrowLeft').handled).toBe(false);
    expect(h.press(h.area, 'ArrowLeft').event.defaultPrevented).toBe(false);
    expect(h.press(h.area, 'ArrowRight').handled).toBe(true);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    expect(h.press(h.area, 'ArrowLeft').event.defaultPrevented).toBe(true);
    expect(controller.getSnapshot().view.cursor).toBe(0);
    expect(h.press(h.area, ' ').handled).toBe(true);
    expect(controller.getSnapshot().view.status).toBe('playing');
    expect(h.press(h.area, ' ').handled).toBe(true);
    expect(controller.getSnapshot().view.status).toBe('paused');
    controller.play();
    expect(h.press(h.area, 'ArrowRight').handled).toBe(true);
    expect(controller.getSnapshot().view).toMatchObject({ status: 'paused', cursor: 1 });
    const paused = controller.getSnapshot();
    vi.advanceTimersByTime(BASE_STEP_MS * 3);
    expect(controller.getSnapshot()).toBe(paused);
    controller.play();
    vi.runAllTimers();
    expect(h.press(h.area, 'ArrowRight').handled).toBe(false);
    expect(h.press(h.area, ' ').event.defaultPrevented).toBe(false);
    expect(h.press(h.area, 'ArrowLeft').handled).toBe(true);
    expect(h.press(h.area, ' ', { code: 'Space' }).handled).toBe(true);
  });

  it.each([
    { repeat: true },
    { isComposing: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
  ])('ignores repeated, composing or modified keys: %s', (init) => {
    const controller = loaded();
    const h = keyboard(controller);
    const current = controller.getSnapshot();
    for (const key of [' ', 'ArrowLeft', 'ArrowRight']) {
      const result = h.press(h.area, key, init);
      expect(result.handled).toBe(false);
      expect(result.event.defaultPrevented).toBe(false);
      expect(controller.getSnapshot()).toBe(current);
    }
  });

  it('respects handled keys and ignores unrelated keys and unavailable runs', () => {
    const controller = loaded();
    const h = keyboard(controller);
    const current = controller.getSnapshot();
    expect(h.press(h.area, 'ArrowRight', {}, true).handled).toBe(false);
    expect(h.press(h.area, 'Enter').handled).toBe(false);
    expect(controller.getSnapshot()).toBe(current);
    controller.invalidate();
    for (const key of [' ', 'ArrowLeft', 'ArrowRight'])
      expect(h.press(h.area, key).event.defaultPrevented).toBe(false);
  });

  it.each([
    ['input', '<input value="draft">'],
    ['textarea', '<textarea>draft</textarea>'],
    ['read-only source', '<textarea readonly>int main() { return 0; }</textarea>'],
    ['select', '<select><option>1×</option></select>'],
    ['button', '<button><span tabindex="0">Play</span></button>'],
    ['link', '<a href="#"><span tabindex="0">Case</span></a>'],
    ['editable ancestor', '<div contenteditable="true"><span tabindex="0">draft</span></div>'],
    ['empty editable', '<div contenteditable=""><span tabindex="0">draft</span></div>'],
    ['plaintext editable', '<div contenteditable="plaintext-only">draft</div>'],
    ['textbox role', '<div role="textbox"><span tabindex="0">draft</span></div>'],
    ['slider role', '<div role="slider" tabindex="0"></div>'],
    ['combobox role', '<div role="combobox" tabindex="0"></div>'],
    ['CodeMirror', '<div class="cm-editor"><div tabindex="0">source</div></div>'],
  ])('keeps keyboard input native inside %s', (_label, markup) => {
    const controller = loaded();
    const h = keyboard(controller);
    h.area.innerHTML = markup;
    const target = h.area.querySelector('span, .cm-editor > div') ?? h.area.firstElementChild!;
    (target as HTMLElement).focus();
    const current = controller.getSnapshot();
    for (const key of [' ', 'ArrowLeft', 'ArrowRight']) {
      const result = h.press(target, key);
      expect(result.handled).toBe(false);
      expect(result.event.defaultPrevented).toBe(false);
      expect(controller.getSnapshot()).toBe(current);
    }
    vi.advanceTimersByTime(BASE_STEP_MS * 3);
    expect(controller.getSnapshot()).toBe(current);
  });

  it('checks the composed path through shadow roots and registers no document-wide keys', () => {
    const controller = loaded();
    const h = keyboard(controller);
    const host = document.createElement('div');
    h.area.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('textarea');
    shadow.append(input);
    input.focus();
    const current = controller.getSnapshot();
    expect(h.press(input, 'ArrowRight').handled).toBe(false);
    expect(controller.getSnapshot()).toBe(current);
    const outside = document.createElement('div');
    document.body.append(outside);
    h.press(outside, ' ');
    expect(controller.getSnapshot()).toBe(current);
  });
});
