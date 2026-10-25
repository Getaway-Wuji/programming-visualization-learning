import type { ExecuteResult, ExecutionIdentity } from '../engine/protocol';
import { PlayerModel, type PlayerSnapshot } from './model';
import { beginPlayerFrame } from './performance';

export const PLAYER_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export const BASE_STEP_MS = 500;

export interface PlayerControllerSnapshot {
  view: PlayerSnapshot;
  rate: number;
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

  constructor(initialRate = 1) {
    this.validateRate(initialRate);
    this.rate = initialRate;
    this.current = { view: this.model.snapshot(), rate: this.rate };
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
    this.publish();
    return token;
  }

  acceptValidated(token: symbol, result: ExecuteResult): boolean {
    if (!this.model.acceptValidated(token, result)) return false;
    this.publish();
    return true;
  }

  /** Source/input changes and real unmounts invalidate both pending ticks and loads. */
  invalidate(): void {
    this.cancelTimer();
    this.model.invalidate();
    this.publish();
  }

  play(): void {
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
    const { cursor, length } = this.current.view;
    if (cursor === null || (delta !== -1 && delta !== 1)) return;
    const target = cursor + delta;
    if (target < 0 || target > length) return;
    this.cancelTimer();
    if (this.model.seek(target)) this.publish();
  }

  /** Replay restores the initial state and starts a fresh single timer chain. */
  replay(): void {
    if (this.current.view.cursor === null) return;
    this.cancelTimer();
    if (!this.model.seek(0)) return;
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
      if (!this.model.tick(token)) return;
      this.publish(frameStart);
      // A subscriber can synchronously pause, change rate or replace the run.
      if (generation === this.timerGeneration && this.current.view.status === 'playing')
        this.schedule(token, generation);
    }, BASE_STEP_MS / this.rate);
  }

  private publish(frameStart?: number): void {
    this.current = { view: this.model.snapshot(), rate: this.rate };
    if (frameStart !== undefined) beginPlayerFrame(this.current.view, frameStart);
    for (const listener of this.listeners) listener();
  }
}
