import { useEffect, useMemo, useState } from 'react';
import { JavaPlayer } from '../engine/java-player';
import { javaPositions } from '../engine/java-protocol';
import type { JavaPacket, JavaResponse, JavaValue } from '../engine/java-types';

export function javaValue(value: JavaValue) {
  switch (value.kind) {
    case 'null':
      return 'null';
    case 'bool':
    case 'int':
    case 'long':
      return String(value.value);
    case 'string':
      return JSON.stringify(value.value);
    case 'ref':
      return '对象 #' + value.objectId;
  }
}

const terminalLabels = {
  completed: '执行完成',
  error: '程序报错',
  limited: '到达执行限额',
  cancelled: '已取消',
};

export function TraceView({
  packet,
  response,
  source,
  cursor,
  seek,
  playingAllowed,
  playbackRate,
}: {
  packet: JavaPacket;
  response: JavaResponse;
  source: string;
  cursor: number;
  seek: (cursor: number) => void;
  playingAllowed: boolean;
  playbackRate: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [objectLimit, setObjectLimit] = useState(12);
  const trace = packet.trace;
  const player = useMemo(() => (trace ? new JavaPlayer(trace) : null), [trace]);
  const positions = useMemo(() => javaPositions(source), [source]);
  const current = player?.seek(cursor).state;
  const max = trace?.steps.length ?? 0;
  const objects = current ? Object.entries(current.objects) : [];
  const next = trace?.steps[cursor - 1];
  const activeId = next?.nodeId ?? current?.control.nodeId;
  const sourceNode = response.nodeMap.find((row) => row.nodeId === activeId);
  const start = sourceNode && positions.get(sourceNode.byteRange.start);
  const end = sourceNode && positions.get(sourceNode.byteRange.end);
  const fault = packet.terminal.diagnostic;
  const faultPosition = fault && positions.get(fault.byteRange.start);
  useEffect(() => {
    if (!playing || !playingAllowed || cursor >= max) return;
    const timer = setTimeout(
      () => {
        const step = trace?.steps[cursor];
        const node = response.nodeMap.find((item) => item.nodeId === step?.nodeId);
        const line = node && positions.get(node.byteRange.start)?.line;
        if (line && line !== start?.line && breakpoints.includes(line)) setPlaying(false);
        seek(cursor + 1);
      },
      Math.round(550 / playbackRate),
    );
    return () => clearTimeout(timer);
  }, [
    playing,
    playingAllowed,
    cursor,
    max,
    playbackRate,
    seek,
    trace,
    response,
    positions,
    start?.line,
    breakpoints,
  ]);
  return (
    <section
      className="python-sheet java-trace"
      aria-label="真实执行轨迹"
      data-testid="java-trace"
      data-cursor={cursor}
    >
      <header>
        <h2>执行轨迹</h2>
        <p role="status">
          {terminalLabels[packet.terminal.status]}
          {fault ? ' · ' + fault.code : ''}
        </p>
      </header>
      {faultPosition && (
        <p>
          诊断位置为第 {faultPosition.line} 行、第 {faultPosition.column} 列。
        </p>
      )}
      {trace && current && (
        <>
          <div className="python-actions" aria-label="轨迹控制">
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                seek(0);
              }}
              disabled={cursor === 0}
            >
              回到开头
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                seek(cursor - 1);
              }}
              disabled={cursor === 0}
            >
              上一步
            </button>
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              disabled={!playingAllowed || cursor === max}
            >
              {playing && cursor < max ? '暂停' : '播放'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                seek(cursor + 1);
              }}
              disabled={cursor === max}
            >
              下一步
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                seek(max);
              }}
              disabled={cursor === max}
            >
              到最后一步
            </button>
          </div>
          <label className="python-step">
            第 {cursor} / {max} 步
            <input
              aria-label="执行步数"
              type="range"
              min={0}
              max={max}
              value={cursor}
              onChange={(event) => {
                setPlaying(false);
                seek(Number(event.target.value));
              }}
            />
          </label>
          {breakpoints.length > 0 && <p>断点 {breakpoints.join('、')} 行</p>}
          {start && (
            <button
              type="button"
              aria-pressed={breakpoints.includes(start.line)}
              onClick={() =>
                setBreakpoints((current) =>
                  current.includes(start.line)
                    ? current.filter((line) => line !== start.line)
                    : [...current, start.line].sort((a, b) => a - b),
                )
              }
            >
              {breakpoints.includes(start.line) ? '移除本行断点' : '设为断点'}
            </button>
          )}
          {start && end && (
            <p>
              第 {start.line} 行{' '}
              <code className="python-source-mark">
                {source.slice(start.utf16Offset, end.utf16Offset).trim()}
              </code>
            </p>
          )}
          <div className="python-trace-columns">
            <div>
              <h3>输出</h3>
              <pre data-testid="java-output">{current.output || '（当前无输出）'}</pre>
              <p>输入已读取 {current.control.inputCursor} 字节</p>
            </div>
            <div>
              <h3>变量与对象</h3>
              {!current.frames.length && <p>当前没有活动调用帧。</p>}
              {current.frames.map((frame) => (
                <details key={frame.id} open>
                  <summary>调用帧 #{frame.id}</summary>
                  <dl className="python-state-values">
                    {Object.entries(frame.bindings).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{javaValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
              <p>虚拟内存 {current.allocator.liveBytes} 字节</p>
              {objects.slice(0, objectLimit).map(([key, object]) => (
                <details key={key} open={objects.length <= 8}>
                  <summary>
                    {object.kind === 'instance'
                      ? object.className
                      : object.kind === 'scanner'
                        ? 'Scanner'
                        : '数组'}{' '}
                    #{Number(key.slice(1))}
                  </summary>
                  {object.kind === 'instance' ? (
                    <dl className="python-state-values">
                      {Object.entries(object.fields).map(([name, value]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd>{javaValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : object.kind === 'scanner' ? (
                    <p>虚拟标准输入</p>
                  ) : (
                    <code>[{object.slots.map(javaValue).join(', ')}]</code>
                  )}
                </details>
              ))}
              {objects.length > objectLimit && (
                <button type="button" onClick={() => setObjectLimit((limit) => limit + 12)}>
                  显示更多对象（{objectLimit} / {objects.length}）
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
