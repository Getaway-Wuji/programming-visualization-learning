import { useCallback, useEffect, useRef, useState } from 'react';
import { C6ExecutionClient } from '../engine/c6-client';
import { c6BlockProgram, c6SourceHash } from '../engine/c6-protocol';
import type { C6EditResult } from '../engine/c6-types';
import type { BlockProgram } from '../blocks/model';

/** Background mapping yields the shared execution slot to explicit runs. */
export function useBlockMapping({
  enabled,
  suspended,
  documentId,
  source,
  sourceRevision,
}: {
  enabled: boolean;
  suspended: boolean;
  documentId: string;
  source: string;
  sourceRevision: string;
}) {
  const [engine] = useState(() => new C6ExecutionClient());
  const [edit, setEdit] = useState<C6EditResult | null>(null);
  const [presentedBlocks, setPresentedBlocks] = useState<BlockProgram | null>(null);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const operation = useRef({
    token: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const pause = useCallback(() => {
    operation.current.token++;
    clearTimeout(operation.current.timer);
    engine.invalidate();
  }, [engine]);
  useEffect(() => {
    if (!enabled || suspended) return;
    const token = ++operation.current.token;
    const current = () => token === operation.current.token;
    operation.current.timer = setTimeout(() => {
      setMapping(true);
      setError('');
      void (async () => {
        const sourceSha256 = await c6SourceHash(source);
        // Hashing can finish after a run has already suspended this task.
        if (!current()) return;
        const response = await engine.execute({
          editVersion: '2.0.0',
          documentId,
          packageRef: { id: 'content.c.primer6', version: '1.0.0' },
          engine: { id: 'engine.rust.c6', version: '0.1.0' },
          sourceRevision,
          sourceSha256,
          source,
        });
        if (!('editVersion' in response)) throw Error('E_PROTOCOL_INVALID');
        if (!current()) return;
        setEdit(response);
        if (response.status === 'mapped') setPresentedBlocks(c6BlockProgram(response));
      })()
        .catch(() => {
          if (current()) setError('积木暂时无法同步，请重试。');
        })
        .finally(() => {
          if (current()) setMapping(false);
        });
    }, 200);
    return pause;
  }, [enabled, suspended, documentId, source, sourceRevision, retry, engine, pause]);
  return {
    edit,
    presentedBlocks,
    mapping: enabled && !suspended && (mapping || edit?.sourceRevision !== sourceRevision),
    error,
    clearError: () => setError(''),
    retry: () => setRetry((value) => value + 1),
    pause,
  };
}
