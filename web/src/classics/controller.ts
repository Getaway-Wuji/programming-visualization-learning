import { MemoryExecutionClient, memoryRequest } from '../engine/memory-client';
import { MemoryPlayer } from '../engine/memory-player';
import type { MemoryRequest, MemoryResult } from '../engine/memory-protocol';
import { prepareClassic, type ClassicCase } from './content';
export class ClassicController {
  private readonly player = new MemoryPlayer();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private schedule = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private result: MemoryResult | null = null;
  private request: MemoryRequest | null = null;
  private status: 'idle' | 'running' | 'ready' | 'rejected' | 'failed' = 'idle';
  private error = '';
  private rate = 1;
  private runs = 0;
  private current: ReturnType<ClassicController['snapshot']>;
  constructor(private readonly client = new MemoryExecutionClient()) {
    this.current = this.snapshot();
  }
  private snapshot() {
    return {
      view: this.player.snapshot(),
      result: this.result,
      request: this.request,
      status: this.status,
      error: this.error,
      rate: this.rate,
      runs: this.runs,
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
    this.listeners.forEach((listener) => listener());
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
    this.request = null;
    this.result = null;
    this.status = 'idle';
    this.error = '';
    this.publish();
  }
  async execute(spec: ClassicCase, draft: string) {
    this.invalidate();
    const generation = this.generation;
    try {
      const prepared = prepareClassic(spec, draft),
        request = memoryRequest(prepared.source, 'cpp', prepared.input);
      this.request = request;
      this.status = 'running';
      this.runs++;
      this.publish();
      const result = await this.client.execute(request);
      if (generation !== this.generation) return;
      this.result = result;
      this.player.accept(result);
      this.status = result.trace ? 'ready' : 'rejected';
      this.publish();
    } catch (error) {
      if (generation !== this.generation) return;
      this.player.invalidate();
      this.result = null;
      this.status = 'failed';
      this.error =
        error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'E_EXECUTION_FAILURE';
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
    if (this.player.seek(cursor)) this.publish();
  }
  step(delta: -1 | 1) {
    if (this.current.view.state) this.seek(this.current.view.cursor + delta);
  }
  play() {
    this.clearTimer();
    this.player.play();
    this.publish();
    const generation = this.generation,
      schedule = this.schedule;
    const tick = () => {
      if (generation !== this.generation || schedule !== this.schedule) return;
      this.player.tick();
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
    this.seek(0);
  }
  setRate(rate: number) {
    if (![0.25, 0.5, 1, 1.5, 2, 4].includes(rate)) return;
    const playing = this.current.view.playing;
    this.rate = rate;
    if (playing) this.play();
    else this.publish();
  }
}
