import { useEffect, useRef, useState } from 'react';
import { engineClient } from '../engine/client';
import { EngineFailure, type EngineState } from '../engine/types';
import { useLearning } from '../learning/react';

const messages: Record<string, string> = {
  MODULE_LOAD_FAILED: '执行模块未能下载，请检查网络后重试。',
  MODULE_INVALID: '执行模块文件不完整或版本不一致，请重新加载页面后重试。',
  WORKER_FAILED: '浏览器未能启动执行模块，请重试或使用支持的浏览器。',
  RESPONSE_INVALID: '执行模块返回的数据未通过检查，请重试。',
  CHECK_CANCELLED: '检查已取消。可以重新检查。',
  CHECK_TIMEOUT: '执行模块检查超时。可以重新检查。',
};

export function EngineConnection() {
  const { service } = useLearning();
  const [state, setState] = useState<EngineState>('idle');
  const [message, setMessage] = useState(
    '检查浏览器能否加载执行模块。构建检查不执行 C；案例页可运行内容样例。',
  );
  const owned = useRef<string | null>(null);
  useEffect(
    () =>
      service.subscribeSessionInvalidation(() => {
        const id = owned.current;
        owned.current = null;
        if (id) engineClient.cancel('local-data-cleared', id);
        setState('idle');
        setMessage('本地临时上下文已失效，可以重新检查执行模块。');
      }),
    [service],
  );
  useEffect(
    () => () => {
      if (owned.current) engineClient.cancel('page-changed', owned.current);
      owned.current = null;
    },
    [],
  );
  async function check() {
    setState('loading');
    setMessage('正在加载并检查执行模块……');
    const pending = engineClient.check();
    const id = engineClient.inspect().checkId!;
    owned.current = id;
    try {
      await pending;
      if (owned.current !== id) return;
      setState('ready');
      setMessage('执行模块检查通过。构建检查不执行 C；案例页可运行内容样例。');
    } catch (error) {
      if (owned.current !== id) return;
      const code = error instanceof EngineFailure ? error.code : 'WORKER_FAILED';
      setState(
        code === 'CHECK_CANCELLED'
          ? 'cancelled'
          : code === 'CHECK_TIMEOUT'
            ? 'timed-out'
            : 'failed',
      );
      setMessage(messages[code]!);
    } finally {
      if (owned.current === id) owned.current = null;
    }
  }
  return (
    <section className="card section-card" data-testid="engine-connection" data-state={state}>
      <h2>执行模块连接</h2>
      <p role={state === 'failed' || state === 'timed-out' ? 'alert' : 'status'}>{message}</p>
      <div className="inline-actions">
        <button
          className="button button-secondary"
          disabled={state === 'loading'}
          onClick={() => void check()}
        >
          检查执行模块
        </button>
        {state === 'loading' && (
          <button
            className="button button-secondary"
            onClick={() => engineClient.cancel('user', owned.current ?? undefined)}
          >
            取消检查
          </button>
        )}
      </div>
    </section>
  );
}
