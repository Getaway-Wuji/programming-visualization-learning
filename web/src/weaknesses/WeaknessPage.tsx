import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { c6DisplayReference } from '../c6-learning/display';
import type { createLearningService } from '../learning/service';
import { storageError } from '../storage/errors';
import { challengeQuestions } from '../challenges/content';
import { weaknessReasons, type WeaknessSummary, type WeaknessEvidence } from './model';
import { mistakeLabels } from '../review-notebook/model';
import { pythonExercise, pythonTopic } from '../python3/identities';
import './weaknesses.css';

export class WeaknessController {
  private state = {
    status: 'loading' as 'loading' | 'ready' | 'failed',
    summary: null as WeaknessSummary | null,
    error: '',
  };
  private listeners = new Set<() => void>();
  private serial = 0;
  private reading = false;
  private reread = false;
  private generation: string | undefined;
  constructor(private service: ReturnType<typeof createLearningService>) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(p: Partial<typeof this.state>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn();
  }
  invalidate = () => {
    this.serial++;
    this.publish({ status: 'loading', summary: null });
  };
  async reload() {
    const context = this.service.editorHistoryContext();
    if (context?.generation !== this.generation) {
      this.generation = context?.generation;
      this.invalidate();
    }
    if (this.reading) {
      this.reread = true;
      return;
    }
    if (!context || !this.service.getState().capabilities.learning) {
      this.publish({ status: 'failed', summary: null, error: '本地档案或来源课程暂不可确认' });
      return;
    }
    this.reading = true;
    const ticket = ++this.serial;
    this.publish({ status: 'loading', summary: null, error: '' });
    try {
      const summary = await this.service.syncWeaknesses(context);
      if (ticket === this.serial) this.publish({ status: 'ready', summary });
    } catch (e) {
      if (ticket === this.serial)
        this.publish({ status: 'failed', summary: null, error: storageError(e).code });
    } finally {
      this.reading = false;
      if (this.reread) {
        this.reread = false;
        void this.reload();
      }
    }
  }
}
const evidenceState = {
  active: '待复习',
  repaired: '后来已通过',
  expired: '已超出30天窗口',
  familiar: '已取消陌生标记',
};
function Evidence({ item }: { item: WeaknessEvidence }) {
  const { state } = useLearning();
  const q = challengeQuestions.find((q) => q.ref.id === item.sourceRef.id);
  const title =
    item.kind === 'manual'
      ? '手动陌生标记'
      : item.kind === 'challenge'
        ? (q?.title ?? item.sourceRef.id)
        : (pythonExercise(item.sourceRef.id)?.title ??
          c6DisplayReference(state, item.sourceRef)?.title ??
          state.reading?.exercises.find((e) => e.id === item.sourceRef.id)?.title ??
          item.sourceRef.id);
  const label =
    item.category && Object.hasOwn(mistakeLabels, item.category)
      ? mistakeLabels[item.category as keyof typeof mistakeLabels]
      : item.kind === 'challenge'
        ? '下一步预测误答'
        : '你的自评';
  return (
    <li>
      <p>
        <strong>{item.kind === 'manual' ? '手动自评' : '自动证据'}</strong> · {title} · {label}
      </p>
      <p className="muted">
        <time dateTime={item.at}>
          {new Date(item.at).toLocaleString('zh-CN', {
            timeZone: state.snapshot?.meta.timeZone,
            hour12: false,
          })}
        </time>{' '}
        · {evidenceState[item.state]}
      </p>
      <details>
        <summary>核对来源引用</summary>
        <p className="weakness-ref">
          {item.sourceRef.id}@{item.sourceRef.version}
          <br />
          事件 {item.sourceId} · 修订 {item.revision}
        </p>
      </details>
      {item.mapping === 'foundation' && (
        <p className="muted">基础课程关联，不能据此确定具体知识缺陷。</p>
      )}
      {q && (
        <Link className="text-link" to={`/visualize/${q.caseId}`}>
          复看挑战来源案例
        </Link>
      )}
    </li>
  );
}
export default function WeaknessPage() {
  const { service, state: learning } = useLearning();
  const [controller] = useState(() => new WeaknessController(service));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    void controller.reload();
  }, [
    controller,
    learning.snapshot?.meta.generation,
    learning.snapshot?.meta.revision,
    learning.sessionEpoch,
    learning.practiceCatalog,
    learning.capabilities.learning,
  ]);
  useEffect(() => {
    const refresh = () => {
      void controller.reload();
    };
    const stop = service.subscribeSessionInvalidation(controller.invalidate);
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      stop();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      controller.invalidate();
    };
  }, [controller, service]);
  const rows = state.summary?.rows ?? [],
    active = rows.filter((r) => weaknessReasons(r).length > 0),
    visible = history ? rows : active;
  return (
    <div className="weakness-page" data-page-id="PAGE-19-1">
      <PageHeading
        kicker="本地复习"
        title="薄弱点与学习依据"
        description="从已保存的真实练习、挑战作答和你的自评中，找出值得复习的关联知识。"
      />
      <LearningSaveStatus />
      <div className="weakness-toolbar">
        <Link className="text-link" to="/generated-practice">
          生成一道同类加练题 →
        </Link>
        <Link className="text-link" to="/notebook">
          核对错题与陌生点 →
        </Link>
      </div>
      <div role="status" data-testid="weakness-status" data-state={state.status}>
        {state.status === 'ready' ? (
          <p>
            本地归纳已保存 · {state.summary!.observedDate} · {active.length} 个知识点建议复习
          </p>
        ) : state.status === 'loading' ? (
          <p>正在核对本地证据……</p>
        ) : (
          <p>薄弱点尚不能确认（{state.error}）。原记录保留，可继续课程或复习。</p>
        )}
        {state.status === 'failed' && (
          <button className="button button-secondary" onClick={() => void controller.reload()}>
            重新归纳本地证据
          </button>
        )}
      </div>
      {learning.pendingCount > 0 && (
        <p className="notice">有学习操作尚未保存，推荐只使用已保存事实。请先重试未保存操作。</p>
      )}
      <div
        className="weakness-layout"
        data-empty={state.status !== 'ready' || !visible.length ? 'yes' : 'no'}
      >
        <section className="card section-card" aria-labelledby="weakness-list-title">
          <div className="module-title">
            <h2 id="weakness-list-title">{history ? '全部关联记录' : '建议复习的知识'}</h2>
            <label>
              <input
                type="checkbox"
                checked={history}
                onChange={(e) => setHistory(e.target.checked)}
              />{' '}
              显示已修复与历史
            </label>
          </div>
          {state.status === 'ready' && !visible.length && (
            <p data-testid="weakness-empty">
              {rows.length
                ? '当前没有待复习建议，历史依据仍保留。'
                : '暂无可确认的薄弱记录。继续原课程，或主动标记陌生知识。'}
            </p>
          )}
          <ul className="weakness-list">
            {state.status === 'ready' &&
              visible.map((row) => (
                <li
                  key={row.knowledgeRef.id}
                  data-weakness-id={row.knowledgeRef.id}
                  data-recommended={weaknessReasons(row).length ? 'yes' : 'no'}
                >
                  <h3>
                    {pythonTopic(row.knowledgeRef.id)?.title ??
                      c6DisplayReference(learning, row.knowledgeRef)?.title ??
                      learning.reading?.knowledgePoints.find(
                        (k) =>
                          k.id === row.knowledgeRef.id && k.version === row.knowledgeRef.version,
                      )?.title ??
                      row.knowledgeRef.id}
                  </h3>
                  {weaknessReasons(row).length ? (
                    <ul className="weakness-reasons">
                      {weaknessReasons(row).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>现有证据已修复、已取消或超出推荐窗口。</p>
                  )}
                  <p className="muted">
                    历史真实失败 {row.exerciseFailures} 次 · 近30天未修复失败 {row.recentFailures}{' '}
                    次 · 挑战误答 {row.challengeMistakes} 道
                  </p>
                  <Link
                    className="text-link"
                    to={
                      pythonTopic(row.knowledgeRef.id)
                        ? '/python/article/' +
                          pythonTopic(row.knowledgeRef.id)!.articleOrder +
                          '/' +
                          row.lessonRef.id
                        : `/lessons/${row.lessonRef.id}`
                    }
                  >
                    复习关联基础课程 →
                  </Link>
                  <details className="weakness-evidence">
                    <summary>查看最近依据（最多3条）</summary>
                    <ul>
                      {row.evidence.map((e) => (
                        <Evidence key={e.sourceId} item={e} />
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
          </ul>
          {!!state.summary?.unmapped && (
            <p className="notice">
              有 {state.summary.unmapped}{' '}
              条旧版本或来源不足的记录未归入知识建议。原摘要仍保留，不推断缺陷。
            </p>
          )}
        </section>
        <aside className="card section-card weakness-rules" aria-labelledby="weakness-rule-title">
          <h2 id="weakness-rule-title">为什么建议复习</h2>
          <p>
            真实错误按事件去重。最近通过后，30天内至少2次失败称为反复失败；通过会关闭该题来源，再错会重开。
          </p>
          <p>挑战同一题只计1道。至少2道不同题仍误答才称卡壳；后来答对会解决该题线索。</p>
          <p>
            手动标记是你的自评，可在原课程取消。自动证据与自评分别保留，建议不等于确定的知识缺陷。
          </p>
          <p>
            浏览、暂停、回退、慢速观看和正常重播不作为薄弱依据。自定义代码诊断缺少题目知识映射时不归因。
          </p>
          <p className="muted">
            这些学习依据只保存在当前浏览器。本功能不调用外部模型，不上传学习档案。
          </p>
          <Link className="text-link" to="/courses">
            继续原课程 →
          </Link>
        </aside>
      </div>
    </div>
  );
}
