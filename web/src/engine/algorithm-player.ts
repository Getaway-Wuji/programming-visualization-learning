import {
  projectAlgorithmStep,
  type AlgorithmResult,
  type AlgorithmState,
} from './algorithm-protocol';

/** A pure trace consumer. The accepted result must come from AlgorithmExecutionClient. */
export class AlgorithmPlayer {
  private result: AlgorithmResult | null = null;
  private state: AlgorithmState | null = null;
  private cursor = 0;
  private playing = false;
  accept(result: AlgorithmResult) {
    this.result = result;
    this.state = result.trace ? structuredClone(result.trace.initialState) : null;
    this.cursor = 0;
    this.playing = false;
  }
  invalidate() {
    this.result = null;
    this.state = null;
    this.cursor = 0;
    this.playing = false;
  }
  pause() {
    this.playing = false;
  }
  play() {
    this.playing = Boolean(this.result?.trace && this.cursor < this.result.trace.steps.length);
  }
  tick() {
    if (!this.playing || !this.result?.trace) return false;
    const next = this.cursor + 1;
    this.seek(next);
    this.playing = next < this.result.trace.steps.length;
    return true;
  }
  seek(cursor: number) {
    const trace = this.result?.trace;
    if (!trace || !Number.isInteger(cursor) || cursor < 0 || cursor > trace.steps.length)
      return false;
    if (cursor === this.cursor + 1)
      this.state = projectAlgorithmStep(this.state!, trace.steps[this.cursor]);
    else if (cursor === this.cursor - 1)
      this.state = projectAlgorithmStep(this.state!, trace.steps[cursor], true);
    else if (cursor !== this.cursor) {
      const point = trace.checkpoints[Math.floor(cursor / 128)];
      this.state = structuredClone(point.state);
      for (let at = point.cursor; at < cursor; at++)
        this.state = projectAlgorithmStep(this.state, trace.steps[at]);
    }
    this.cursor = cursor;
    this.playing = false;
    return true;
  }
  snapshot() {
    const step = this.cursor ? this.result?.trace?.steps[this.cursor - 1] : null;
    const node = step ? this.result?.nodeMap.find((item) => item.nodeId === step.nodeId) : null;
    return structuredClone({
      cursor: this.cursor,
      length: this.result?.trace?.steps.length ?? 0,
      state: this.state,
      playing: this.playing,
      identity: this.result?.identity ?? null,
      language: this.result?.language ?? null,
      stepKind: step?.kind ?? null,
      byteRange: node?.byteRange ?? null,
      terminal: this.result?.terminal ?? null,
    });
  }
}
