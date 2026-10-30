import { Link } from 'react-router';
import { BLOCK_TYPES, BLOCK_LABELS } from './block-kinds';
import { blockLearningLesson, type BlockAccess } from './permissions';
import type { Ref } from '../storage/model';
import { paths } from '../navigation';
import './block-permissions.css';

export function BlockPermissions({ access, packageRef }: { access: BlockAccess; packageRef: Ref }) {
  return (
    <details className="block-permissions" data-testid="block-permissions">
      <summary>
        积木权限：已永久解锁 {access.permanent.length} / {BLOCK_TYPES.length}
        {access.available ? ` · 本节临时开放 ${access.temporary.length} 类` : ' · 当前版本待核对'}
      </summary>
      <p>
        本节所需积木可直接练习。确认学习并通过全部必修题，保存成功后永久解锁；离开本节会收回临时权限。
      </p>
      <ul aria-label="积木学习权限">
        {BLOCK_TYPES.map((kind) => {
          const status = access.permanent.includes(kind)
            ? '已永久解锁'
            : access.temporary.includes(kind)
              ? '本节可用'
              : '未解锁';
          const lesson = blockLearningLesson(packageRef, kind);
          return (
            <li key={kind} data-block-kind={kind} data-access={status}>
              <span>{BLOCK_LABELS[kind]}</span>
              <span>{status}</span>
              {status === '未解锁' && lesson && (
                <Link to={paths.lesson(lesson.lessonRef.id)}>学习：{lesson.title}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
