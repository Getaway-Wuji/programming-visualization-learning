import { useEffect, useState } from 'react';

export function usePythonResource<K, T>(key: K, load: (key: K, signal: AbortSignal) => Promise<T>) {
  const [attempt, retry] = useState(0);
  const [result, set] = useState<{ key: K; attempt: number; value: T | null; failed: boolean }>();
  useEffect(() => {
    const request = new AbortController();
    void load(key, request.signal).then(
      (value) => {
        if (!request.signal.aborted) set({ key, attempt, value, failed: false });
      },
      () => {
        if (!request.signal.aborted) set({ key, attempt, value: null, failed: true });
      },
    );
    return () => request.abort();
  }, [attempt, key, load]);
  const current = result?.key === key && result.attempt === attempt ? result : null;
  return {
    value: current?.value ?? null,
    failed: !!current?.failed,
    retry: () => retry((n) => n + 1),
  };
}
