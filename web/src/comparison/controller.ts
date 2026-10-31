import type { CaseExecutionCatalog } from '../content/case-learning';
import {
  ExecutionClient,
  caseRequest,
  type CaseInput,
  type PreparedSource,
} from '../engine/execution-client';
import type { ExecuteResult } from '../engine/protocol';
import { PlayerModel, type PlayerSnapshot } from '../player/model';

type Phase = 'idle' | 'preparing' | 'ready' | 'running' | 'settled' | 'failed' | 'cancelled';
type LanePhase = 'idle' | 'preparing' | 'ready' | 'running' | 'accepted' | 'cancelled' | 'failed';
export interface ComparisonLane {
  catalog: CaseExecutionCatalog | null;
  phase: LanePhase;
  source?: PreparedSource;
  result?: ExecuteResult;
  input?: CaseInput;
  error: string;
  view: PlayerSnapshot;
}
export interface ComparisonSnapshot {
  phase: Phase;
  lanes: readonly ComparisonLane[];
  cursor: number;
  length: number;
  playing: boolean;
  rate: number;
  error: string;
}
interface Client {
  prepare: ExecutionClient['prepare'];
  execute: ExecutionClient['execute'];
  invalidate: () => void;
}
interface Dependencies {
  clients?: readonly [Client, Client];
  now?: () => number;
  present?: (action: () => void) => void;
}
function frozenCopy<T>(value: T): T {
  function freeze(item: unknown) {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  const copy = structuredClone(value);
  freeze(copy);
  return copy;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'COMPARISON_FAILED';
}

/** Coordinates real runs and STEP projections; contains no sorting or metric calculation. */
export class ComparisonController {
  private readonly clients: readonly [Client, Client];
  private readonly models = [new PlayerModel(), new PlayerModel()];
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly present: (action: () => void) => void;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private timerGeneration = 0;
  private phase: Phase = 'idle';
  private lanes: ComparisonLane[];
  private cursor = 0;
  private playing = false;
  private rate = 1;
  private error = '';
  private snapshot: ComparisonSnapshot;
  constructor(dependencies: Dependencies = {}) {
    this.clients = dependencies.clients ?? [new ExecutionClient(), new ExecutionClient()];
    this.now = dependencies.now ?? (() => performance.now());
    this.present = dependencies.present ?? ((action) => action());
    this.lanes = this.models.map((model) => ({
      catalog: null,
      phase: 'idle',
      error: '',
      view: model.snapshot(),
    }));
    this.snapshot = this.read();
  }
  private read(): ComparisonSnapshot {
    return {
      phase: this.phase,
      cursor: this.cursor,
      length: Math.max(...this.models.map((model) => model.snapshot().length)),
      playing: this.playing,
      rate: this.rate,
      error: this.error,
      lanes: this.lanes.map((lane, index) => ({ ...lane, view: this.models[index]!.snapshot() })),
    };
  }
  private publish() {
    this.snapshot = this.read();
    this.listeners.forEach((listener) => listener());
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  configure(catalogs: readonly [CaseExecutionCatalog, CaseExecutionCatalog]) {
    this.invalidate();
    this.lanes.forEach((lane, index) => {
      lane.catalog = frozenCopy(catalogs[index]!);
    });
    this.publish();
  }
  invalidate = () => {
    ++this.generation;
    this.stopTimer();
    this.clients.forEach((client) => client.invalidate());
    this.models.forEach((model) => model.invalidate());
    this.lanes = this.lanes.map(({ catalog }, index) => ({
      catalog,
      phase: 'idle',
      error: '',
      view: this.models[index]!.snapshot(),
    }));
    this.phase = 'idle';
    this.cursor = 0;
    this.error = '';
    this.publish();
  };
  async prepare(input: CaseInput) {
    const start = this.now();
    this.invalidate();
    const generation = this.generation;
    if (this.lanes.some((lane) => !lane.catalog)) return;
    const canonical = frozenCopy(input);
    this.phase = 'preparing';
    this.lanes.forEach((lane) => {
      lane.phase = 'preparing';
      lane.input = frozenCopy(canonical);
    });
    this.publish();
    try {
      for (let index = 0; index < 2; index++) {
        const lane = this.lanes[index]!;
        const source = await this.clients[index]!.prepare(lane.catalog!, lane.input!.values, start);
        if (generation !== this.generation || this.phase !== 'preparing') return;
        lane.source = frozenCopy(source);
        lane.phase = 'ready';
        this.publish();
      }
      this.phase = 'ready';
      this.publish();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
      this.phase = 'failed';
      this.lanes.forEach((lane) => {
        lane.source = undefined;
        lane.phase = 'failed';
      });
      this.publish();
    }
  }
  async execute() {
    if (
      !['ready', 'settled', 'cancelled'].includes(this.phase) ||
      this.lanes.some((lane) => !lane.source || !lane.input)
    )
      return;
    const start = this.now();
    ++this.generation;
    const generation = this.generation;
    this.stopTimer();
    this.cursor = 0;
    this.phase = 'running';
    this.error = '';
    this.models.forEach((model) => model.invalidate());
    this.lanes.forEach((lane) => {
      lane.result = undefined;
      lane.phase = 'ready';
      lane.error = '';
    });
    this.publish();
    for (let index = 0; index < 2; index++) {
      if (generation !== this.generation) return;
      const lane = this.lanes[index]!;
      const request = caseRequest(
        lane.catalog!,
        lane.source!,
        {
          contextId: crypto.randomUUID(),
          contextRevision: generation,
          sourceRevision: generation,
        },
        frozenCopy(lane.input!),
      );
      lane.phase = 'running';
      this.publish();
      try {
        const show = (result: ExecuteResult) => {
          if (generation !== this.generation || this.phase !== 'running') return false;
          const model = this.models[index]!;
          const token = model.begin(request.identity);
          if (!model.acceptValidated(token, result))
            throw new Error('COMPARISON_IDENTITY_MISMATCH');
          lane.result = result;
          this.publish();
          return true;
        };
        const result = await this.clients[index]!.execute(
          request,
          lane.catalog!,
          (provisional) => {
            this.present(() => {
              show(provisional);
            });
          },
          start,
        );
        if (generation !== this.generation || this.phase !== 'running') return;
        show(result);
        lane.phase = 'accepted';
        this.publish();
      } catch (error) {
        if (generation !== this.generation) return;
        this.models[index]!.invalidate();
        lane.result = undefined;
        lane.phase = 'failed';
        lane.error = message(error);
        this.publish();
      }
    }
    if (generation === this.generation) {
      this.phase = 'settled';
      this.publish();
    }
  }
  cancel() {
    if (this.phase !== 'running' && this.phase !== 'preparing') return;
    ++this.generation;
    this.stopTimer();
    this.clients.forEach((client) => client.invalidate());
    this.lanes.forEach((lane, index) => {
      if (lane.phase !== 'accepted') {
        this.models[index]!.invalidate();
        lane.result = undefined;
        lane.phase = 'cancelled';
      }
      if (this.phase === 'preparing') lane.source = undefined;
    });
    this.phase = 'cancelled';
    this.publish();
  }
  private stopTimer() {
    ++this.timerGeneration;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.playing = false;
  }
  pause = () => {
    this.stopTimer();
    this.publish();
  };
  seek(cursor: number) {
    if (
      !['settled', 'cancelled'].includes(this.phase) ||
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      cursor > this.snapshot.length
    )
      return;
    this.stopTimer();
    this.move(cursor);
    this.publish();
  }
  private move(cursor: number) {
    this.cursor = cursor;
    this.models.forEach((model, index) => {
      if (this.lanes[index]!.phase === 'accepted' && this.lanes[index]!.result?.trace)
        model.seek(Math.min(cursor, model.snapshot().length));
    });
  }
  step(direction: -1 | 1) {
    this.seek(Math.min(this.snapshot.length, Math.max(0, this.cursor + direction)));
  }
  setRate(rate: number) {
    if (![0.25, 0.5, 1, 1.5, 2, 4].includes(rate)) return;
    const resume = this.playing;
    this.stopTimer();
    this.rate = rate;
    this.publish();
    if (resume) this.play();
  }
  play = () => {
    if (
      this.playing ||
      !['settled', 'cancelled'].includes(this.phase) ||
      !this.snapshot.length ||
      this.cursor >= this.snapshot.length
    )
      return;
    this.playing = true;
    this.publish();
    const generation = this.generation,
      timerGeneration = this.timerGeneration;
    const tick = () => {
      if (
        generation !== this.generation ||
        timerGeneration !== this.timerGeneration ||
        !this.playing
      )
        return;
      this.move(Math.min(this.snapshot.length, this.cursor + 1));
      if (this.cursor >= this.snapshot.length) this.stopTimer();
      this.publish();
      if (this.playing) this.timer = setTimeout(tick, 500 / this.rate);
    };
    this.timer = setTimeout(tick, 500 / this.rate);
  };
}
