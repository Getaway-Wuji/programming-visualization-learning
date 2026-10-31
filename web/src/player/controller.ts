import type { ExecuteResult, ExecutionIdentity } from '../engine/protocol';
import { PlayerModel, type PlayerSnapshot } from './model';
import { beginPlayerFrame } from './performance';
import { keyStepCursors, nextStepCursor, keyStepPosition, type StepDetail } from './key-steps';

export const PLAYER_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export const BASE_STEP_MS = 500;

export interface PlayerControllerSnapshot {
  view: PlayerSnapshot;
  rate: number;
  detail: StepDetail;
  detailLocked: boolean;
  keyPosition: number;
  keyLength: number;
}

const focusGuard =
  'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false" i]), ' +
  '[role="textbox"], [role="slider"], [role="combobox"], .cm-editor';

/** One in-memory model and one cancellable timer chain for a player workspace. */
export class PlayerController {
  private readonly model = new PlayerModel();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerGeneration = 0;
  private rate: number;
  private current: PlayerControllerSnapshot;
  private advanceGuard: ((view: PlayerSnapshot) => boolean) | undefined;
  private detail: StepDetail;
  private stops: readonly number[] = [0];

  constructor(initialRate = 1, detail: StepDetail = 'all') {
    this.validateRate(initialRate);
    this.rate = initialRate;
    this.detail = detail;
    this.current = this.snapshot();
  }

  /** Stable references are suitable for React's useSyncExternalStore. */
  readonly getSnapshot = (): PlayerControllerSnapshot => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  begin(identity: ExecutionIdentity): symbol {
    this.cancelTimer();
    const token = this.model.begin(identity);
    this.stops = [0];
    this.publish();
    return token;
  }

  acceptValidated(token: symbol, result: ExecuteResult): boolean {
    if (!this.model.acceptValidated(token, result)) return false;
    this.stops = keyStepCursors(result);
    this.publish();
    return true;
  }

  /** Source/input changes and real unmounts invalidate both pending ticks and loads. */
  invalidate(): void {
    this.cancelTimer();
    this.model.invalidate();
    this.stops = [0];
    this.publish();
  }

  play(): void {
    if (this.advanceGuard && !this.advanceGuard(this.current.view)) return;
    if (this.current.view.status === 'playing') return;
    const token = this.model.play();
    if (token === null) return;
    this.cancelTimer();
    this.schedule(token, this.timerGeneration);
    this.publish();
  }

  pause(): void {
    this.cancelTimer();
    this.model.pause();
    if (this.current.view.status === 'playing') this.publish();
  }

  toggle(): void {
    if (this.current.view.status === 'playing') this.pause();
    else this.play();
  }

  step(delta: -1 | 1): void {
    if (delta === 1 && this.advanceGuard && !this.advanceGuard(this.current.view)) return;
    const { cursor, length } = this.current.view;
    if (cursor === null || (delta !== -1 && delta !== 1)) return;
    const target =
      this.detail === 'key' ? nextStepCursor(this.stops, cursor, delta) : cursor + delta;
    if (target < 0 || target > length) return;
    this.cancelTimer();
    if (this.model.seek(target)) this.publish();
  }

  /** Replay restores the initial state and starts a fresh single timer chain. */
  replay(): void {
    if (this.current.view.cursor === null) return;
    this.cancelTimer();
    if (!this.model.seek(0)) return;
    if (this.advanceGuard && !this.advanceGuard(this.model.snapshot())) {
      this.publish();
      return;
    }
    const token = this.model.play();
    if (token !== null) this.schedule(token, this.timerGeneration);
    this.publish();
  }

  setRate(rate: number): void {
    this.validateRate(rate);
    if (rate === this.rate) return;
    this.rate = rate;
    if (this.current.view.status === 'playing') {
      this.cancelTimer();
      const token = this.model.play();
      if (token !== null) this.schedule(token, this.timerGeneration);
    }
    this.publish();
  }
  /** Challenge checkpoints pause the same player; state and reverse deltas stay in its model. */
  setAdvanceGuard(guard?: (view: PlayerSnapshot) => boolean): void {
    this.advanceGuard = guard;
    if (guard) this.setDetail('all');
    if (guard && !guard(this.current.view)) this.pause();
    this.publish();
  }
  setDetail(detail: StepDetail): void {
    if (
      (detail !== 'key' && detail !== 'all') ||
      (this.advanceGuard && detail === 'key') ||
      detail === this.detail
    )
      return;
    this.pause();
    this.detail = detail;
    this.publish();
  }
  seek(cursor: number): void {
    this.cancelTimer();
    if (this.model.seek(cursor)) this.publish();
  }

  /** Bind only inside the focusable player workspace; native controls keep their keys. */
  handleKey(event: KeyboardEvent): boolean {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return false;
    const path = event.composedPath();
    if (event.target) path.push(event.target);
    if (path.some((target) => target instanceof Element && target.closest(focusGuard)))
      return false;

    const { cursor, length, status } = this.current.view;
    if (event.key === ' ' || event.code === 'Space') {
      if (status !== 'playing' && (cursor === null || cursor >= length)) return false;
      event.preventDefault();
      this.toggle();
      return true;
    }
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
    if (delta === null || cursor === null || cursor + delta < 0 || cursor + delta > length)
      return false;
    event.preventDefault();
    this.step(delta);
    return true;
  }

  private validateRate(rate: number): void {
    if (!PLAYER_RATES.some((allowed) => allowed === rate))
      throw new RangeError('Unsupported player rate');
  }

  private cancelTimer(): void {
    this.timerGeneration++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(token: symbol, generation: number): void {
    this.timer = setTimeout(() => {
      // A callback already queued before cancellation must not clear its replacement timer.
      if (generation !== this.timerGeneration) return;
      this.timer = null;
      const frameStart = performance.now();
      const target =
        this.detail === 'key'
          ? nextStepCursor(this.stops, this.current.view.cursor!, 1)
          : undefined;
      if (!this.model.tick(token, target)) return;
      this.publish(frameStart);
      if (this.advanceGuard && !this.advanceGuard(this.current.view)) {
        this.pause();
        return;
      }
      // A subscriber can synchronously pause, change rate or replace the run.
      if (generation === this.timerGeneration && this.current.view.status === 'playing')
        this.schedule(token, generation);
    }, BASE_STEP_MS / this.rate);
  }

  private publish(frameStart?: number): void {
    this.current = this.snapshot();
    if (frameStart !== undefined) beginPlayerFrame(this.current.view, frameStart);
    for (const listener of this.listeners) listener();
  }
  private snapshot(): PlayerControllerSnapshot {
    const view = this.model.snapshot();
    return {
      view,
      rate: this.rate,
      detail: this.detail,
      detailLocked: !!this.advanceGuard,
      keyPosition: keyStepPosition(this.stops, view.cursor ?? 0),
      keyLength: this.stops.length - 1,
    };
  }
}
