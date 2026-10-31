import type { PlayerController } from '../player/controller';

const statusLabels = {
  idle: '等待运行轨迹',
  loading: '正在等待执行结果',
  ready: '已回到初始状态',
  playing: '正在播放',
  paused: '已暂停',
  ended: '播放结束',
  failed: '已到达运行停止位置',
};

export function PlayerControls({
  controller,
  snapshot,
  showDetail = false,
}: {
  controller: PlayerController;
  snapshot: ReturnType<PlayerController['getSnapshot']>;
  showDetail?: boolean;
}) {
  const { view, rate } = snapshot;
  const available = view.cursor !== null && view.length > 0;
  const canForward = available && view.cursor! < view.length;
  return (
    <div
      className="player-controls"
      data-testid="player-controls"
      data-player-status={view.status}
      data-cursor={view.cursor ?? ''}
      data-length={view.length}
      aria-label="播放控制"
    >
      <div className="control-group">
        <button
          className="button button-small"
          onClick={() => controller.step(-1)}
          disabled={!available || view.cursor === 0}
          aria-keyshortcuts="ArrowLeft"
        >
          后退
        </button>
        <button
          className="button button-primary button-small"
          onClick={() => controller.toggle()}
          disabled={!canForward}
          aria-keyshortcuts="Space"
        >
          {view.status === 'playing' ? '暂停' : '播放'}
        </button>
        <button
          className="button button-small"
          onClick={() => controller.step(1)}
          disabled={!canForward}
          aria-keyshortcuts="ArrowRight"
        >
          前进
        </button>
        <button
          className="button button-small"
          onClick={() => controller.replay()}
          disabled={!available}
        >
          重播
        </button>
      </div>
      <label className="muted">
        速度{' '}
        <select
          aria-label="播放速度"
          disabled={!available}
          value={rate}
          onChange={(event) => controller.setRate(Number(event.target.value))}
        >
          {[0.25, 0.5, 1, 1.5, 2, 4].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </label>
      {showDetail && (
        <label className="muted">
          显示{' '}
          <select
            aria-label="步骤显示"
            value={snapshot.detail}
            disabled={snapshot.detailLocked}
            onChange={(event) => controller.setDetail(event.target.value as 'key' | 'all')}
          >
            <option value="key">关键步骤</option>
            <option value="all">全部步骤</option>
          </select>
        </label>
      )}
      <div className="player-progress">
        <span data-testid="player-cursor">
          {showDetail && snapshot.detail === 'key'
            ? `关键步骤 ${snapshot.keyPosition} / ${snapshot.keyLength}`
            : `步骤 ${view.cursor ?? '—'} / ${view.length}`}
        </span>
        <span role="status">{statusLabels[view.status]}</span>
      </div>
      <p className="player-help muted">
        聚焦播放工作区后，空格播放或暂停，左右方向键单步查看。重播从初始状态开始播放。
      </p>
    </div>
  );
}
