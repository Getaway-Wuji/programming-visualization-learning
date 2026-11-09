import { useCallback } from 'react';
import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { MysqlNav } from './CoursePage';
import { mysqlExercise } from './identities';
import type { MysqlCourseActivity } from '../storage/mysql-course';
const reasons = {
  'wrong-result': '查询结果不符',
  'wrong-database': '表结构或数据不符',
  'goal-unmet': '尚未满足本题学习目标',
  'program-error': 'SQL 执行出错',
};
export default function MysqlReviewPage() {
  const { service, state } = useLearning();
  const enabled = state.snapshot?.meta.dbVersion === 15 && state.recovery?.writable !== false;
  const epoch = state.sessionEpoch;
  const load = useCallback(
    async () => (enabled ? service.readMysqlActivities(epoch) : []),
    [enabled, service, epoch],
  );
  const result = useJavaResource(`${epoch}:${state.snapshot?.meta.revision}`, load);
  const rows: Extract<MysqlCourseActivity, { kind: 'exercise' }>[] = [];
  for (const row of result.value ?? []) {
    if (row.kind === 'exercise') rows.push(row);
  }
  rows.sort((a, b) => b.latestAttempt.at.localeCompare(a.latestAttempt.at));
  return (
    <div className="mysql-screen">
      <MysqlNav />
      <header className="mysql-title">
        <div>
          <h1>MySQL 判题复盘</h1>
          <p>当前浏览器保存的最近提交和首次通过记录。</p>
        </div>
        <Link to="/mysql">返回课程</Link>
      </header>
      <section className="mysql-sheet" aria-label="本地判题记录">
        <h2>最近提交</h2>
        {!enabled ? (
          <p>本地档案暂不可写，可继续阅读和运行 SQL。</p>
        ) : result.failed ? (
          <p role="alert">
            暂时无法读取记录。 <button onClick={result.retry}>重试</button>
          </p>
        ) : !result.value ? (
          <p role="status">正在读取记录…</p>
        ) : rows.length ? (
          <ul className="mysql-reviews">
            {rows.map((row) => (
              <li key={row.subjectRef.id}>
                <div>
                  <Link to={'/mysql/practice/' + row.subjectRef.id}>
                    {mysqlExercise(row.subjectRef.id)?.title ?? row.subjectRef.id}
                  </Link>
                  <p className="mysql-muted">
                    {new Date(row.latestAttempt.at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div>
                  <strong>
                    {row.latestAttempt.status === 'passed' ? '四组均通过' : '尚未通过'}
                  </strong>
                  {row.latestAttempt.reason && <p>{reasons[row.latestAttempt.reason]}</p>}
                  {row.latestAttempt.failedCaseKey && (
                    <p>首个未通过为第 {row.latestAttempt.failedCaseKey.slice(-1)} 组</p>
                  )}
                  {row.firstPass && <p className="mysql-muted">已有首次通过记录</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>还没有判题记录。提交一次练习后可在这里复盘。</p>
        )}
      </section>
    </div>
  );
}
