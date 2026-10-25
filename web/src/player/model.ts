import type {
  ExecuteResult,
  ExecutionIdentity,
  ExecutionLocation,
  TraceObservation,
  TraceState,
  TraceStep,
} from '../engine/protocol';
import { projectTraceStep } from '../engine/trace-validation';

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'failed';
export interface PlayerSnapshot {
  status: PlayerStatus;
  identity: ExecutionIdentity | null;
  cursor: number | null;
  length: number;
  state: TraceState | null;
  stepKind: TraceStep['kind'] | null;
  location: ExecutionLocation | null;
  observations: TraceObservation[];
  /** Run outcome remains available even while reviewing an earlier prefix step. */
  outcome: ExecuteResult['terminal'] | null;
  /** Only the tail displays the independent terminal location/diagnostics. */
  terminal: ExecuteResult['terminal'] | null;
}

/** In-memory model only: no C execution, persistence, rewards, timers or UI policy.
 * acceptValidated borrows the immutable result accepted by ExecutionClient. Never
 * feed external JSON/fixtures directly: decodeResult and the controlled Worker
 * lifecycle must have succeeded first. A result is retained once, not per step.
 */
export class PlayerModel {
  private status: PlayerStatus = 'idle';
  private identity: ExecutionIdentity | null = null;
  private result: ExecuteResult | null = null;
  private state: TraceState | null = null;
  private cursor: number | null = null;
  private loadToken = Symbol();
  private playbackToken = Symbol();

  begin(identity: ExecutionIdentity): symbol {
    this.invalidate();
    this.identity = { ...identity };
    this.status = 'loading';
    return this.loadToken;
  }

  acceptValidated(token: symbol, result: ExecuteResult): boolean {
    if (token !== this.loadToken || this.status !== 'loading' || !this.identity) return false;
    if (
      (Object.keys(this.identity) as (keyof ExecutionIdentity)[]).some(
        (key) => this.identity![key] !== result.identity[key],
      )
    )
      return false;
    this.result = result;
    this.cursor = result.trace ? 0 : null;
    this.state = result.trace?.initialState ?? null;
    this.status = result.trace?.steps.length ? 'ready' : this.tailStatus();
    return true;
  }

  /** Call synchronously on source/input/content changes, clear and real unmount. */
  invalidate(): void {
    this.loadToken = Symbol();
    this.playbackToken = Symbol();
    this.identity = null;
    this.result = null;
    this.state = null;
    this.cursor = null;
    this.status = 'idle';
  }

  private tailStatus(): 'ended' | 'failed' {
    return this.result?.terminal.status === 'completed' ? 'ended' : 'failed';
  }

  /** Scheduler belongs to 08.2. Repeated play reuses the active lease. */
  play(): symbol | null {
    if (
      this.cursor === null ||
      !this.result?.trace ||
      this.cursor >= this.result.trace.steps.length
    )
      return null;
    if (this.status !== 'playing') {
      this.playbackToken = Symbol();
      this.status = 'playing';
    }
    return this.playbackToken;
  }

  pause(): void {
    this.playbackToken = Symbol();
    if (this.status === 'playing') this.status = 'paused';
  }

  /** Stale queued callbacks cannot move a paused, sought or replaced run. */
  tick(token: symbol): boolean {
    if (token !== this.playbackToken || this.status !== 'playing' || this.cursor === null)
      return false;
    this.move(this.cursor + 1);
    if (this.cursor === this.result!.trace!.steps.length) {
      this.status = this.tailStatus();
      this.playbackToken = Symbol();
    }
    return true;
  }

  /** Out-of-range requests are rejected atomically; seeking always stops playback. */
  seek(cursor: number): boolean {
    const trace = this.result?.trace;
    if (!trace || !Number.isInteger(cursor) || cursor < 0 || cursor > trace.steps.length)
      return false;
    this.move(cursor);
    this.playbackToken = Symbol();
    this.status =
      cursor === trace.steps.length ? this.tailStatus() : cursor === 0 ? 'ready' : 'paused';
    return true;
  }

  private move(cursor: number): void {
    const trace = this.result!.trace!;
    let next: TraceState;
    if (cursor === this.cursor) return;
    if (cursor === this.cursor! - 1) {
      next = projectTraceStep(this.state!, trace.steps[cursor], true);
    } else if (cursor === this.cursor! + 1) {
      next = projectTraceStep(this.state!, trace.steps[this.cursor!]);
    } else {
      const checkpoint = trace.checkpoints[Math.floor(cursor / 128)];
      next = checkpoint.state;
      for (let at = checkpoint.cursor; at < cursor; at++)
        next = projectTraceStep(next, trace.steps[at]);
    }
    this.state = next;
    this.cursor = cursor;
  }

  /** Defensive view copy; consumers cannot modify the retained trace or future state. */
  snapshot(): PlayerSnapshot {
    const trace = this.result?.trace;
    const step = trace && this.cursor ? trace.steps[this.cursor - 1] : null;
    const initialLocation: ExecutionLocation | null = trace
      ? {
          kind: 'synthetic',
          reason: 'initial-state',
          anchorNodeId: trace.initialState.control.nextNodeId!,
        }
      : null;
    return structuredClone({
      status: this.status,
      identity: this.identity,
      cursor: this.cursor,
      length: trace?.steps.length ?? 0,
      state: this.state,
      stepKind: step?.kind ?? null,
      location: step?.location ?? initialLocation,
      observations: step?.observations ?? [],
      outcome: this.result?.terminal ?? null,
      terminal:
        this.result && (!trace || this.cursor === trace.steps.length) ? this.result.terminal : null,
    });
  }
}
