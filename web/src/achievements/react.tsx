import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import type { createLearningService } from '../learning/service';
import type { EditorHistoryContext } from '../storage/editor-history';
import { storageError } from '../storage/errors';
import type { ObservationFact } from './observation';
import type { Achievement } from './model';
import './achievements.css';

export class AchievementController {
  private state = {
    status: 'loading' as 'loading' | 'ready' | 'saving' | 'unsaved' | 'failed',
    rows: [] as Achievement[],
    error: '',
    pending: 0,
  };
  private listeners = new Set<() => void>();
  private generation: string | undefined;
  private pending: { context: EditorHistoryContext; fact: ObservationFact } | undefined;
  private reading = false;
  private reread = false;
  private serial = 0;
  constructor(private service: ReturnType<typeof createLearningService>) {}
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private publish(p: Partial<typeof this.state>) {
    this.state = { ...this.state, ...p };
    for (const f of this.listeners) f();
  }
  async reload() {
    const context = this.service.editorHistoryContext();
    if (context?.generation !== this.generation) {
      this.generation = context?.generation;
      this.pending = undefined;
      this.serial++;
      this.publish({ rows: [], pending: 0, status: 'loading' });
    }
    if (!context || !this.service.getState().practiceCatalog) {
      this.publish({ status: 'failed', error: '本地档案或课程暂不可确认' });
      return;
    }
    if (this.reading || this.state.status === 'saving') {
      this.reread = true;
      return;
    }
    this.reading = true;
    const ticket = ++this.serial;
    try {
      const rows = await this.service.syncAchievements(context);
      if (ticket === this.serial && this.generation === context.generation)
        this.publish({
          rows,
          status: this.pending ? 'unsaved' : 'ready',
          error: this.pending ? this.state.error : '',
        });
    } catch (e) {
      if (ticket === this.serial) this.publish({ status: 'failed', error: storageError(e).code });
    } finally {
      this.reading = false;
      if (this.reread) {
        this.reread = false;
        void this.reload();
      }
    }
  }
  async confirm(fact: ObservationFact) {
    if (this.pending || this.state.status !== 'ready') return;
    const context = this.service.editorHistoryContext();
    if (!context) return;
    this.pending = { context, fact };
    ++this.serial;
    await this.retry();
  }
  async retry() {
    const pending = this.pending;
    if (!pending || this.state.status === 'saving') return;
    this.publish({ status: 'saving', pending: 1, error: '' });
    try {
      const rows = await this.service.syncAchievements(pending.context, pending.fact);
      if (this.pending === pending && this.generation === pending.context.generation) {
        this.pending = undefined;
        this.publish({ rows, status: 'ready', pending: 0, error: '' });
      }
    } catch (e) {
      if (this.pending !== pending) return;
      const error = storageError(e).code;
      if (
        [
          'S_GENERATION_STALE',
          'S_CONTENT_INCOMPATIBLE',
          'S_DATE_INVALID',
          'S_RECORD_INVALID',
          'S_VERSION_UNKNOWN',
        ].includes(error)
      ) {
        this.pending = undefined;
        this.publish({ status: 'failed', pending: 0, error });
      } else this.publish({ status: 'unsaved', pending: 1, error });
    } finally {
      if (this.reread) {
        this.reread = false;
        void this.reload();
      }
    }
  }
}
const Context = createContext<AchievementController | null>(null);
export function AchievementProvider({ children }: { children: ReactNode }) {
  const { service, state } = useLearning();
  const [controller] = useState(() => new AchievementController(service));
  useEffect(() => {
    void controller.reload();
  }, [
    controller,
    state.snapshot?.meta.generation,
    state.snapshot?.meta.revision,
    state.sessionEpoch,
    state.practiceCatalog,
    state.capabilities.learning,
  ]);
  useEffect(() => {
    const refresh = () => {
      void controller.reload();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useAchievements() {
  const controller = useContext(Context);
  if (!controller) throw Error('AchievementProvider');
  return { controller, state: useSyncExternalStore(controller.subscribe, controller.getSnapshot) };
}
export function AchievementStatus() {
  const { state, controller } = useAchievements();
  return (
    <div data-testid="achievement-save-status" data-state={state.status} role="status">
      <p>
        {state.status === 'ready'
          ? '成就记录已保存于当前浏览器。'
          : state.status === 'loading'
            ? '正在确认本地成就……'
            : state.status === 'saving'
              ? '正在保存观察记录……'
              : `成就记录尚未保存或无法确认（${state.error}）。已有记录保留。`}
      </p>
      {state.pending > 0 && (
        <>
          <p>有1项观察确认未保存，刷新会丢失；当前仍显示已保存的记录。</p>
          <button
            type="button"
            className="button button-secondary"
            disabled={state.status === 'saving'}
            onClick={() => void controller.retry()}
          >
            重试观察确认
          </button>
        </>
      )}
      {state.status === 'failed' && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void controller.reload()}
        >
          重新确认成就
        </button>
      )}
    </div>
  );
}
export function AchievementSummary() {
  const { state } = useAchievements();
  const known = ['ready', 'unsaved'].includes(state.status);
  return (
    <section
      className="achievement-summary"
      aria-label="本地成就"
      data-testid="achievement-summary"
    >
      <div>
        <h2>学习成就</h2>
        <p>
          {known
            ? `${state.rows.filter((r) => r.unlockedAt).length} / 3 枚已解锁`
            : '成就记录待确认'}
        </p>
      </div>
      <Link className="text-link" to="/achievements">
        查看成就与条件 →
      </Link>
    </section>
  );
}
