import { useEffect, useMemo, useState } from 'react';
import { PythonPlayer } from '../engine/python3-player';
import { pythonPositions } from '../engine/python3-protocol';
import type { PythonPacket, PythonResponse, PythonValue } from '../engine/python3-types';

export function pythonValue(value: PythonValue) {
  switch (value.kind) {
    case 'none':
      return 'None';
    case 'bool':
      return value.value ? 'True' : 'False';
    case 'str':
      return JSON.stringify(value.value);
    case 'int':
      return String(value.value);
    case 'f64': {
      const bytes = new DataView(new ArrayBuffer(8));
      bytes.setBigUint64(0, BigInt('0x' + value.bits));
      const number = bytes.getFloat64(0);
      return Object.is(number, -0)
        ? '-0.0'
        : Number.isInteger(number)
          ? number.toFixed(1)
          : String(number);
    }
    case 'list-ref':
      return '列表 #' + value.objectId;
    case 'function-ref':
      return '函数 #' + value.nodeId;
    case 'builtin-ref':
      return value.name;
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
  packet: PythonPacket;
  response: PythonResponse;
  source: string;
  cursor: number;
  seek: (cursor: number) => void;
  playingAllowed: boolean;
  playbackRate: number;
}) {
  const [playing, setPlaying] = useState(false);
  const trace = packet.trace;
  const player = useMemo(() => (trace ? new PythonPlayer(trace) : null), [trace]);
  const positions = useMemo(() => pythonPositions(source), [source]);
  const current = player?.seek(cursor).state;
  const max = trace?.steps.length ?? 0;
  const next = trace?.steps[cursor - 1];
  const activeId = next?.nodeId ?? current?.control.nodeId;
  const sourceNode = response.nodeMap.find((row) => row.nodeId === activeId);
  const start = sourceNode && positions.get(sourceNode.byteRange.start);
  const end = sourceNode && positions.get(sourceNode.byteRange.end);
  const fault = packet.terminal.diagnostic;
  const faultPosition = fault && positions.get(fault.byteRange.start);
  useEffect(() => {
    if (!playing || !playingAllowed || cursor >= max) return;
    const timer = setTimeout(() => seek(cursor + 1), Math.round(550 / playbackRate));
    return () => clearTimeout(timer);
  }, [playing, playingAllowed, cursor, max, playbackRate, seek]);
  return (
    <section
      className="python-sheet python-trace"
      aria-label="真实执行轨迹"
      data-testid="python-trace"
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
              <pre data-testid="python-output">{current.output || '（当前无输出）'}</pre>
              <p>输入已读取 {current.control.inputCursor} 字节</p>
            </div>
            <div>
              <h3>变量与对象</h3>
              {Object.keys(current.globals).length ? (
                <dl className="python-state-values">
                  {Object.entries(current.globals).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{pythonValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>当前没有全局变量。</p>
              )}
              {current.frames.map((frame) => (
                <details key={frame.id} open>
                  <summary>调用帧 #{frame.id}</summary>
                  <dl className="python-state-values">
                    {Object.entries(frame.bindings).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{pythonValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
              {Object.entries(current.objects).map(([key, values]) => (
                <p key={key}>
                  列表 #{key.slice(1)} <code>[{values.map(pythonValue).join(', ')}]</code>
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
