import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useLearning } from '../learning/react';
import type { createLearningService } from '../learning/service';
import type { KnowledgeMark, KnowledgeMarkCommand } from '../storage/knowledge-marks';
import type { EditorHistoryContext } from '../storage/editor-history';
import { storageError } from '../storage/errors';

export class KnowledgeMarksController {
  private state = {
    status: 'loading' as 'loading' | 'ready' | 'saving' | 'unsaved' | 'failed',
    rows: [] as KnowledgeMark[],
    error: '',
    pending: 0,
  };
  private listeners = new Set<() => void>();
  private generation: string | undefined;
  private pending: { context: EditorHistoryContext; command: KnowledgeMarkCommand } | undefined;
  private serial = 0;
  constructor(private service: ReturnType<typeof createLearningService>) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const f of this.listeners) f();
  }
  async reload() {
    const context = this.service.editorHistoryContext(),
      ticket = ++this.serial;
    if (context?.generation !== this.generation) {
      this.generation = context?.generation;
      this.pending = undefined;
      this.publish({ rows: [], pending: 0 });
    }
    if (!context) {
      this.publish({ status: 'failed', error: '学习档案暂不可确认' });
      return;
    }
    try {
      const rows = await this.service.readKnowledgeMarks(context);
      if (ticket === this.serial && this.generation === context.generation)
        this.publish({
          rows,
          status: this.pending ? 'unsaved' : 'ready',
          error: this.pending ? this.state.error : '',
        });
    } catch (error) {
      if (ticket === this.serial)
        this.publish({ status: 'failed', error: storageError(error).code });
    }
  }
  async set(lessonId: string, knowledgeId: string, marked: boolean) {
    if (this.pending || this.state.status !== 'ready') return;
    const state = this.service.getState(),
      context = this.service.editorHistoryContext(),
      reading = state.reading,
      lesson = reading?.lessons.find((l) => l.id === lessonId),
      knowledge = lesson?.knowledgeRefs.find((k) => k.id === knowledgeId);
    const c6Lesson = state.c6?.index?.lessons.find(
      (l) => l[0] === lessonId && l[3] === knowledgeId,
    );
    if (!context || (!c6Lesson && (!reading || !lesson || !knowledge))) return;
    const old = this.state.rows.find((r) => r.knowledgeRef.id === knowledgeId);
    if (old?.marked === marked) return;
    this.pending = {
      context,
      command: {
        commandId: crypto.randomUUID(),
        expectedVersion: old?.revision ?? 0,
        packageRef: { ...(state.c6?.index?.packageRef ?? reading!.packageRef) },
        knowledgeRef: c6Lesson ? { id: knowledgeId, version: '2.0.0' } : { ...knowledge! },
        lessonRef: c6Lesson
          ? { id: lessonId, version: '2.0.0' }
          : { id: lesson!.id, version: lesson!.version },
        marked,
        at: new Date().toISOString(),
      },
    };
    await this.retry();
  }
  async retry() {
    const pending = this.pending;
    if (!pending) return;
    this.publish({ status: 'saving', pending: 1, error: '' });
    try {
      const rows = await this.service.saveKnowledgeMark(pending.context, pending.command);
      if (this.pending === pending && this.generation === pending.context.generation) {
        this.pending = undefined;
        this.publish({ rows, status: 'ready', pending: 0, error: '' });
      }
    } catch (error) {
      if (this.pending !== pending) return;
      const code = storageError(error).code;
      if (['S_GENERATION_STALE', 'S_REVISION_CONFLICT', 'S_CONTENT_INCOMPATIBLE'].includes(code)) {
        this.pending = undefined;
        this.publish({ pending: 0, status: 'failed', error: code });
      } else this.publish({ status: 'unsaved', pending: 1, error: code });
    }
  }
}
const Context = createContext<KnowledgeMarksController | null>(null);
export function KnowledgeMarksProvider({ children }: { children: ReactNode }) {
  const { service, state } = useLearning();
  const [controller] = useState(() => new KnowledgeMarksController(service));
  useEffect(() => {
    void controller.reload();
  }, [
    controller,
    state.snapshot?.meta.generation,
    state.snapshot?.meta.revision,
    state.sessionEpoch,
  ]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useKnowledgeMarks() {
  const controller = useContext(Context);
  if (!controller) throw new Error('KnowledgeMarksProvider');
  return { controller, state: useSyncExternalStore(controller.subscribe, controller.getSnapshot) };
}
export function KnowledgeMarksStatus() {
  const { controller, state } = useKnowledgeMarks();
  return (
    <div data-testid="knowledge-marks-status" data-state={state.status}>
      {state.status === 'loading' ? (
        <p role="status">正在读取陌生标记……</p>
      ) : state.status === 'ready' ? null : (
        <p role="status">
          {state.status === 'saving'
            ? '正在保存陌生标记……'
            : `陌生标记尚未保存或无法确认（${state.error}）。已有记录保留。`}
        </p>
      )}
      {state.pending > 0 && (
        <>
          <p>有1条标记操作尚未保存，刷新会丢失；未保存标记不计入列表。</p>
          <button
            type="button"
            className="button button-secondary"
            disabled={state.status === 'saving'}
            onClick={() => void controller.retry()}
          >
            重试陌生标记
          </button>
        </>
      )}
      {state.status === 'failed' && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void controller.reload()}
        >
          重新读取陌生标记
        </button>
      )}
    </div>
  );
}
export function KnowledgeMarkButton({
  lessonId,
  knowledgeId,
}: {
  lessonId: string;
  knowledgeId: string;
}) {
  const { state, controller } = useKnowledgeMarks(),
    learning = useLearning().state;
  const marked = state.rows.find((r) => r.knowledgeRef.id === knowledgeId)?.marked ?? false;
  return (
    <button
      type="button"
      className="text-link"
      aria-pressed={marked}
      disabled={state.status !== 'ready' || !learning.capabilities.learning}
      data-knowledge-mark={knowledgeId}
      onClick={() => void controller.set(lessonId, knowledgeId, !marked)}
    >
      {marked ? '已标陌生，改为熟悉' : '标记陌生'}
    </button>
  );
}
