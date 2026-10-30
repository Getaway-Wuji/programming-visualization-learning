import { MemoryExecutionClient, memoryRequest } from '../engine/memory-client';
import { MemoryPlayer } from '../engine/memory-player';
import type { MemoryRequest, MemoryResult } from '../engine/memory-protocol';
import { sourceLines, stepVisits } from '../debug/breakpoints';

export class MemoryWorkspaceController {
  private readonly player = new MemoryPlayer();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private schedule = 0;
  private source = '';
  private language: MemoryRequest['language'] = 'c';
  private readonly breakpoints = new Set<number>();
  private visits: ReturnType<typeof stepVisits> = [];
  private visitedLines: number[] = [];
  private hit: { line: number; cursor: number; byteRange?: { start: number; end: number } } | null =
    null;
  private breakpointNotice = '';
  private result: MemoryResult | null = null;
  private status = 'idle';
  private error = '';
  private rate = 1;
  private runs = 0;
  private current: ReturnType<MemoryWorkspaceController['snapshot']>;
  constructor(private readonly client = new MemoryExecutionClient()) {
    this.current = this.snapshot();
  }
  private snapshot() {
    return {
      view: this.player.snapshot(),
      result: this.result,
      status: this.status,
      error: this.error,
      rate: this.rate,
      runs: this.runs,
      breakpoints: [...this.breakpoints].sort((a, b) => a - b),
      visitedLines: this.visitedLines,
      hit: this.hit,
      breakpointNotice: this.breakpointNotice,
    };
  }
  readonly getSnapshot = () => this.current;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.current = this.snapshot();
    for (const listener of this.listeners) listener();
  }
  private clearTimer() {
    this.schedule++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  invalidate() {
    this.generation++;
    this.clearTimer();
    this.client.invalidate();
    this.player.invalidate();
    this.result = null;
    this.visits = [];
    this.visitedLines = [];
    this.hit = null;
    this.status = 'idle';
    this.error = '';
    this.publish();
  }
  async execute(source: string, language: MemoryRequest['language'], input: number[]) {
    this.setSource(source, language);
    this.invalidate();
    const generation = this.generation;
    this.status = 'running';
    this.runs++;
    this.publish();
    try {
      const result = await this.client.execute(memoryRequest(source, language, input));
      if (generation !== this.generation) return;
      this.result = result;
      this.visits = stepVisits(source, result);
      this.visitedLines = [
        ...new Set(
          this.visits.flatMap((visit) =>
            visit.callSite ? [visit.line, visit.callSite.line] : [visit.line],
          ),
        ),
      ];
      this.player.accept(result);
      this.status = result.trace ? 'ready' : 'rejected';
      this.publish();
    } catch (error) {
      if (generation !== this.generation) return;
      this.status = 'failed';
      this.error = error instanceof Error ? error.message : 'E_MODULE_LOAD';
      this.publish();
    }
  }
  cancel() {
    this.client.cancel();
  }
  pause() {
    this.clearTimer();
    this.player.pause();
    this.publish();
  }
  seek(cursor: number) {
    this.clearTimer();
    if (this.player.seek(cursor)) {
      this.hit = null;
      this.publish();
    }
  }
  step(delta: -1 | 1) {
    const view = this.current.view;
    if (view.state) this.seek(view.cursor + delta);
  }
  play() {
    this.clearTimer();
    this.hit = null;
    this.player.play();
    this.publish();
    const generation = this.generation;
    const schedule = this.schedule;
    const tick = () => {
      if (generation !== this.generation || schedule !== this.schedule) return;
      const cursor = this.current.view.cursor + 1;
      this.player.tick();
      const visit = this.visits[cursor - 1];
      if (visit?.callSite && this.breakpoints.has(visit.callSite.line)) {
        this.player.pause();
        this.hit = { ...visit.callSite, cursor };
      } else if (visit?.entry && this.breakpoints.has(visit.line)) {
        this.player.pause();
        this.hit = { line: visit.line, cursor };
      }
      this.publish();
      if (generation === this.generation && schedule === this.schedule && this.current.view.playing)
        this.timer = setTimeout(tick, 500 / this.rate);
    };
    if (this.current.view.playing) this.timer = setTimeout(tick, 500 / this.rate);
  }
  toggle() {
    if (this.current.view.playing) this.pause();
    else this.play();
  }
  replay() {
    if (this.current.view.state) {
      this.seek(0);
      this.play();
    }
  }
  setRate(rate: number) {
    if (![0.25, 0.5, 1, 1.5, 2, 4].includes(rate)) return;
    const playing = this.current.view.playing;
    this.rate = rate;
    if (playing) this.play();
    else this.publish();
  }
  setSource(source: string, language: MemoryRequest['language']) {
    if (source === this.source && language === this.language) return;
    const hadBreakpoints = this.breakpoints.size > 0;
    this.source = source;
    this.language = language;
    this.breakpoints.clear();
    this.breakpointNotice = hadBreakpoints ? '源码已变化，原行断点已清除。' : '';
    this.invalidate();
  }
  toggleBreakpoint(line: number) {
    const target = sourceLines(this.source)[line - 1];
    if (!Number.isInteger(line) || !target?.text.trim()) return;
    this.pause();
    this.hit = null;
    this.breakpointNotice = '';
    if (this.breakpoints.has(line)) this.breakpoints.delete(line);
    else this.breakpoints.add(line);
    this.publish();
  }
  clearBreakpoints() {
    this.pause();
    this.breakpoints.clear();
    this.hit = null;
    this.breakpointNotice = '';
    this.publish();
  }
}
