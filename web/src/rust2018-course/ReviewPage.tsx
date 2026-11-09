import { useCallback } from 'react';
import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { RustNav } from './CoursePage';
import { rustExercise } from './identities';

export default function RustReviewPage() {
  const { service, state } = useLearning();
  const enabled =
    [14, 15].includes(state.snapshot?.meta.dbVersion ?? 0) && state.recovery?.writable !== false;
  const epoch = state.sessionEpoch;
  const load = useCallback(
    async () => (enabled ? (await service.readRustCourse(epoch)).activities : []),
    [service, enabled, epoch],
  );
  const result = useJavaResource(`${epoch}:${state.snapshot?.meta.revision}`, load);
  const rows = (result.value ?? [])
    .filter((row) => row.kind === 'exercise')
    .sort((a, b) => b.latestAttempt.at.localeCompare(a.latestAttempt.at));
  return (
    <div className="python-screen rust-screen">
      <RustNav />
      <header className="rust-title">
        <div>
          <h1>Rust 判题复盘</h1>
          <p>查看当前浏览器保存的最近提交和首次通过记录。</p>
        </div>
        <Link className="button" to="/rust">
          返回课程
        </Link>
      </header>
      <section className="rust-sheet" aria-label="本地判题记录">
        <h2>最近提交</h2>
        {!enabled ? (
          <p>本地档案暂不可写，可继续阅读和运行示例。</p>
        ) : result.failed ? (
          <p role="alert">
            暂时无法读取记录。 <button onClick={result.retry}>重试</button>
          </p>
        ) : !result.value ? (
          <p role="status">正在读取记录…</p>
        ) : rows.length ? (
          <ul className="rust-reviews">
            {rows.map((row) => {
              const attempt = row.latestAttempt;
              const id = row.subjectRef.id;
              return (
                <li key={id}>
                  <div>
                    <Link to={'/rust/practice/' + id}>{rustExercise(id)?.title ?? id}</Link>
                    <p className="rust-muted">{new Date(attempt.at).toLocaleString('zh-CN')}</p>
                  </div>
                  <div>
                    <strong>{attempt.status === 'passed' ? '四组均通过' : '尚未通过'}</strong>
                    {attempt.failedCaseKey && (
                      <p>首个未通过为第 {attempt.failedCaseKey.slice(-1)} 组</p>
                    )}
                    {row.firstPass && <p className="rust-muted">已有首次通过记录</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>还没有判题记录。完成一次练习提交后可在这里复盘。</p>
        )}
      </section>
    </div>
  );
}
