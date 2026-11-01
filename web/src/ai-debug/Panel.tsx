import { Link } from 'react-router';
import { buildContext, validateOriginal, type ContextInput } from './context';
import { AiFailure, factLabel, messages, providers, type Fact } from './protocol';
import { useAi } from './react';
import { acceptedAdvancedRequest } from '../engine/advanced-client';
import { ensure } from './protocol';
import './ai-debug.css';

export function AiPanel({
  input,
  pause,
  locate,
}: {
  input: ContextInput;
  pause: () => void;
  locate: (fact: Fact) => void;
}) {
  const { session, state } = useAi();
  const provider = providers.find((p) => p.id === state.provider?.providerId);
  const accepted = () => {
    const request = input.result ? acceptedAdvancedRequest(input.result) : null;
    ensure(
      request && request.language === 'c' && request.source === input.source,
      'E_AI_CONTEXT_STALE',
    );
  };
  const prepare = () => {
    pause();
    try {
      accepted();
      const context = buildContext(input);
      validateOriginal(context, input);
      session.preview(context);
    } catch (error) {
      session.report(error instanceof AiFailure ? error.code : 'E_AI_CONTEXT_LIMIT');
    }
  };
  let shown = state.preview?.context ?? null;
  if (state.response) {
    try {
      accepted();
      shown = buildContext(input);
    } catch {
      shown = null;
    }
  }
  const facts = new Map(shown?.facts.map((f) => [f.factId, f]));
  return (
    <section className="ai-panel" data-ui="ai-debug" aria-labelledby="ai-panel-title">
      <div className="ai-heading">
        <h3 id="ai-panel-title">AI解释（可选）</h3>
        {state.enabled ? (
          <button
            className="button button-small"
            disabled={!input.result || state.state === 'busy'}
            onClick={prepare}
          >
            预览本次AI请求
          </button>
        ) : (
          <Link className="text-link" to="/settings?panel=ai">
            在设置中配置AI
          </Link>
        )}
      </div>
      {!state.enabled && <p>AI解释当前关闭。真实执行、诊断和回放照常使用。</p>}
      {state.enabled && !state.preview && !state.response && (
        <p>先运行C代码，再预览当前源码与真实事实；确认后才向所选服务发送。</p>
      )}
      {state.preview && (
        <div className="ai-preview" aria-label="本次外发预览">
          <h4>确认本次发送内容</h4>
          <p>
            接收方：{provider?.label} / {state.preview.provider.model}（{provider?.host}
            ），经本平台同源转发。平台转发方会接触当次Key和下列内容。
          </p>
          <p>
            {shown?.traceAvailable
              ? `只解释当前步骤 ${shown.cursor} 的已接受状态。`
              : '本次语法或前置检查没有轨迹，只发送真实诊断；没有可跳转步骤。'}{' '}
            已选{shown?.facts.length}项事实，上游请求{state.providerBytes}字节，最多等待60秒。
          </p>
          {shown?.snippets.map((s) => (
            <div key={s.snippetId}>
              <p className="ai-caption">
                原代码第{s.firstLine}行起，UTF8字节{s.byteRange.start}—{s.byteRange.end}
              </p>
              <pre className="ai-source">
                <code>{s.text}</code>
              </pre>
            </div>
          ))}
          <ul className="ai-facts">
            {shown?.facts.map((f) => (
              <li key={f.factId}>
                <code>{f.factId}</code> {factLabel(f)}
              </li>
            ))}
          </ul>
          <p>
            {provider?.retention}{' '}
            费用由你的Key账户承担。选中变量可能含输入派生值；不发送原始输入或完整学习档案。取消不能保证服务方停止或免收费。
          </p>
          <div className="inline-actions">
            <button
              className="button button-primary"
              disabled={state.state === 'busy'}
              onClick={() => {
                const preview = state.preview;
                if (!preview) return;
                try {
                  validateOriginal(preview.context, input);
                  void session.send(preview);
                } catch {
                  session.report('E_AI_CONTEXT_STALE');
                }
              }}
            >
              确认并发送本次内容
            </button>
            <button
              className="button button-secondary"
              onClick={() =>
                state.state === 'busy' ? session.cancel() : session.invalidateContext()
              }
            >
              {state.state === 'busy' ? '取消本端等待' : '取消预览'}
            </button>
          </div>
        </div>
      )}
      {state.state === 'busy' && (
        <p role="status">
          正在等待{provider?.label}解释，正常执行不受影响。更改代码或步骤会取消本次等待。
        </p>
      )}
      {state.code && (
        <p role="alert" className="notice">
          {messages[state.code]}
        </p>
      )}
      {state.response && shown && (
        <div className="ai-answer" aria-label="AI解释与真实事实">
          <h4>真实Rust事实</h4>
          <ul className="ai-facts">
            {shown.facts.map((f) => (
              <li key={f.factId}>{factLabel(f)}</li>
            ))}
          </ul>
          <h4>AI解释</h4>
          <p>{state.response.content.summary}</p>
          {state.response.content.explanations.map((item, i) => (
            <div key={i}>
              <p>{item.text}</p>
              <div className="inline-actions">
                {item.factIds.map((id) => {
                  const fact = facts.get(id);
                  return fact ? (
                    <button key={id} className="button button-small" onClick={() => locate(fact)}>
                      {fact.kind === 'step'
                        ? `查看真实步骤 ${fact.step}`
                        : fact.kind === 'state'
                          ? `查看步骤 ${fact.atCursor} 的值`
                          : '查看真实诊断源码'}
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          ))}
          {!!state.response.content.suggestions.length && (
            <>
              <h4>AI建议（未经执行验证）</h4>
              <ul>
                {state.response.content.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {state.response.content.limitations && (
            <p className="muted">{state.response.content.limitations}</p>
          )}
          <p className="ai-caption">
            服务：{state.response.provider.providerId}，返回模型：
            {state.response.provider.returnedModel}。AI文字不改变实际执行与学习判定。
          </p>
        </div>
      )}
    </section>
  );
}
