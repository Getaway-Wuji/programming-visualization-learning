import { Link } from 'react-router';
import { Breadcrumbs, PageHeading } from '../components/Ui';
import { Icon } from '../components/Icon';
import { achievementCatalog, c6AchievementCatalog } from './model';
import { useLearning } from '../learning/react';
import { AchievementStatus, useAchievements } from './react';

export default function AchievementsPage() {
  const { state } = useAchievements();
  const { state: learning } = useLearning();
  const catalog = learning.c6 ? c6AchievementCatalog : achievementCatalog;
  const known = ['ready', 'unsaved'].includes(state.status);
  const unlocked = state.rows.filter((r) => r.unlockedAt).length;
  return (
    <div
      className="achievements-page"
      data-page-id="PAGE-ACHIEVEMENTS"
      data-testid="achievements-page"
    >
      <Breadcrumbs items={[{ label: '学习首页', to: '/' }, { label: '学习成就' }]} />
      <PageHeading
        kicker="本地学习记录"
        title="学习成就"
        description="把完成过的学习经历留在这里。每枚徽章都有明确条件，可以随时查看来源。"
      />
      <div className="achievement-overview">
        <strong data-testid="achievement-total">{known ? `${unlocked} / 3` : '待确认'}</strong>
        <span>{known ? '枚徽章已解锁' : '本地成就尚未确认'}</span>
        <p>不增加积分；只保存在当前浏览器，清除本地档案会一起移除。</p>
      </div>
      <AchievementStatus />
      <ol className="achievement-list">
        {catalog.badges.map((badge, i) => {
          const saved = known ? state.rows.find((r) => r.badgeRef.id === badge.id) : undefined;
          return (
            <li
              key={badge.id}
              className="achievement-item"
              data-testid="achievement-item"
              data-badge-id={badge.id}
              data-unlocked={known ? Boolean(saved?.unlockedAt) : 'unknown'}
            >
              <div className="achievement-emblem" aria-hidden="true">
                {saved?.unlockedAt ? <Icon name="check" /> : String(i + 1)}
              </div>
              <div className="achievement-body">
                <div className="achievement-title">
                  <h2>{badge.title}</h2>
                  <span className="achievement-state">
                    {!known
                      ? '待确认'
                      : saved?.unlockedAt
                        ? '已解锁'
                        : `${saved?.evidence.length ?? 0} / ${badge.requirements.length} 项已完成`}
                  </span>
                </div>
                <p>{badge.description}</p>
                <ul className="achievement-requirements">
                  {badge.requirements.map((q) => {
                    const e = saved?.evidence.find((e) => e.subjectRef.id === q.id);
                    return (
                      <li
                        key={q.id}
                        data-testid="achievement-requirement"
                        data-source-id={q.id}
                        data-complete={known ? Boolean(e) : 'unknown'}
                      >
                        <span className="achievement-source-state">
                          {!known ? '待确认' : e ? '已记录' : '待完成'}
                        </span>
                        <Link to={q.to}>{q.label} →</Link>
                        {e && (
                          <time dateTime={e.occurredAt}>
                            {new Date(e.occurredAt).toLocaleDateString('zh-CN')}
                          </time>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {saved?.unlockedAt && (
                  <p className="achievement-date">
                    首次解锁于{' '}
                    <time dateTime={saved.unlockedAt}>
                      {new Date(saved.unlockedAt).toLocaleString('zh-CN')}
                    </time>{' '}
                    · 再次完成不会重复解锁
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="achievement-note">
        通过练习后自动核对真实通过记录。递归观察需在调用栈视图从头逐步看完，再主动确认；直接拖到末步不会完成条件。
      </p>
    </div>
  );
}
