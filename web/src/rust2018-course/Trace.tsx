import { useEffect, useMemo, useState } from 'react';
import { Rust2018Player } from '../engine/rust2018-player';
import type { RustResponse, RustValue } from '../engine/rust2018-protocol';
import { rustSourcePositions } from './source';

export function showRustValue(value: RustValue) {
  if (value.kind === 'unit') return '()';
  if (value.kind === 'i32' || value.kind === 'bool') return String(value.value);
  if (value.kind === 'reference') return `借用 #${value.loanId}`;
  return `对象 #${value.objectId}`;
}

export function RustTrace({
  response,
  source,
  cursor,
  seek,
  playbackRate,
}: {
  response: RustResponse;
  source: string;
  cursor: number;
  seek: (cursor: number) => void;
  playbackRate: number;
}) {
  const packet = response.replay!;
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(playbackRate);
  const [stopLine, setStopLine] = useState('');
  const [showReleased, setShowReleased] = useState(false);
  const player = useMemo(() => new Rust2018Player(packet), [packet]);
  const positions = useMemo(() => rustSourcePositions(source), [source]);
  const lines = useMemo(() => source.split(/\r\n|\n|\r/u), [source]);
  const nodes = useMemo(() => new Map(response.nodeMap.map((node) => [node.id, node])), [response]);
  const readLine = (at: number) => {
    const step = packet.trace.steps[at - 1];
    const node = step && nodes.get(step.nodeId);
    return node ? (positions.get(node.byteRange.start)?.line ?? null) : null;
  };
  const current = player.seek(cursor);
  const line = readLine(cursor);
  const limit = player.length;
  const nextLine = readLine(cursor + 1);
  const step = packet.trace.steps[cursor - 1];
  useEffect(() => {
    if (!playing || cursor >= limit) return;
    const timer = setTimeout(
      () => {
        seek(cursor + 1);
        if (nextLine && nextLine !== line && nextLine === Number(stopLine)) setPlaying(false);
      },
      Math.round(500 / rate),
    );
    return () => clearTimeout(timer);
  }, [playing, cursor, limit, line, nextLine, stopLine, seek, rate]);
  const move = (at: number) => {
    setPlaying(false);
    seek(at);
  };
  const objects = current.objects.filter((object) => object.alive || showReleased);
  const bindingName = (id: number) => {
    const binding = current.bindings.find((row) => row.id === id);
    return binding ? `${binding.name} (#${id})` : `绑定 #${id}`;
  };
  const functionName = (id: number) => {
    const node = nodes.get(id);
    if (!node) return `函数 #${id}`;
    const offset = positions.get(node.byteRange.start)?.utf16Offset ?? 0;
    return /^fn\s+([A-Za-z_]\w*)/u.exec(source.slice(offset))?.[1] ?? `函数 #${id}`;
  };
  return (
    <section
      className="rust-sheet"
      aria-label="Rust 真实执行轨迹"
      data-testid="rust-trace"
      data-cursor={cursor}
    >
      <div className="rust-title">
        <h2>执行轨迹</h2>
        <span className="rust-muted">
          步骤 {cursor} / {limit}
        </span>
      </div>
      <div className="python-actions rust-actions">
        <button onClick={() => move(0)} disabled={cursor === 0}>
          回到开头
        </button>
        <button onClick={() => move(cursor - 1)} disabled={cursor === 0}>
          上一步
        </button>
        <button onClick={() => setPlaying(!playing)} disabled={cursor === limit}>
          {playing && cursor < limit ? '暂停' : '播放'}
        </button>
        <button onClick={() => move(cursor + 1)} disabled={cursor === limit}>
          下一步
        </button>
        <button onClick={() => move(limit)} disabled={cursor === limit}>
          到最后一步
        </button>
      </div>
      <div className="rust-trace-position">
        <label>
          轨迹位置{' '}
          <input
            aria-label="轨迹位置"
            type="range"
            min={0}
            max={limit}
            value={cursor}
            onChange={(event) => move(Number(event.target.value))}
          />
        </label>
        <label>
          播放速度{' '}
          <select
            aria-label="播放速度"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
          >
            {[0.25, 0.5, 1, 1.5, 2, 4].map((value) => (
              <option key={value} value={value}>
                {value} 倍
              </option>
            ))}
          </select>
        </label>
        <label>
          断点行{' '}
          <input
            aria-label="断点行"
            type="number"
            min={1}
            max={lines.length}
            value={stopLine}
            onChange={(event) => setStopLine(event.target.value)}
          />
        </label>
      </div>
      {line && (
        <p className="rust-active-line">
          第 {line} 行 <code>{lines[line - 1]?.trim()}</code>
          {step && <span> · {step.event}</span>}
        </p>
      )}
      <div className="rust-trace-grid">
        <div>
          <h3>当前输出</h3>
          <pre data-testid="rust-output">{current.output || '暂无输出'}</pre>
        </div>
        <div>
          <h3>函数调用栈</h3>
          {current.frames.length ? (
            <ol>
              {current.frames.map((frame) => (
                <li key={frame.id}>
                  <code>{functionName(frame.functionNode)}</code> · 帧 #{frame.id} · 作用域{' '}
                  {frame.scopeIds.join('、')}
                </li>
              ))}
            </ol>
          ) : (
            <p className="rust-muted">当前没有活动调用帧。</p>
          )}
        </div>
      </div>
      <h3>变量绑定与移动</h3>
      {current.bindings.length ? (
        <div className="rust-table-wrap">
          <table>
            <thead>
              <tr>
                <th>变量</th>
                <th>类型</th>
                <th>帧 / 作用域</th>
                <th>当前值</th>
                <th>所有权状态</th>
              </tr>
            </thead>
            <tbody>
              {current.bindings.map((binding) => (
                <tr key={binding.id}>
                  <td>
                    {binding.name} (#{binding.id})
                  </td>
                  <td>
                    <code>
                      {binding.mutable ? 'mut ' : ''}
                      {binding.type}
                    </code>
                  </td>
                  <td>
                    {binding.frameId} / {binding.scopeId}
                  </td>
                  <td>{showRustValue(binding.value)}</td>
                  <td>{binding.status === 'moved' ? '已移动，不能再读取' : '有效'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rust-muted">当前没有活动变量。</p>
      )}
      <h3>String 与数组对象</h3>
      <label className="rust-muted">
        <input
          type="checkbox"
          checked={showReleased}
          onChange={(event) => setShowReleased(event.target.checked)}
        />{' '}
        显示已结束生命周期的对象
      </label>
      {objects.length ? (
        <div className="rust-table-wrap">
          <table>
            <thead>
              <tr>
                <th>对象</th>
                <th>类型</th>
                <th>拥有者</th>
                <th>当前内容</th>
              </tr>
            </thead>
            <tbody>
              {objects.slice(0, 24).map((object) => (
                <tr key={object.id}>
                  <td>
                    #{object.id}
                    {object.alive ? '' : '（已释放）'}
                  </td>
                  <td>{object.kind === 'string' ? 'String' : 'i32 数组'}</td>
                  <td>
                    {current.bindings
                      .filter(
                        (binding) =>
                          binding.status === 'live' &&
                          'objectId' in binding.value &&
                          binding.value.objectId === object.id,
                      )
                      .map((binding) => bindingName(binding.id))
                      .join('、') ||
                      (current.temporaries.some(
                        (item) => 'objectId' in item.value && item.value.objectId === object.id,
                      )
                        ? '临时值'
                        : '无')}
                  </td>
                  <td>
                    <code>
                      {object.kind === 'string'
                        ? JSON.stringify(object.text)
                        : JSON.stringify(object.items)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rust-muted">当前没有可显示的对象。</p>
      )}
      {objects.length > 24 && (
        <p className="rust-muted">显示 24 / {objects.length} 个对象。可导出完整步骤状态。</p>
      )}
      <h3>活动借用</h3>
      {current.loans.length ? (
        <ul>
          {current.loans.map((loan) => (
            <li key={loan.id}>
              借用 #{loan.id} · {bindingName(loan.parameterBindingId)} →{' '}
              {bindingName(loan.targetBindingId)} ·{' '}
              {loan.mutable ? '可变借用，目标暂不能直接读写' : '共享借用，目标暂不能写入'}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rust-muted">当前没有活动借用。</p>
      )}
      {current.temporaries.length > 0 && (
        <p>
          临时拥有值：
          {current.temporaries.map((item) => `#${item.id} ${showRustValue(item.value)}`).join('，')}
        </p>
      )}
      <p className="rust-muted">
        已读输入 {current.control.inputCursor} 字节 · 活动对象 {current.allocator.liveBytes} 字节
        {current.control.returnValue && ` · 返回值 ${showRustValue(current.control.returnValue)}`}
      </p>
    </section>
  );
}
