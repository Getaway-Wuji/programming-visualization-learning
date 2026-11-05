import { AdvancedExecutionClient, advancedRequest } from '../engine/advanced-client';
import { AdvancedPlayer } from '../engine/advanced-player';
import type { AdvancedRequest, AdvancedResult } from '../engine/advanced-protocol';
import { sourceLines, stepVisits } from '../debug/breakpoints';
import {
  teachingStops,
  teachingStartCursor,
  teachingEndCursor,
  teachingSwapGroups,
} from '../visual-lab/stops';
import { nextStepCursor, keyStepPosition } from '../player/key-steps';

export class CustomCodeController {
  private readonly player = new AdvancedPlayer();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private schedule = 0;
  private source = '';
  private language: AdvancedRequest['language'] = 'c';
  private readonly breakpoints = new Set<number>();
  private visits: ReturnType<typeof stepVisits> = [];
  private visitedLines: number[] = [];
  private hit: { line: number; cursor: number; byteRange?: { start: number; end: number } } | null =
    null;
  private breakpointNotice = '';
  private result: AdvancedResult | null = null;
  private status = 'idle';
  private error = '';
  private rate = 1;
  private runs = 0;
  private stops: readonly number[] = [0];
  private startCursor = 0;
  private endCursor = 0;
  private swaps: { start: number; end: number }[] = [];
  private current: ReturnType<CustomCodeController['snapshot']>;
  constructor(
    private readonly client = new AdvancedExecutionClient(),
    private teaching = false,
  ) {
    this.current = this.snapshot();
  }
  private snapshot() {
    const view = this.player.snapshot();
    return {
      view,
      result: this.result,
      status: this.status,
      error: this.error,
      rate: this.rate,
      runs: this.runs,
      startCursor: this.startCursor,
      endCursor: this.endCursor,
      keyPosition: keyStepPosition(this.stops, view.cursor),
      keyLength: this.stops.length - 1,
      swap: this.teaching ? (this.swaps.find((group) => group.end === view.cursor) ?? null) : null,
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
    this.stops = [0];
    this.startCursor = 0;
    this.endCursor = 0;
    this.swaps = [];
    this.visits = [];
    this.visitedLines = [];
    this.hit = null;
    this.status = 'idle';
    this.error = '';
    this.publish();
  }
  async execute(
    source: string,
    language: AdvancedRequest['language'],
    input: number[] | AdvancedRequest['input'],
  ) {
    this.setSource(source, language);
    this.invalidate();
    const generation = this.generation;
    this.status = 'running';
    this.runs++;
    this.publish();
    try {
      const result = await this.client.execute(
        advancedRequest(
          source,
          language,
          Array.isArray(input) ? { kind: 'integers', values: input } : input,
        ),
      );
      if (generation !== this.generation) return;
      this.result = result;
      this.stops = teachingStops(source, result);
      this.swaps = teachingSwapGroups(source, result);
      this.startCursor = this.teaching ? teachingStartCursor(source, result) : 0;
      this.endCursor = this.teaching
        ? teachingEndCursor(source, result)
        : (result.trace?.steps.length ?? 0);
      this.stops = [
        this.startCursor,
        ...this.stops.filter((cursor) => cursor > this.startCursor && cursor <= this.endCursor),
      ];
      if (this.stops.at(-1) !== this.endCursor) this.stops = [...this.stops, this.endCursor];
      this.visits = stepVisits(source, result);
      this.visitedLines = [
        ...new Set(
          this.visits.flatMap((visit) =>
            visit.callSite ? [visit.line, visit.callSite.line] : [visit.line],
          ),
        ),
      ];
      this.player.accept(result);
      if (this.startCursor) this.player.seek(this.startCursor);
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
    if (this.player.seek(this.displayCursor(cursor))) {
      this.hit = null;
      this.publish();
    }
  }
  private displayCursor(cursor: number) {
    return this.teaching
      ? (this.swaps.find((group) => cursor > group.start && cursor < group.end)?.end ?? cursor)
      : cursor;
  }
  step(delta: -1 | 1) {
    const view = this.current.view;
    if (view.state)
      this.seek(
        this.teaching ? nextStepCursor(this.stops, view.cursor, delta) : view.cursor + delta,
      );
  }
  setTeachingPlayback(value: boolean) {
    this.teaching = value;
  }
  seekDisplay(position: number) {
    this.seek(this.stops[position] ?? this.current.view.cursor);
  }
  play() {
    if (this.teaching && this.current.view.cursor >= this.endCursor) return;
    this.clearTimer();
    this.hit = null;
    this.player.play();
    this.publish();
    const generation = this.generation;
    const schedule = this.schedule;
    const tick = () => {
      if (generation !== this.generation || schedule !== this.schedule) return;
      let cursor = this.teaching
        ? nextStepCursor(this.stops, this.current.view.cursor, 1)
        : this.current.view.cursor + 1;
      // A breakpoint inside an atomic swap pauses after the complete exchange.
      let hitLine: number | null = null;
      for (let c = this.current.view.cursor + 1; c <= cursor; c++) {
        const stop = this.visits[c - 1];
        if (
          (stop?.entry && this.breakpoints.has(stop.line)) ||
          (stop?.callSite && this.breakpoints.has(stop.callSite.line))
        ) {
          cursor = c;
          hitLine =
            stop.callSite && this.breakpoints.has(stop.callSite.line)
              ? stop.callSite.line
              : stop.line;
          break;
        }
      }
      cursor = this.displayCursor(cursor);
      this.player.tick(cursor);
      if (this.teaching && cursor >= this.endCursor) this.player.pause();
      const visit = this.visits[cursor - 1];
      if (hitLine !== null) {
        this.player.pause();
        this.hit = { line: hitLine, cursor };
      } else if (visit?.callSite && this.breakpoints.has(visit.callSite.line)) {
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
      this.seek(this.teaching ? this.startCursor : 0);
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
  setSource(source: string, language: AdvancedRequest['language']) {
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
