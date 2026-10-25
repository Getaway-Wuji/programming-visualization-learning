import type { PlayerSnapshot } from './model';

// One pending observation per actual view, held weakly. These private numbers
// never affect scheduling, accepted traces, learning records or playback state.
const starts = new WeakMap<PlayerSnapshot, number>();
const measureName = 'cviz.player.frame';

export function beginPlayerFrame(view: PlayerSnapshot, start: number): void {
  starts.set(view, start);
}

/** Called after React committed the trace view for the same published tick. */
export function commitPlayerFrame(view: PlayerSnapshot): void {
  const start = starts.get(view);
  if (start === undefined) return;
  starts.delete(view);
  try {
    performance.clearMeasures(measureName);
    performance.measure(measureName, {
      start,
      end: performance.now(),
      detail: { cursor: view.cursor, operation: 'tick' },
    });
  } catch {
    // Optional browser diagnostics must never interrupt real playback.
  }
}
