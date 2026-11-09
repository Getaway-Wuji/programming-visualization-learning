import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { MysqlClient } from '../engine/mysql-client';
import {
  defaultMysqlSession,
  initialMysqlState,
  mysqlEqual,
  mysqlProfile,
} from '../engine/mysql-data';
import { MysqlPlayer } from '../engine/mysql-player';
import type {
  MysqlProfileCase,
  MysqlRange,
  MysqlResponse,
  MysqlSession,
} from '../engine/mysql-types';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import type { MysqlDraft } from '../storage/mysql-course';
import { useUnsavedChanges } from '../workbench/use-unsaved-changes';
import { MysqlLoadState, MysqlNav, MysqlText } from './CoursePage';
import { mysqlExercise, mysqlFreeDocument } from './identities';
import { loadMysqlLesson } from './repository';
import { mysqlSourcePositions } from './source';
import { MysqlDatabaseTables, MysqlResultTable } from './Tables';
import { MysqlTrace } from './Trace';
import './mysql.css';

interface Target {
  id: string;
  title: string;
  source: string;
  session: MysqlSession;
  lesson?: string;
  prompt?: string;
  hints?: string[];
  cases?: MysqlProfileCase[];
  profile?: string;
}
const free: Target = {
  id: mysqlFreeDocument,
  title: 'SQL 工作台',
  source: 'SELECT id, name, score\nFROM students\nORDER BY id;\n',
  session: defaultMysqlSession(),
};
const explanations: Record<string, string> = {
  E_SYNTAX: 'SQL 语法有误，请检查标点和语句结构。',
  E_UNSUPPORTED: '此写法暂不在 MySQL 8.0 教学子集内。可查看支持范围。',
  E_NAME: '字段、表名或别名无法确定，请核对名称。',
  E_TYPE: '数据类型不匹配，本课程不作隐式文本数值转换。',
  E_CONSTRAINT: '数据不符合主键、唯一性或非空约束。',
  E_TABLE_EXISTS: '同名数据表已经存在。',
  E_TABLE_UNKNOWN: '当前数据库没有这张表。',
  E_TRANSACTION: '当前事务状态不允许此操作。',
  E_GROUP: '分组查询中的字段需要符合分组规则。',
  E_OVERFLOW: '计算结果超出了支持的整数范围。',
  E_CANCELLED: '已取消当前操作。',
  E_DEADLINE: '操作超过运行时限，可以缩小 SQL 或数据后重试。',
  S_REVISION_CONFLICT: '另一页面更新了草稿。当前 SQL 和数据库已保留，请核对后再保存。',
  S_GENERATION_STALE: '本地档案已经变化，请重新打开工作台。',
  S_QUOTA: '浏览器存储空间不足。当前 SQL 和数据库已保留，可释放空间后重试。',
};
function friendly(cause: unknown) {
  const code = cause instanceof Error ? cause.message : '';
  return (
    explanations[code] ??
    (code.startsWith('E_') ? '本次操作未完成 · ' + code : code || '本次操作未完成。')
  );
}
const caseReason: Record<string, string> = {
  passed: '通过',
  'wrong-result': '查询结果不符',
  'wrong-database': '数据库不符',
  'goal-unmet': '学习目标未满足',
  'program-error': 'SQL 出错',
  limited: '到达执行限额',
};

function Editor({
  target,
  draft,
  writable,
  epoch,
}: {
  target: Target;
  draft: MysqlDraft | null;
  writable: boolean;
  epoch: number;
}) {
  const { service, state } = useLearning();
  const [engine] = useState(() => new MysqlClient());
  const [source, setSource] = useState(draft?.source ?? target.source);
  const [liveSession, setLiveSession] = useState(draft?.session ?? target.session);
  const [revision, setRevision] = useState(() => crypto.randomUUID());
  const [saved, setSaved] = useState(draft);
  const [response, setResponse] = useState<MysqlResponse | null>(null);
  const [player, setPlayer] = useState<MysqlPlayer | null>(null);
  const [cursor, setCursor] = useState(0);
  const [group, setGroup] = useState(0);
  const [pane, setPane] = useState<'sql' | 'data'>('sql');
  const [busy, setBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    draft ? '已恢复 SQL 和数据库草稿。运行后可查看新的执行结果。' : '',
  );
  const operation = useRef(0),
    position = useRef(0),
    positionRevision = useRef(0),
    mounted = useRef(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty =
    source !== (saved?.source ?? target.source) ||
    !mysqlEqual(liveSession, saved?.session ?? target.session);
  useUnsavedChanges(dirty);
  const abort = useCallback(() => {
    operation.current++;
    engine.invalidate();
  }, [engine]);
  useEffect(() => {
    mounted.current = true;
    const release = service.subscribeSessionInvalidation(() => {
      abort();
      setResponse(null);
      setPlayer(null);
      setBusy('');
      setNotice('');
      setError('');
    });
    return () => {
      mounted.current = false;
      release();
      abort();
    };
  }, [abort, service]);
  const resetResult = () => {
    abort();
    setBusy('');
    setResponse(null);
    setPlayer(null);
    position.current = 0;
    setCursor(0);
    setError('');
    setNotice('');
  };
  const changeSource = (value: string) => {
    resetResult();
    setSource(value);
    setRevision(crypto.randomUUID());
  };
  const seek = useCallback(
    (next: number) => {
      if (!player) return;
      if (position.current !== next) positionRevision.current++;
      player.seek(next);
      position.current = next;
      setCursor(next);
    },
    [player],
  );
  const view = useMemo(
    () => (player ? player.seek(cursor) : initialMysqlState(liveSession)),
    [player, cursor, liveSession],
  );
  const historical = player !== null && cursor < player.length;
  const resetDatabase = (index = group) => {
    resetResult();
    setGroup(index);
    setLiveSession(structuredClone(target.cases?.[index].session ?? target.session));
    setNotice(
      '数据库已恢复到' +
        (target.cases ? `第 ${index + 1} 组初始数据。` : '初始数据。') +
        'SQL 已保留。',
    );
  };

  async function run(mode: 'run' | 'judge', reviewCase = group, persist = true) {
    if (historical) return;
    resetResult();
    const token = operation.current;
    setBusy(mode === 'judge' ? '正在提交判题…' : '正在运行 SQL…');
    try {
      const result =
        mode === 'judge'
          ? await engine.judge(source, target.profile!, reviewCase, revision)
          : await engine.run(source, liveSession, revision);
      if (token !== operation.current) return;
      const nextPlayer = result.replay ? new MysqlPlayer(result.replay) : null;
      if (nextPlayer) {
        const terminal = nextPlayer.seek(nextPlayer.length);
        setLiveSession(terminal.session);
        position.current = nextPlayer.length;
        setCursor(nextPlayer.length);
      }
      setPlayer(nextPlayer);
      setResponse(result);
      setGroup(reviewCase);
      if (mode === 'judge' && persist && writable) {
        const fact = await service.recordMysqlJudge(target.profile!, result, epoch, revision);
        if (token === operation.current && fact) setNotice('判题结果已记入本地复盘。');
      }
    } catch (cause) {
      if (token === operation.current) setError(friendly(cause));
    } finally {
      if (token === operation.current) setBusy('');
    }
  }

  async function save(replace = false) {
    setSaving(true);
    setError('');
    const token = operation.current;
    const input = { source, session: structuredClone(liveSession) };
    try {
      const previous = replace ? await service.readMysqlDraft(target.id, epoch) : saved;
      if (token !== operation.current) return;
      const value = await service.saveMysqlDraft(
        target.id,
        input,
        previous?.revision ?? null,
        epoch,
      );
      if (!mounted.current) return;
      setSaved(value);
      setConflict(false);
      if (token === operation.current) setNotice('SQL 和数据库草稿已保存到此浏览器。');
    } catch (cause) {
      if (!mounted.current) return;
      setConflict(cause instanceof Error && cause.message === 'S_REVISION_CONFLICT');
      if (token === operation.current) setError(friendly(cause));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function download(format: 'json' | 'md' | 'png' | 'zip') {
    if (!response || !player || exporting) return;
    const token = operation.current;
    const capturedPositionRevision = positionRevision.current;
    setExporting(true);
    setError('');
    try {
      const { exportMysqlSnapshot } = await import('./snapshot');
      await exportMysqlSnapshot(
        format,
        response,
        cursor,
        target.title,
        target.id,
        () =>
          mounted.current &&
          token === operation.current &&
          position.current === cursor &&
          positionRevision.current === capturedPositionRevision,
      );
      if (token === operation.current) setNotice('当前 SQL 与步骤状态已导出。');
    } catch (cause) {
      if (token === operation.current) setError(friendly(cause));
    } finally {
      if (mounted.current) setExporting(false);
    }
  }

  const positions = useMemo(() => mysqlSourcePositions(source), [source]);
  const locate = (range: MysqlRange) => {
    const start = positions.get(range.start),
      end = positions.get(range.end);
    if (!start || !end) return;
    setPane('sql');
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(start.utf16Offset, end.utf16Offset);
    });
  };
  const diagnostic = response?.diagnostic ?? response?.replay?.terminal.diagnostic;
  const where = diagnostic ? positions.get(diagnostic.byteRange.start) : null;
  return (
    <>
      <header className="mysql-title">
        <div>
          <h1>{target.title}</h1>
          <p>输入 SQL，观察对应表格与查询结果。</p>
        </div>
        {target.lesson && <Link to={'/mysql/lesson/' + target.lesson}>返回小节</Link>}
      </header>
      {target.prompt && (
        <section className="mysql-sheet mysql-task" aria-label="题目要求">
          <h2>练习要求</h2>
          <p>
            <MysqlText text={target.prompt} />
          </p>
          <details>
            <summary>查看提示</summary>
            {target.hints?.map((hint, at) => (
              <details key={hint}>
                <summary>提示 {at + 1}</summary>
                <p>
                  <MysqlText text={hint} />
                </p>
              </details>
            ))}
          </details>
        </section>
      )}
      <div className="mysql-pane-tabs" role="group" aria-label="工作区域">
        <button aria-pressed={pane === 'sql'} onClick={() => setPane('sql')}>
          SQL 与结果
        </button>
        <button aria-pressed={pane === 'data'} onClick={() => setPane('data')}>
          数据库表格
        </button>
      </div>
      <div className="mysql-work-grid" data-pane={pane}>
        <div className="mysql-sql-column">
          <section className="mysql-sheet mysql-editor-panel" aria-label="SQL 编辑区">
            <div className="mysql-title">
              <h2>SQL</h2>
              <span className="mysql-muted">
                {dirty ? '有未保存的改动' : saved ? '已保存草稿' : '当前文档'}
              </span>
            </div>
            <textarea
              ref={editor}
              aria-label="SQL 源码"
              className="mysql-editor"
              value={source}
              onChange={(event) => changeSource(event.target.value)}
              spellCheck={false}
              rows={9}
            />
            <div className="mysql-actions">
              <button
                className="button mysql-primary"
                disabled={!!busy || saving || historical}
                onClick={() => void run('run')}
              >
                运行 SQL
              </button>
              {target.profile && (
                <button disabled={!!busy || saving || historical} onClick={() => void run('judge')}>
                  提交判题
                </button>
              )}
              <button
                disabled={!busy}
                onClick={() => {
                  resetResult();
                  setNotice('已取消当前操作，当前数据库保持不变。');
                }}
              >
                取消
              </button>
              <button
                disabled={!writable || saving || !!busy || !dirty}
                onClick={() => void save()}
              >
                {saving ? '正在保存…' : '保存草稿'}
              </button>
            </div>
            {historical && (
              <p className="mysql-muted">
                正在查看历史步骤。
                <button className="mysql-text-button" onClick={() => seek(player!.length)}>
                  回到当前数据库
                </button>
                后可继续运行。
              </p>
            )}
            {!writable && <p className="mysql-muted">本地档案暂不可写，可继续输入和运行 SQL。</p>}
            {busy && <p role="status">{busy}</p>}
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert">{error}</p>}
            {conflict && (
              <button disabled={!writable || saving || !!busy} onClick={() => void save(true)}>
                以当前 SQL 和数据库保存
              </button>
            )}
            {response && (
              <div className="mysql-run-status" aria-label="运行结果">
                <p role="status">
                  {response.judgement
                    ? response.judgement.passed
                      ? '四组均通过'
                      : response.judgement.complete
                        ? '尚未全部通过'
                        : '判题未完成，不计学习结果'
                    : response.status === 'completed'
                      ? 'SQL 执行完成'
                      : response.status === 'limited'
                        ? '到达执行限额'
                        : 'SQL 执行出错'}
                  {diagnostic ? ' · ' + diagnostic.code : ''}
                </p>
                {diagnostic && (
                  <p>{explanations[diagnostic.code] ?? '已显示本次可确认的执行状态。'}</p>
                )}
                {where && (
                  <button onClick={() => locate(diagnostic!.byteRange)}>
                    定位第 {where.line} 行，第 {where.column} 列
                  </button>
                )}
                {response.replay?.trace.completeness === 'prefix' && (
                  <p className="mysql-muted">
                    表格保留先前已完成语句的状态，失败语句未产生部分写入。
                  </p>
                )}
              </div>
            )}
          </section>
          <MysqlResultTable result={view.result} />
        </div>
        <aside className="mysql-data-column">
          <MysqlDatabaseTables state={view} historical={historical} />
          <div className="mysql-database-actions">
            <button disabled={saving} onClick={() => resetDatabase()}>
              重置数据库
            </button>
            {target.cases && (
              <label>
                初始数据组
                <select
                  aria-label="初始数据组"
                  value={group}
                  onChange={(event) => resetDatabase(Number(event.target.value))}
                >
                  {target.cases.map((item, at) => (
                    <option key={item.index} value={at}>
                      第 {at + 1} 组
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="mysql-muted">
              重置仅恢复数据库，保留当前 SQL。判题始终使用四组独立初始数据。
            </p>
          </div>
        </aside>
      </div>
      {response?.judgement && (
        <section className="mysql-sheet" aria-label="四组判题结果">
          <div className="mysql-title">
            <h2>判题与复盘</h2>
            <Link to="/mysql/review">本地判题记录</Link>
          </div>
          <div className="mysql-case-results">
            {response.judgement.cases.map((item) => (
              <div key={item.index}>
                <span>第 {item.index + 1} 组</span>
                <strong>{caseReason[item.reason]}</strong>
                <button
                  disabled={!!busy || saving || historical}
                  aria-pressed={response.judgement!.reviewCase === item.index}
                  onClick={() => void run('judge', item.index, false)}
                >
                  复盘第 {item.index + 1} 组
                </button>
              </div>
            ))}
          </div>
          <p className="mysql-muted">复盘重新验证当前 SQL，显示所选组的真实表格和轨迹。</p>
        </section>
      )}
      {response?.replay && (
        <MysqlTrace
          key={response.identity.runId}
          response={response}
          source={source}
          cursor={cursor}
          seek={seek}
          locate={locate}
          playbackRate={state.snapshot?.settings.playbackRate ?? 1}
          exporting={exporting}
        />
      )}
      {response?.replay && (
        <section className="mysql-sheet mysql-export">
          <h2>导出当前步骤</h2>
          <div className="mysql-actions">
            {(['json', 'md', 'png', 'zip'] as const).map((format) => (
              <button
                key={format}
                disabled={exporting || !!busy}
                onClick={() => void download(format)}
              >
                导出 {format === 'md' ? 'Markdown' : format.toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      )}
      <details className="mysql-sheet mysql-support">
        <summary>支持范围与数据说明</summary>
        <p>
          MySQL 8.0 教学子集在当前浏览器执行。支持 SELECT、连接与分组、INT / VARCHAR
          表、数据增删改及事务；仅接受已支持的 SQL，不连接外部数据库。
        </p>
        <p>
          数据库、结果和事务由同一次执行产生。整数列范围为 −2147483648 至 2147483647；SUM 与 AVG
          使用精确十进制结果，AVG 显示四位小数。NULL、0 和空字符串分别保存。
        </p>
        <p>
          SQL
          和数据库草稿保存在此浏览器。活动事务可跨运行延续，保存草稿后可在刷新时恢复；恢复草稿不代表已经运行或通过练习。安装、权限、备份、外部连接等内容可在课程中阅读。
        </p>
        <Link to="/mysql">查看完整课程</Link>
      </details>
    </>
  );
}

const loadTarget = async (key: string, signal: AbortSignal): Promise<Target> => {
  if (key === mysqlFreeDocument) return free;
  const identity = mysqlExercise(key);
  const { lesson } = await loadMysqlLesson(identity?.lesson ?? key, signal);
  if (lesson.example?.mode !== 'wasm' || lesson.activity?.mode !== 'judge')
    throw new Error('E_MYSQL_LESSON_UNKNOWN');
  const profile = mysqlProfile(lesson.example.profile);
  if (!profile) throw new Error('E_PROFILE_UNKNOWN');
  return {
    id: key,
    title: identity ? profile.title + '练习' : lesson.title + '示例',
    source: identity ? lesson.activity.starter : lesson.example.source,
    session: profile.cases[0].session,
    lesson: lesson.id,
    cases: profile.cases,
    ...(identity
      ? { profile: key, prompt: lesson.activity.prompt, hints: lesson.activity.hints }
      : {}),
  };
};
function LoadedEditor({ target }: { target: Target }) {
  const { service, state } = useLearning();
  const epoch = state.sessionEpoch;
  const writable = state.snapshot?.meta.dbVersion === 15 && state.recovery?.writable !== false;
  const load = useCallback(
    async () => ({ draft: writable ? await service.readMysqlDraft(target.id, epoch) : null }),
    [writable, service, target.id, epoch],
  );
  const drafts = useJavaResource(`${target.id}:${epoch}:${writable}`, load);
  if (!drafts.value) return <MysqlLoadState failed={drafts.failed} retry={drafts.retry} />;
  return (
    <Editor
      key={`${target.id}:${epoch}`}
      target={target}
      draft={drafts.value.draft}
      writable={writable}
      epoch={epoch}
    />
  );
}
export default function MysqlWorkbench() {
  const { lessonId, profileId } = useParams();
  const target = useJavaResource(profileId ?? lessonId ?? mysqlFreeDocument, loadTarget);
  return (
    <div className="mysql-screen">
      <MysqlNav />
      {target.value ? (
        <LoadedEditor target={target.value} />
      ) : (
        <MysqlLoadState failed={target.failed} retry={target.retry} />
      )}
    </div>
  );
}
