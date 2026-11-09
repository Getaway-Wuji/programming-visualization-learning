import { useEffect, useState } from 'react';
import type { MysqlRange, MysqlResponse } from '../engine/mysql-types';
import { mysqlSourcePositions } from './source';
const eventNames: Record<string, string> = {
  statement: '开始语句',
  scan: '读取记录',
  filter: '判断条件',
  join: '连接记录',
  group: '分组聚合',
  project: '生成结果列',
  distinct: '去除重复',
  order: '排序',
  limit: '截取结果',
  insert: '提交插入',
  update: '提交更新',
  delete: '提交删除',
  create: '创建表',
  drop: '删除表',
  truncate: '清空表',
  begin: '开启事务',
  commit: '提交事务',
  rollback: '回滚事务',
  done: '完成查询',
};

export function MysqlTrace({
  response,
  source,
  cursor,
  seek,
  locate,
  playbackRate,
  exporting,
}: {
  response: MysqlResponse;
  source: string;
  cursor: number;
  seek: (cursor: number) => void;
  locate: (range: MysqlRange) => void;
  playbackRate: number;
  exporting: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(playbackRate);
  const replay = response.replay!;
  const length = replay.trace.steps.length;
  useEffect(() => {
    if (!playing || cursor >= length || document.hidden || exporting) return;
    const timer = setTimeout(() => seek(cursor + 1), Math.round(500 / rate));
    return () => clearTimeout(timer);
  }, [playing, cursor, length, rate, seek, exporting]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  const move = (next: number) => {
    setPlaying(false);
    seek(next);
  };
  const step = replay.trace.steps[cursor - 1];
  const node = response.nodeMap.find((node) => node.id === step?.nodeId);
  const position = node && mysqlSourcePositions(source).get(node.byteRange.start);
  return (
    <section
      className="mysql-sheet"
      aria-label="MySQL 真实执行轨迹"
      data-testid="mysql-trace"
      data-cursor={cursor}
      data-length={length}
    >
      <div className="mysql-title">
        <h2>执行回放</h2>
        <span>
          步骤 {cursor} / {length}
          {replay.trace.completeness === 'prefix' ? ' · 已接纳的执行前缀' : ''}
        </span>
      </div>
      <div className="mysql-actions">
        <button disabled={cursor === 0} onClick={() => move(0)}>
          回到开头
        </button>
        <button disabled={cursor === 0} onClick={() => move(cursor - 1)}>
          上一步
        </button>
        <button disabled={cursor === length} onClick={() => setPlaying(!playing)}>
          {playing && cursor < length ? '暂停' : '播放'}
        </button>
        <button disabled={cursor === length} onClick={() => move(cursor + 1)}>
          下一步
        </button>
        <button disabled={cursor === length} onClick={() => move(length)}>
          回到当前数据库
        </button>
      </div>
      <div className="mysql-trace-position">
        <label>
          轨迹位置
          <input
            aria-label="轨迹位置"
            type="range"
            min={0}
            max={length}
            value={cursor}
            onChange={(event) => move(Number(event.target.value))}
          />
        </label>
        <label>
          播放速度
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
      </div>
      {node && position && (
        <p className="mysql-active-line">
          <button onClick={() => locate(node.byteRange)}>
            定位第 {position.line} 行，第 {position.column} 列
          </button>{' '}
          <code>
            {source
              .slice(
                position.utf16Offset,
                mysqlSourcePositions(source).get(node.byteRange.end)?.utf16Offset,
              )
              .trim()}
          </code>{' '}
          · {eventNames[step.event] ?? step.event}
        </p>
      )}
      {cursor < length && (
        <p className="mysql-muted">表格与结果均对应所选步骤。继续运行前，请回到当前数据库。</p>
      )}
    </section>
  );
}
