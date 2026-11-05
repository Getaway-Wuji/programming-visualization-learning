import { vi } from 'vitest';

/** Generate genuine WASM fixtures without treating a shared runner as a benchmark.
 * Only the synchronous fixture producer uses this clock. Consumers, production
 * code and browser deadline tests retain their own clocks and original budgets.
 */
export function withSemanticWasmClock<T>(produce: () => T): T {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    return produce();
  } finally {
    clock.mockRestore();
  }
}
