import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useAi } from './react';
import { messages, providers } from './protocol';
import './ai-debug.css';

export function AiSettings() {
  const { session, state } = useAi();
  const keyInput = useRef<HTMLInputElement>(null);
  const selected = providers.find((p) => p.id === state.provider?.providerId);
  useEffect(() => {
    const clearInput = () => {
      if (keyInput.current) keyInput.current.value = '';
    };
    const clearWhenDiscarded = () => {
      if (!session.getSnapshot().hasApiKey) clearInput();
    };
    clearWhenDiscarded();
    const unsubscribe = session.subscribe(clearWhenDiscarded);
    window.addEventListener('pagehide', clearInput);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', clearInput);
      clearInput();
    };
  }, [session]);
  const busy = state.state === 'checking';
  const supported = session.supported();
  return (
    <section className="ai-settings" aria-labelledby="ai-settings-title" data-ui="ai-settings">
      {!supported && (
        <p role="alert" className="notice">
          {messages.E_AI_UNSUPPORTED_ORIGIN}{' '}
          请使用原有HTTPS地址或本机回环入口，勿在当前地址填写Key。
        </p>
      )}
      <div className="ai-heading">
        <div>
          <h2 id="ai-settings-title">AI解释（可选）</h2>
          <p>默认关闭。只在当前标签页临时启用，刷新或退出工作台后关闭；正常学习无需开启。</p>
        </div>
        <span role="status">{state.enabled ? '已开启' : busy ? '正在验证' : '未开启'}</span>
      </div>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void session.verify().then(() => {
            if (session.getSnapshot().enabled && keyInput.current) keyInput.current.value = '';
          });
        }}
      >
        <label className="settings-field">
          <span>AI服务</span>
          <select
            aria-label="AI服务"
            value={state.provider?.providerId ?? ''}
            disabled={busy}
            onChange={(e) => {
              const provider = providers.find((p) => p.id === e.target.value);
              session.choose(provider ? { providerId: provider.id, model: '' } : null);
              if (keyInput.current) keyInput.current.value = '';
            }}
          >
            <option value="">请选择服务</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} 官方API
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>模型</span>
          <select
            aria-label="AI模型"
            value={state.provider?.model ?? ''}
            disabled={!selected || busy}
            onChange={(e) => {
              session.choose(selected ? { providerId: selected.id, model: e.target.value } : null);
              if (keyInput.current) keyInput.current.value = '';
            }}
          >
            <option value="">请选择模型</option>
            {selected && <option value={selected.model}>{selected.model}</option>}
          </select>
        </label>
        <label className="settings-field">
          <span>你自己的API Key</span>
          <input
            ref={keyInput}
            type="password"
            aria-label="你自己的API Key"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={4096}
            disabled={busy || !supported}
            onChange={(e) => session.setKey(e.currentTarget.value)}
          />
        </label>
        {state.enabled && (
          <p className="ai-status">
            Key已在本标签页临时配置，输入框已清空。更改任何配置都需重新验证。
          </p>
        )}
        <p id="ai-verify-disclosure">
          验证会经本平台同源转发，把Key发送到
          {selected ? ` ${selected.host} 的模型列表接口` : '你选择的官方服务'}
          ，不发送代码，也不调用推理。平台转发方会接触当次Key；Key不会保存到学习档案。
        </p>
        {selected && (
          <div className="ai-policy">
            <p>{selected.retention}</p>
            <p>
              解释请求的费用由Key账户承担；取消本端等待不保证服务方停止或免收费。验证通过不保证推理权限或额度。
            </p>
            <a href={selected.pricing} target="_blank" rel="noreferrer">
              {selected.label}官方价格
            </a>
            {' · '}
            <a href={selected.policy} target="_blank" rel="noreferrer">
              数据与保留政策
            </a>
          </div>
        )}
        <div className="inline-actions">
          <button
            type={state.enabled ? 'button' : 'submit'}
            role="switch"
            aria-checked={state.enabled}
            aria-describedby="ai-verify-disclosure"
            className="button button-primary"
            disabled={busy || !supported}
            onClick={state.enabled ? () => session.clear() : undefined}
          >
            {busy ? '正在验证……' : state.enabled ? '关闭AI解释' : '验证并开启AI解释'}
          </button>
          <button type="button" className="button button-secondary" onClick={() => session.clear()}>
            {state.enabled ? '关闭并清除AI配置' : busy ? '取消验证并清除' : '清除AI配置'}
          </button>
        </div>
      </form>
      {state.code && (
        <p role="alert" className="notice">
          {messages[state.code]}
        </p>
      )}
      <p className="muted">
        关闭、刷新、离开工作台或清除学习数据会丢弃Key。每次发送代码前另行预览确认；此处不会自动请求解释。
      </p>
      {state.enabled && (
        <Link className="text-link" to="/custom-code">
          前往C代码工作台
        </Link>
      )}
    </section>
  );
}
