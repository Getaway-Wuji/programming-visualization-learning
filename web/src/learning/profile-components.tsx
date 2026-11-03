import { Link } from 'react-router';
import type { Avatar } from '../storage/model';
import type { LearningServiceState } from './service';
import { projectLearning, projectC6Learning } from './domain';
import { deriveLearningLevel, type ProfileConfiguration } from './profile';
import { useLearning } from './react';
import './profile.css';
import { reviewedDurableSnapshot } from './reviewed-release';

const defaultDescriptor = { presetId: 'avatar.basic.01', label: '嫩叶', shapeId: 'leaf' as const };

export function AvatarPicture({
  avatar,
  configuration,
  testId,
  label,
}: {
  avatar: Avatar;
  configuration: ProfileConfiguration | null | undefined;
  testId?: string;
  label?: string;
}) {
  const descriptor =
    configuration?.avatars.find((item) => item.presetId === avatar.presetId) ??
    (avatar.presetId === defaultDescriptor.presetId ? defaultDescriptor : null);
  const color = /^#[0-9A-Fa-f]{6}$/.test(avatar.accentColor) ? avatar.accentColor : '#168A72';
  return (
    <div
      className={`profile-avatar${descriptor ? '' : ' profile-avatar-unavailable'}`}
      role="img"
      aria-label={
        label ?? (descriptor ? `已保存形象：${descriptor.label}` : '已保存形象资源暂不可用')
      }
      data-testid={testId}
      data-avatar-preset={avatar.presetId}
      data-avatar-color={avatar.accentColor}
      data-avatar-state={descriptor ? 'available' : 'unavailable'}
    >
      {descriptor ? (
        <svg
          viewBox="0 0 24 24"
          fill={color}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {descriptor.shapeId === 'leaf' && (
            <>
              <path d="M19 3C6 3 3 8 5 15c2 6 12 4 14-12Z" />
              <path d="M5 20 15 9" fill="none" />
            </>
          )}
          {descriptor.shapeId === 'sprout' && (
            <>
              <path d="M12 13C4 13 3 8 3 5c7-1 10 2 9 8Zm0-3c0-5 3-7 9-7 1 6-3 10-9 10Z" />
              <path d="M12 10v11m-5 0h10" fill="none" />
            </>
          )}
          {descriptor.shapeId === 'block' && (
            <>
              <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
              <path d="m3 7 9 5 9-5M12 12v10m-5-9 2 1m6 1 2-1" fill="none" />
            </>
          )}
          {descriptor.shapeId === 'star' && (
            <path d="m12 2 3 6.2 6.8 1-4.9 4.8 1.2 6.8-6.1-3.2-6.1 3.2L7.1 14 2.2 9.2 9 8.2Z" />
          )}
        </svg>
      ) : (
        <span>
          形象资源
          <br />
          暂不可用
        </span>
      )}
    </div>
  );
}

/** The home never promotes pending in-memory learning into saved course progress. */
export function savedCourseProjection(state: LearningServiceState) {
  if (!state.snapshot) return null;
  if (state.c6?.index) return projectC6Learning(state.snapshot, state.c6.index);
  const catalog = state.practiceCatalog ??
    state.reading?.catalog ?? {
      purpose: 'contract-fixture' as const,
      packageRef: state.snapshot.meta.activePackageRef,
      lessons: [],
      exercises: [],
      cases: [],
    };
  return projectLearning(
    state.snapshot,
    catalog,
    reviewedDurableSnapshot(state.snapshot, catalog).progress,
  );
}

export function ProfileSummary() {
  const { state, service } = useLearning();
  const snapshot = state.snapshot;
  const pointsConfirmed = !!snapshot && !state.recovery?.ledgerUncertain;
  const points = pointsConfirmed
    ? snapshot.ledger
        .reduce((sum, entry) => sum + (entry.status === 'posted' ? BigInt(entry.points) : 0n), 0n)
        .toString()
    : null;
  const level =
    points !== null && state.profileStatus === 'ready' && state.profileConfiguration
      ? deriveLearningLevel(points, state.profileConfiguration)
      : null;
  return (
    <div className="profile-summary" data-testid="learning-profile">
      <div className="profile-identity">
        {snapshot ? (
          <AvatarPicture
            avatar={snapshot.avatar}
            configuration={state.profileConfiguration}
            testId="learning-avatar"
          />
        ) : (
          <div className="profile-avatar profile-avatar-unavailable">正在读取</div>
        )}
        <div className="profile-identity-copy">
          <p className="profile-level" data-testid="learning-level" data-level={level?.level ?? ''}>
            {level
              ? `Lv.${level.level} · ${level.title}`
              : !pointsConfirmed
                ? '等级暂不可确认'
                : state.profileStatus === 'failed'
                  ? '等级规则暂不可用'
                  : '正在读取等级'}
          </p>
          <Link className="text-link" to="/settings?panel=avatar">
            调整基础形象
          </Link>
        </div>
      </div>
      {level && (
        <div className="profile-level-progress" data-testid="learning-level-progress">
          <progress max="100" value={level.progressPercent} aria-label="等级进度" />
          <p>
            {level.nextThreshold
              ? `距离 Lv.${level.level + 1} 还需 ${level.remainingPoints} 分`
              : '已达到当前最高等级'}
          </p>
          <p className="muted">等级按已入账积分展示学习积累，待入账奖励不计入。</p>
        </div>
      )}
      {state.profileStatus === 'failed' && (
        <button
          type="button"
          className="text-link profile-retry"
          onClick={() => void service.reloadProfileConfiguration()}
        >
          重试形象与等级规则
        </button>
      )}
    </div>
  );
}
