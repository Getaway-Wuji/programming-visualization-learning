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
import { localDateAt } from '../storage/validation';
import { storageError } from '../storage/errors';
import { reviewGroups, type ReviewCard, type ReviewCommand, type Rating } from './model';
import './reviews.css';
export class ReviewController {
  private state = {
    status: 'loading' as 'loading' | 'ready' | 'saving' | 'unsaved' | 'failed',
    rows: [] as ReviewCard[],
    today: '',
    zone: '',
    error: '',
    pending: 0,
  };
  private listeners = new Set<() => void>();
  private generation: string | undefined;
  private pending: { context: EditorHistoryContext; command: ReviewCommand } | undefined;
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
    if (
      !context ||
      (!this.service.getState().practiceCatalog && !this.service.getState().c6?.index)
    ) {
      this.publish({ status: 'failed', error: '本地档案或课程暂不可确认' });
      return;
    }
    if (this.state.status === 'saving') {
      this.reread = true;
      return;
    }
    if (this.reading) {
      this.reread = true;
      return;
    }
    this.reading = true;
    const ticket = ++this.serial;
    try {
      const rows = await this.service.syncReviewCards(context);
      if (ticket === this.serial && this.generation === context.generation) {
        const zone = this.service.getState().snapshot!.meta.timeZone;
        this.publish({
          rows,
          zone,
          today: localDateAt(new Date().toISOString(), zone),
          status: this.pending ? 'unsaved' : 'ready',
          error: this.pending ? this.state.error : '',
        });
      }
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
  async act(cardId: string, mode: ReviewCommand['mode'], rating: Rating | null) {
    if (this.pending || this.state.status !== 'ready') return;
    const context = this.service.editorHistoryContext(),
      card = this.state.rows.find((c) => c.cardId === cardId);
    if (!context || !card) return;
    const at = new Date().toISOString();
    this.pending = {
      context,
      command: {
        commandId: crypto.randomUUID(),
        cardId,
        expectedVersion: card.revision,
        sourceVersion: card.sourceVersion,
        mode,
        rating,
        targetReviewId: mode === 'correct' ? (card.lastReview?.reviewId ?? null) : null,
        at,
        localDate: localDateAt(at, this.state.zone),
      },
    };
    ++this.serial;
    await this.retry();
  }
  async retry() {
    const pending = this.pending;
    if (!pending || this.state.status === 'saving') return;
    this.publish({ status: 'saving', pending: 1, error: '' });
    try {
      const rows = await this.service.syncReviewCards(pending.context, pending.command);
      if (this.pending === pending && this.generation === pending.context.generation) {
        this.pending = undefined;
        this.publish({
          rows,
          status: 'ready',
          pending: 0,
          error: '',
          today: localDateAt(new Date().toISOString(), this.state.zone),
        });
      }
    } catch (e) {
      if (this.pending !== pending) return;
      const error = storageError(e).code;
      if (
        [
          'S_GENERATION_STALE',
          'S_REVISION_CONFLICT',
          'S_CONTENT_INCOMPATIBLE',
          'S_DATE_INVALID',
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
const Context = createContext<ReviewController | null>(null);
export function ReviewProvider({ children }: { children: ReactNode }) {
  const { service, state } = useLearning();
  const [controller] = useState(() => new ReviewController(service));
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
    const tick = () => {
      const s = controller.getSnapshot();
      if (s.zone && localDateAt(new Date().toISOString(), s.zone) !== s.today) refresh();
    };
    const timer = window.setInterval(tick, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useReviews() {
  const controller = useContext(Context);
  if (!controller) throw new Error('ReviewProvider');
  return { controller, state: useSyncExternalStore(controller.subscribe, controller.getSnapshot) };
}
export function ReviewStatus() {
  const { state, controller } = useReviews();
  return (
    <div data-testid="review-save-status" data-state={state.status} role="status">
      {state.status === 'ready' ? (
        <p>复习计划已保存于当前浏览器。</p>
      ) : (
        <p>
          {state.status === 'loading'
            ? '正在确认复习计划……'
            : state.status === 'saving'
              ? '正在保存复习评价……'
              : `复习计划尚未保存或无法确认（${state.error}）。已有记录保留。`}
        </p>
      )}
      {state.pending > 0 && (
        <>
          <p>有1项复习操作未保存，刷新会丢失；显示的仍是已保存计划。</p>
          <button
            type="button"
            className="button button-secondary"
            disabled={state.status === 'saving'}
            onClick={() => void controller.retry()}
          >
            重试复习操作
          </button>
        </>
      )}
      {state.status === 'failed' && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void controller.reload()}
        >
          重新读取复习计划
        </button>
      )}
    </div>
  );
}
export function ReviewDueSummary() {
  const { state } = useReviews();
  const confirmed = state.status === 'ready' || state.status === 'unsaved';
  const due = confirmed && state.today ? reviewGroups(state.rows, state.today).due.length : null;
  return (
    <section className="review-summary" aria-label="到期复习" data-testid="review-due-summary">
      <div>
        <h2>今日复习</h2>
        <p>{due === null ? '复习计划待确认' : `${due} 张卡片到期`}</p>
      </div>
      <Link className="text-link" to="/reviews">
        打开复习队列 →
      </Link>
    </section>
  );
}
