import { AdvancedPlayer } from '../engine/advanced-player';
import { outputsMatch } from '../practice/output-policy';
import { PracticeClient } from './client';
import type { Assessment, GeneratedProblem, PracticeRequest, Selection } from './protocol';

export class GeneratedPracticeController {
  private readonly player = new AdvancedPlayer();
  private listeners = new Set<() => void>();
  private serial = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private schedule = 0;
  private rate = 1;
  private selection: Selection = {
    knowledgeId: 'knowledge.c.expressions',
    difficulty: 1,
    seed: '42',
  };
  private problem: GeneratedProblem | null = null;
  private assessment: Assessment | null = null;
  private operation = '';
  private source = '';
  private input = '0';
  private revision = crypto.randomUUID();
  private attempt = crypto.randomUUID();
  private status = 'idle';
  private error = '';
  private current: ReturnType<GeneratedPracticeController['snapshot']>;
  constructor(private readonly client = new PracticeClient()) {
    this.current = this.snapshot();
  }
  private snapshot() {
    return {
      selection: this.selection,
      problem: this.problem,
      assessment: this.assessment,
      source: this.source,
      input: this.input,
      status: this.status,
      error: this.error,
      operation: this.operation,
      rate: this.rate,
      view: this.player.snapshot(),
    };
  }
  getSnapshot = () => this.current;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish() {
    this.current = this.snapshot();
    for (const fn of this.listeners) fn();
  }
  private stopTimer() {
    this.schedule++;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  invalidate() {
    this.serial++;
    this.stopTimer();
    this.client.invalidate();
    this.player.invalidate();
    this.assessment = null;
    this.status = 'idle';
    this.error = '';
    this.operation = '';
    this.publish();
  }
  clear() {
    this.invalidate();
    this.problem = null;
    this.source = '';
    this.attempt = crypto.randomUUID();
    this.revision = crypto.randomUUID();
    this.publish();
  }
  select(patch: Partial<Selection>) {
    this.clear();
    this.selection = { ...this.selection, ...patch };
    this.publish();
  }
  edit(source: string) {
    this.invalidate();
    this.source = source;
    this.revision = crypto.randomUUID();
    this.publish();
  }
  setInput(input: string) {
    this.invalidate();
    this.input = input;
    this.publish();
  }
  async run(operation: 'generate' | 'grade' | 'preview') {
    if (operation !== 'generate' && !this.problem) return;
    this.invalidate();
    if (operation === 'generate') {
      this.problem = null;
      this.source = '';
      this.attempt = crypto.randomUUID();
      this.revision = crypto.randomUUID();
    }
    const serial = this.serial;
    this.operation = operation;
    this.status = 'running';
    this.publish();
    const base = {
      generatorVersion: '1.0.0' as const,
      requestId: crypto.randomUUID(),
      ...this.selection,
    };
    const request: PracticeRequest =
      operation === 'generate'
        ? { ...base, operation }
        : {
            ...base,
            operation,
            problemId: this.problem!.problemId,
            attemptId: this.attempt,
            sourceRevision: this.revision,
            source: this.source,
            ...(operation === 'preview' ? { inputText: this.input } : {}),
          };
    try {
      const response = await this.client.run(request, this.problem ?? undefined);
      if (serial !== this.serial) return;
      if (response.operation === 'generate') {
        this.problem = response.problem;
        this.source = response.problem.starterSource;
        this.input = String(response.problem.inputMin);
        this.status = 'generated';
      } else {
        const raw = response.assessment;
        const results = raw.results.map((row) =>
          row.status === 'wrong-answer' && outputsMatch(row.actualStdout, row.expectedStdout)
            ? { ...row, status: 'passed' as const }
            : { ...row },
        );
        const passedCases = results.filter((row) => row.status === 'passed').length;
        this.assessment = {
          ...raw,
          results,
          passedCases,
          verdict: raw.complete && passedCases === raw.totalCases ? 'passed' : raw.verdict,
        };
        this.player.accept(response.assessment.replay.result);
        this.status = 'assessed';
      }
      this.publish();
    } catch (e) {
      if (serial !== this.serial) return;
      this.status = 'failed';
      this.error = e instanceof Error ? e.message : 'E_WORKER_FAILURE';
      this.publish();
    }
  }
  cancel() {
    this.client.cancel();
  }
  pause() {
    this.stopTimer();
    this.player.pause();
    this.publish();
  }
  seek(cursor: number) {
    this.stopTimer();
    if (this.player.seek(cursor)) this.publish();
  }
  step(delta: -1 | 1) {
    this.seek(this.current.view.cursor + delta);
  }
  play() {
    this.stopTimer();
    this.player.play();
    this.publish();
    const serial = this.serial,
      schedule = this.schedule;
    const tick = () => {
      if (serial !== this.serial || schedule !== this.schedule) return;
      this.player.tick();
      this.publish();
      if (this.current.view.playing) this.timer = setTimeout(tick, 500 / this.rate);
    };
    if (this.current.view.playing) this.timer = setTimeout(tick, 500 / this.rate);
  }
  replay() {
    this.seek(0);
    this.play();
  }
  setRate(rate: number) {
    if (![0.25, 0.5, 1, 1.5, 2, 4].includes(rate)) return;
    const playing = this.current.view.playing;
    this.rate = rate;
    if (playing) this.play();
    else this.publish();
  }
}
