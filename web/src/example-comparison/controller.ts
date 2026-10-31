import { AdvancedExecutionClient, advancedRequest } from '../engine/advanced-client';
import { AdvancedPlayer } from '../engine/advanced-player';
import type { AdvancedRequest, AdvancedResult } from '../engine/advanced-protocol';
import {
  prepareSolution,
  solutionsFor,
  compareResults,
  type SolutionSpec,
  type Outcome,
} from './content';
import type { ExampleSpec, ExampleInput } from '../examples/content';
type PreparedSolution = ReturnType<typeof prepareSolution>;

type Phase = 'idle' | 'ready' | 'running' | 'settled' | 'cancelled' | 'failed';
type LanePhase = 'idle' | 'ready' | 'running' | 'accepted' | 'cancelled' | 'failed';
interface Lane {
  spec: SolutionSpec;
  prepared: PreparedSolution | null;
  request: AdvancedRequest | null;
  result: AdvancedResult | null;
  phase: LanePhase;
  error: string;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Two same-problem advanced C++ executions, one common deadline; trace consumers only. */
export class ExamplePairController {
  private readonly clients: readonly Pick<AdvancedExecutionClient, 'execute' | 'invalidate'>[];
  private readonly models = [new AdvancedPlayer(), new AdvancedPlayer()];
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private generation = 0;
  private schedule = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private phase: Phase = 'idle';
  private lanes: Lane[] = [];
  private outcome: Outcome = 'unavailable';
  private cursor = 0;
  private playing = false;
  private rate = 1;
  private groupId = '';
  private error = '';
  private current: ReturnType<ExamplePairController['snapshot']>;
  constructor(
    private readonly example: ExampleSpec,
    dependencies: {
      clients?: readonly [
        Pick<AdvancedExecutionClient, 'execute' | 'invalidate'>,
        Pick<AdvancedExecutionClient, 'execute' | 'invalidate'>,
      ];
      now?: () => number;
    } = {},
  ) {
    this.clients = dependencies.clients ?? [
      new AdvancedExecutionClient(),
      new AdvancedExecutionClient(),
    ];
    this.now = dependencies.now ?? (() => performance.now());
    this.lanes = solutionsFor(example).map((spec) => ({
      spec,
      prepared: null,
      request: null,
      result: null,
      phase: 'idle',
      error: '',
    }));
    this.current = this.snapshot();
  }
  private snapshot() {
    return {
      phase: this.phase,
      outcome: this.outcome,
      cursor: this.cursor,
      length: Math.max(...this.models.map((m) => m.snapshot().length)),
      playing: this.playing,
      rate: this.rate,
      groupId: this.groupId,
      error: this.error,
      lanes: this.lanes.map((lane, i) => ({ ...lane, view: this.models[i].snapshot() })),
    };
  }
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.current = this.snapshot();
    this.listeners.forEach((l) => l());
  }
  private stop() {
    this.schedule++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.playing = false;
  }
  invalidate = () => {
    this.generation++;
    this.stop();
    this.clients.forEach((c) => c.invalidate());
    this.models.forEach((m) => m.invalidate());
    this.lanes = this.lanes.map(({ spec }) => ({
      spec,
      prepared: null,
      request: null,
      result: null,
      phase: 'idle',
      error: '',
    }));
    this.cursor = 0;
    this.groupId = '';
    this.error = '';
    this.phase = 'idle';
    this.outcome = 'unavailable';
    this.publish();
  };
  prepare(input: ExampleInput, swapped = false) {
    this.invalidate();
    try {
      const choices = solutionsFor(this.example);
      const specs = swapped ? [...choices].reverse() : choices;
      this.lanes = specs.map((spec) => ({
        spec,
        prepared: freeze(prepareSolution(this.example, spec, structuredClone(input))),
        request: null,
        result: null,
        phase: 'ready',
        error: '',
      }));
      this.phase = 'ready';
    } catch (error) {
      this.phase = 'failed';
      this.error = error instanceof Error ? error.message : 'E_INPUT_INVALID';
    }
    this.publish();
  }
  async execute() {
    if (
      !['ready', 'settled', 'cancelled'].includes(this.phase) ||
      this.lanes.some((l) => !l.prepared)
    )
      return;
    const start = this.now(),
      generation = ++this.generation;
    this.stop();
    this.clients.forEach((c) => c.invalidate());
    this.models.forEach((m) => m.invalidate());
    this.groupId = crypto.randomUUID();
    this.cursor = 0;
    this.phase = 'running';
    this.outcome = 'unavailable';
    this.error = '';
    this.lanes = this.lanes.map((l) => ({
      ...l,
      result: null,
      request: null,
      phase: 'ready',
      error: '',
    }));
    this.publish();
    for (let i = 0; i < 2; i++) {
      if (generation !== this.generation) return;
      const lane = this.lanes[i],
        prepared = lane.prepared!;
      const request = freeze(
        advancedRequest(prepared.source, 'cpp', { kind: 'integers', values: [...prepared.input] }),
      );
      lane.request = request;
      lane.phase = 'running';
      this.publish();
      try {
        if (generation !== this.generation) return;
        if (this.now() - start >= 1000) throw Error('E_DEADLINE');
        const result = await this.clients[i].execute(request, { started: start });
        if (generation !== this.generation) return;
        if (this.now() - start >= 1000) throw Error('E_DEADLINE');
        this.models[i].accept(result);
        if (this.now() - start >= 1000) throw Error('E_DEADLINE');
        lane.result = result;
        lane.phase = 'accepted';
      } catch (error) {
        if (generation !== this.generation) return;
        this.models[i].invalidate();
        lane.result = null;
        lane.phase = 'failed';
        lane.error =
          error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'E_EXECUTION_FAILURE';
      }
      this.publish();
      if (generation !== this.generation) return;
      if (lane.phase === 'accepted' && this.now() - start >= 1000) {
        this.models[i].invalidate();
        lane.result = null;
        lane.phase = 'failed';
        lane.error = 'E_DEADLINE';
        this.publish();
      }
    }
    if (generation === this.generation) {
      this.outcome = compareResults(
        this.example,
        this.lanes[0].prepared!.logicalLength,
        this.lanes.map((l) => l.result),
      );
      if (this.now() - start >= 1000 && this.lanes[1].phase === 'accepted') {
        this.models[1].invalidate();
        this.lanes[1].result = null;
        this.lanes[1].phase = 'failed';
        this.lanes[1].error = 'E_DEADLINE';
        this.outcome = 'unavailable';
      }
      this.phase = 'settled';
      this.publish();
      if (generation !== this.generation) return;
      if (this.now() - start >= 1000 && this.lanes[1].phase === 'accepted') {
        this.models[1].invalidate();
        this.lanes[1].result = null;
        this.lanes[1].phase = 'failed';
        this.lanes[1].error = 'E_DEADLINE';
        this.outcome = 'unavailable';
        this.publish();
      }
    }
  }
  cancel() {
    if (this.phase !== 'running') return;
    this.generation++;
    this.stop();
    this.clients.forEach((c) => c.invalidate());
    this.lanes.forEach((lane, i) => {
      if (lane.phase !== 'accepted') {
        this.models[i].invalidate();
        lane.result = null;
        lane.phase = 'cancelled';
      }
    });
    this.phase = 'cancelled';
    this.publish();
  }
  pause = () => {
    this.stop();
    this.publish();
  };
  private move(cursor: number) {
    this.cursor = cursor;
    this.models.forEach((m, i) => {
      if (this.lanes[i].phase === 'accepted' && this.lanes[i].result?.trace)
        m.seek(Math.min(cursor, m.snapshot().length));
    });
  }
  seek(cursor: number) {
    if (
      !['settled', 'cancelled'].includes(this.phase) ||
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      cursor > this.current.length
    )
      return;
    this.stop();
    this.move(cursor);
    this.publish();
  }
  step(delta: -1 | 1) {
    this.seek(Math.min(this.current.length, Math.max(0, this.cursor + delta)));
  }
  setRate(rate: number) {
    if (![0.25, 0.5, 1, 1.5, 2, 4].includes(rate)) return;
    const resume = this.playing;
    this.stop();
    this.rate = rate;
    this.publish();
    if (resume) this.play();
  }
  play = () => {
    if (
      this.playing ||
      !['settled', 'cancelled'].includes(this.phase) ||
      !this.current.length ||
      this.cursor >= this.current.length
    )
      return;
    this.playing = true;
    this.publish();
    const generation = this.generation,
      schedule = this.schedule;
    const tick = () => {
      if (generation !== this.generation || schedule !== this.schedule || !this.playing) return;
      this.move(Math.min(this.current.length, this.cursor + 1));
      if (this.cursor >= this.current.length) this.stop();
      this.publish();
      if (this.playing) this.timer = setTimeout(tick, 500 / this.rate);
    };
    this.timer = setTimeout(tick, 500 / this.rate);
  };
}
