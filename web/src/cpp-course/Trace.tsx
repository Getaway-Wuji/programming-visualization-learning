import { useEffect, useMemo, useState } from 'react';
import { AdvancedPlayer } from '../engine/advanced-player';
import type { AdvancedResult, AdvancedValue } from '../engine/advanced-protocol';
import { cppSourcePositions } from './source';

function show(value: AdvancedValue) {
  if (value === null) return '未初始化';
  if (typeof value !== 'object') return String(value);
  return value.objectId ? `${value.objectId} + ${value.byteOffset} B` : 'nullptr';
}

export function CppTrace({
  packet,
  source,
  cursor,
  seek,
  playbackRate,
}: {
  packet: AdvancedResult;
  source: string;
  cursor: number;
  seek: (cursor: number) => void;
  playbackRate: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [stopLine, setStopLine] = useState('');
  const [showReleased, setShowReleased] = useState(false);
  const player = useMemo(() => {
    const value = new AdvancedPlayer();
    value.accept(packet);
    return value;
  }, [packet]);
  const positions = useMemo(() => cppSourcePositions(source), [source]);
  const lines = useMemo(() => source.split(/\r\n|\n|\r/u), [source]);
  const byNode = useMemo(
    () => new Map(packet.nodeMap.map((node) => [node.nodeId, node.byteRange])),
    [packet],
  );
  const readLine = (at: number) => {
    const step = packet.trace?.steps[at - 1];
    const range = step && byNode.get(step.nodeId);
    return range ? (positions.get(range.start)?.line ?? null) : null;
  };
  player.seek(cursor);
  const view = player.snapshot();
  const current = view.state;
  const line = readLine(cursor);
  const limit = view.length;
  const nextLine = readLine(cursor + 1);
  useEffect(() => {
    if (!playing || cursor >= limit) return;
    const timer = setTimeout(
      () => {
        seek(cursor + 1);
        if (nextLine && nextLine !== line && nextLine === Number(stopLine)) setPlaying(false);
      },
      Math.round(500 / playbackRate),
    );
    return () => clearTimeout(timer);
  }, [playing, cursor, limit, line, nextLine, stopLine, seek, playbackRate]);
  const move = (at: number) => {
    setPlaying(false);
    seek(at);
  };
  const objects = current?.objects.filter((object) => object.alive || showReleased) ?? [];
  const aliases =
    current?.scopes.flatMap((scope) =>
      scope.aliases.map((alias) => ({ ...alias, scope: scope.id })),
    ) ?? [];
  return (
    <section
      className="cpp-sheet"
      aria-label="C++ 真实执行轨迹"
      data-testid="cpp-trace"
      data-cursor={cursor}
    >
      <div className="cpp-title">
        <h2>执行轨迹</h2>
        <span className="cpp-muted">
          步骤 {cursor} / {limit}
        </span>
      </div>
      {current ? (
        <>
          <div className="python-actions cpp-actions">
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
          <div className="cpp-trace-position">
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
            <p className="cpp-active-line">
              第 {line} 行 <code>{lines[line - 1]?.trim()}</code>
            </p>
          )}
          <div className="cpp-trace-grid">
            <div>
              <h3>当前输出</h3>
              <pre data-testid="cpp-output">{current.output || '暂无输出'}</pre>
            </div>
            <div>
              <h3>调用帧</h3>
              {current.frames.length ? (
                <ol>
                  {current.frames.map((frame) => (
                    <li key={frame.id}>
                      {frame.functionName} <code>{frame.id}</code>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cpp-muted">当前没有活动调用帧。</p>
              )}
            </div>
          </div>
          <h3>虚拟对象与变量</h3>
          <label className="cpp-muted">
            <input
              type="checkbox"
              checked={showReleased}
              onChange={(event) => setShowReleased(event.target.checked)}
            />{' '}
            显示已结束生命周期的对象
          </label>
          {objects.length ? (
            <div className="cpp-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>类型</th>
                    <th>教学地址</th>
                    <th>当前值</th>
                  </tr>
                </thead>
                <tbody>
                  {objects.slice(0, 24).map((object) => (
                    <tr key={object.id}>
                      <td>
                        {object.name || object.id}
                        {object.alive ? '' : '（已结束）'}
                      </td>
                      <td>
                        {object.typeName}
                        {object.length > 1 ? `[${object.length}]` : ''}
                      </td>
                      <td>{object.baseAddress}</td>
                      <td>
                        {object.cells.length
                          ? object.cells
                              .map((cell) => `${cell.byteOffset} B · ${show(cell.value)}`)
                              .join('，')
                          : object.zeroInitialized
                            ? '默认零值'
                            : '暂无写入'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="cpp-muted">当前没有可显示的对象。</p>
          )}
          {objects.length > 24 && (
            <p className="cpp-muted">显示 24 / {objects.length} 个对象。可导出完整步骤状态。</p>
          )}
          {aliases.length > 0 && (
            <p>
              当前别名 {aliases.map(({ name, objectId }) => `${name} → ${objectId}`).join('，')}
            </p>
          )}
        </>
      ) : (
        <p className="cpp-muted">程序在进入执行前结束，暂无轨迹。</p>
      )}
    </section>
  );
}
