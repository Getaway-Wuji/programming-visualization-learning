export function capturePerformanceHost(
  directory: string,
  name: 'start' | 'end',
): Record<string, unknown>;
export function qualifyPerformanceHost(
  start: Record<string, unknown>,
  end: Record<string, unknown>,
): { satisfied: boolean; checks: Record<string, boolean>; boundary: string };
