import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { caseExecutionCatalog } from '../content/case-learning';
import { LearningSaveStatus, useLearning } from '../learning/react';
import {
  caseRequest,
  executionClient,
  type ExecutionCatalog,
  type PreparedSource,
  type CaseInput,
} from '../engine/execution-client';
import type { ByteRange, ExecuteResult, ExecuteRequest } from '../engine/protocol';
import { ExportPanel } from '../snapshot-export/ExportPanel';
import type { CaptureContext } from '../snapshot-export/types';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import {
  defaultDraft,
  generateInput,
  InputDataError,
  parseInputDraft,
  type InputIssue,
} from '../engine/input-data';
import { InputPanel } from './InputPanel';
import { PlayerController } from '../player/controller';
import { PlayerControls } from './PlayerControls';
import { SourcePanel } from './SourcePanel';
import { BasicTraceView } from './BasicTraceView';
import { Workbench, type WorkbenchHandle } from '../workbench/Workbench';
import { createCaseViewSession } from '../learning/case-authority';
import type { VerifiedFact } from '../learning/authority';
import '../learning/rewards.css';
import { createChallengeSession, type ChallengeSession } from '../challenges/authority';
import { ChallengePanel } from '../challenges/ChallengePanel';

const labels: Record<string, string> = {
  completed: '程序正常结束',
  'program-error': '程序发生错误',
  rejected: '请求未通过检查',
  'resource-limit': '运行超过限制',
  cancelled: '已取消运行',
  'infrastructure-failure': '执行未能完成',
};

export function CaseExecution({ id, children }: { id: string; children?: ReactNode }) {
  const { service, state: learningState } = useLearning();
  const [player] = useState(() => new PlayerController(1, 'key'));
  const traceVisible = useRef(true);
  const playerSnapshot = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const traceVisibility = useCallback(
    (visible: boolean) => {
      traceVisible.current = visible;
      if (!visible) player.pause();
    },
    [player],
  );
  const savedRate = learningState.snapshot?.settings.playbackRate ?? 1;
  useEffect(() => player.setRate(savedRate), [player, savedRate]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState('preparing');
  const [catalog, setCatalog] = useState<ExecutionCatalog>();
  const [source, setSource] = useState<PreparedSource>();
  const [result, setResult] = useState<ExecuteResult>();
  const [exportRun, setExportRun] = useState<{
    request: ExecuteRequest;
    result: ExecuteResult;
    token: number;
    epoch: number;
  } | null>(null);
  const [diagnosticFocus, setDiagnosticFocus] = useState<{
    runId: string;
    range: ByteRange;
    request: number;
  }>();
  const workbench = useRef<WorkbenchHandle>(null);
  const [failure, setFailure] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>();
  const [seed, setSeed] = useState<string>(() => crypto.randomUUID());
  const [length, setLength] = useState('0');
  const [random, setRandom] = useState<CaseInput['random']>(null);
  const [preparedInput, setPreparedInput] = useState<CaseInput>();
  const [inputIssues, setInputIssues] = useState<readonly InputIssue[]>([]);
  const [watch, setWatch] = useState<ReturnType<typeof createCaseViewSession> | null>(null);
  const [challengeRun, setChallengeRun] = useState<ChallengeSession | null>(null);
  const [coverage, setCoverage] = useState({ seen: 0, total: 0, complete: false });
  const [viewSave, setViewSave] = useState<
    'incomplete' | 'saving' | 'saved' | 'unsaved' | 'unavailable'
  >('incomplete');
  const watchFact = useRef<VerifiedFact | null>(null);
  const tracePanel = useRef<HTMLElement>(null);
  const initializedFor = useRef<string | undefined>(undefined);
  const session = useRef({
    token: 0,
    contextId: crypto.randomUUID(),
    contextRevision: 1,
    sourceRevision: 1,
  });

  // Credit only a committed view that stayed current through a browser paint.
  // Ticks and seeking alone never count as presenting an execution state.
  useLayoutEffect(() => {
    if (!watch) return;
    let frame = 0;
    let nextFrame = 0;
    const observe = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => {
          const trace = tracePanel.current?.querySelector('[data-testid="trace-view"]');
          const core =
            trace?.querySelector('[data-testid="trace-array"]') ??
            trace?.querySelector('[aria-label="当前变量"]');
          const bounds = core?.getBoundingClientRect();
          const visibleHeight = bounds
            ? Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0)
            : 0;
          const visibleWidth = bounds
            ? Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0)
            : 0;
          if (
            document.visibilityState !== 'visible' ||
            player.getSnapshot().view !== playerSnapshot.view ||
            !bounds ||
            bounds.width <= 0 ||
            bounds.height <= 0 ||
            visibleHeight < Math.min(bounds.height, 160) * 0.75 ||
            visibleWidth < Math.min(bounds.width, 240) * 0.75
          )
            return;
          watch.present(playerSnapshot.view, playerSnapshot.detail);
          setCoverage(watch.progress(playerSnapshot.detail));
        });
      });
    };
    const resize = new ResizeObserver(observe);
    if (tracePanel.current) resize.observe(tracePanel.current);
    observe();
    window.addEventListener('scroll', observe, true);
    window.addEventListener('resize', observe);
    document.addEventListener('visibilitychange', observe);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      resize.disconnect();
      window.removeEventListener('scroll', observe, true);
      window.removeEventListener('resize', observe);
      document.removeEventListener('visibilitychange', observe);
    };
  }, [watch, player, playerSnapshot.view, playerSnapshot.detail]);

  function resetWatch() {
    setChallengeRun(null);
    setWatch(null);
    watchFact.current = null;
    setCoverage({ seen: 0, total: 0, complete: false });
    setViewSave('incomplete');
  }

  useEffect(() => {
    if (learningState.readingStatus === 'loading') return;
    const current = session.current;
    const token = ++current.token;
    const controller = new AbortController();
    let mounted = true;
    void Promise.resolve()
      .then(async () => {
        if (!mounted || current.token !== token) return;
        resetWatch();
        player.invalidate();
        setResult(undefined);
        setExportRun(null);
        setSource(undefined);
        setPreparedInput(undefined);
        const catalog = caseExecutionCatalog(id);
        if (!catalog) throw new Error('E_CONTENT_MISMATCH');
        const { inputSpec, program } = catalog;
        setCatalog(catalog);
        if (initializedFor.current !== id) {
          initializedFor.current = id;
          setDraft(defaultDraft(inputSpec, program.exampleInput));
          setRandom(null);
          setSeed(crypto.randomUUID());
          setInputIssues([]);
          const sequence = inputSpec.fields.find((field) => field.kind === 'sequence');
          setLength(
            String(sequence ? (program.exampleInput[sequence.key] as readonly number[]).length : 0),
          );
        }
        setState('preparing');
        const selected = { values: program.exampleInput, random: null };
        const prepared = await executionClient.prepare(catalog, selected.values);
        if (!mounted || current.token !== token) return;
        setSource(prepared);
        setPreparedInput(selected);
        setState('ready');
      })
      .catch(() => {
        if (mounted && current.token === token) {
          setFailure('执行准备未能完成，请重试。');
          setState('failed');
        }
      });
    const unsubscribe = service.subscribeSessionInvalidation(() => {
      resetWatch();
      ++current.token;
      current.contextId = crypto.randomUUID();
      ++current.contextRevision;
      ++current.sourceRevision;
      executionClient.invalidate();
      player.invalidate();
      setResult(undefined);
      setExportRun(null);
      setSource(undefined);
      setPreparedInput(undefined);
      initializedFor.current = undefined;
      setDraft(undefined);
      setSeed('');
      setLength('0');
      setRandom(null);
      setInputIssues([]);
      setState('invalidated');
      setFailure('本地数据已变更，本次运行已失效。请重新准备。');
    });
    const visibility = () => {
      if (document.visibilityState === 'visible') executionClient.checkDeadline();
      else player.pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted = false;
      ++current.token;
      ++current.contextRevision;
      ++current.sourceRevision;
      controller.abort();
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      executionClient.invalidate();
      player.invalidate();
    };
  }, [
    id,
    attempt,
    service,
    player,
    learningState.readingStatus,
    learningState.reading?.packageRef.id,
    learningState.reading?.packageRef.version,
  ]);

  function invalidateInput() {
    resetWatch();
    const current = session.current;
    ++current.token;
    ++current.contextRevision;
    ++current.sourceRevision;
    executionClient.invalidate();
    player.invalidate();
    setSource(undefined);
    setResult(undefined);
    setExportRun(null);
    setPreparedInput(undefined);
    setFailure('');
    setState('unprepared');
    setInputIssues([]);
  }
  const validation = catalog && draft ? parseInputDraft(catalog.inputSpec, draft) : undefined;
  const issues = [...(validation && !validation.ok ? validation.issues : []), ...inputIssues];

  function generate(newSeed: boolean) {
    if (!catalog) return;
    invalidateInput();
    setRandom(null);
    const selectedSeed = newSeed ? crypto.randomUUID() : seed;
    if (newSeed) setSeed(selectedSeed);
    const hasSequence = catalog.inputSpec.fields.some((field) => field.kind === 'sequence');
    if (
      hasSequence &&
      (length.length > 32 || !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
    ) {
      setInputIssues([
        {
          field: 'length',
          code: 'INPUT_RANDOM_LENGTH',
          message: '随机数组长度必须是允许范围内的整数。',
        },
      ]);
      return;
    }
    try {
      const generated = generateInput(
        catalog.inputSpec,
        selectedSeed,
        hasSequence ? Number(length) : undefined,
      );
      setDraft(defaultDraft(catalog.inputSpec, generated.values));
      setRandom(generated.random);
    } catch (error) {
      setInputIssues(
        error instanceof InputDataError
          ? error.issues
          : [
              {
                field: 'input',
                code: 'INPUT_TYPE',
                message: '输入生成未能完成，请检查种子与长度。',
              },
            ],
      );
    }
  }
  function resetInput() {
    if (!catalog) return;
    invalidateInput();
    setRandom(null);
    setSeed(crypto.randomUUID());
    setDraft(defaultDraft(catalog.inputSpec, catalog.program.exampleInput));
    const sequence = catalog.inputSpec.fields.find((field) => field.kind === 'sequence');
    setLength(
      String(
        sequence ? (catalog.program.exampleInput[sequence.key] as readonly number[]).length : 0,
      ),
    );
  }

  function prepare() {
    if (!catalog || !validation?.ok || inputIssues.length > 0) return;
    const current = session.current;
    const token = ++current.token;
    resetWatch();
    player.invalidate();
    setState('preparing');
    setFailure('');
    setSource(undefined);
    setResult(undefined);
    setExportRun(null);
    setPreparedInput(undefined);
    const selected = structuredClone({ values: validation.values, random });
    void executionClient
      .prepare(catalog, selected.values)
      .then((prepared) => {
        if (current.token === token) {
          setSource(prepared);
          setPreparedInput(selected);
          setState('ready');
        }
      })
      .catch(() => {
        if (current.token === token) {
          setFailure('执行准备未能完成，请重试。');
          setState('failed');
        }
      });
  }

  function run() {
    const triggeredAt = performance.now();
    if (!catalog || !source || !preparedInput) return;
    const current = session.current;
    const token = ++current.token;
    const epoch = learningState.sessionEpoch;
    resetWatch();
    setResult(undefined);
    setExportRun(null);
    setFailure('');
    setState('running');
    const request = caseRequest(catalog, source, current, preparedInput);
    const playerToken = player.begin(request.identity);
    let presented: ExecuteResult | undefined;
    const display = (value: ExecuteResult) => {
      if (current.token !== token || presented === value) return;
      flushSync(() => {
        // A post-render deadline failure can replace a provisional commit.
        // The client's final outcome must also replace the player's reference.
        const loadToken = presented ? player.begin(request.identity) : playerToken;
        player.acceptValidated(loadToken, value);
        presented = value;
        setResult(value);
        setState(value.terminal.status);
      });
    };
    void executionClient.execute(request, catalog, display, triggeredAt).then((final) => {
      display(final);
      if (current.token !== token || service.getState().sessionEpoch !== epoch) return;
      // A provisional render cannot authorize a download; retain only the final boundary.
      if (final.producer === 'rust' && final.trace)
        setExportRun({ request: structuredClone(request), result: final, token, epoch });
      try {
        // The display callback is provisional until execute's last deadline guard passes.
        const viewing = createCaseViewSession(
          catalog,
          request,
          final,
          () => current.token === token && service.getState().sessionEpoch === epoch,
          true,
        );
        setWatch(viewing);
        setCoverage(viewing.progress(player.getSnapshot().detail));
        setChallengeRun(
          createChallengeSession(
            catalog,
            final,
            () => current.token === token && service.getState().sessionEpoch === epoch,
          ),
        );
      } catch {
        setViewSave('unavailable');
      }
    });
  }

  function cancel() {
    if (state === 'preparing') {
      // Preparation can still be fetching/compiling the cold Module. Invalidate
      // its continuation before aborting; a late preparation cannot restore it.
      ++session.current.token;
      executionClient.cancel();
      player.invalidate();
      setSource(undefined);
      setPreparedInput(undefined);
      setResult(undefined);
      setExportRun(null);
      setFailure('');
      setState('cancelled');
      return;
    }
    executionClient.cancel();
  }

  function exportContext(): CaptureContext | null {
    const view = player.getSnapshot().view;
    if (
      !exportRun ||
      exportRun.result !== result ||
      exportRun.token !== session.current.token ||
      exportRun.epoch !== service.getState().sessionEpoch ||
      exportRun.request.subjectRef?.id !== id ||
      exportRun.request.source.text !== source?.text ||
      !view.state ||
      !view.identity ||
      view.identity.runId !== exportRun.result.identity.runId
    )
      return null;
    return {
      kind: 'case',
      title: catalog?.subject.title ?? id,
      observationId: id,
      mode: 'basic',
      request: exportRun.request,
      result: exportRun.result,
      view,
      diagnosticFocus:
        diagnosticFocus?.runId === exportRun.result.identity.runId ? diagnosticFocus.range : null,
    };
  }

  async function confirmView() {
    if (!watch || !coverage.complete || viewSave === 'saving' || viewSave === 'saved') return;
    const epoch = learningState.sessionEpoch;
    const token = session.current.token;
    try {
      const fact = watchFact.current ?? watch.issue();
      watchFact.current = fact;
      setViewSave('saving');
      await service.recordCaseView(fact, epoch);
      if (service.getState().sessionEpoch === epoch && session.current.token === token)
        setViewSave('saved');
    } catch {
      if (service.getState().sessionEpoch === epoch && session.current.token === token)
        setViewSave('unsaved');
    }
  }
  const output = useMemo(
    () =>
      result?.trace?.steps
        .flatMap((step) =>
          step.changes
            .filter((change) => change.op === 'output')
            .map((change) => (change.op === 'output' ? change.append : '')),
        )
        .join('') ?? '',
    [result],
  );
  return (
    <section className="card section-card" data-testid="case-execution" data-state={state}>
      <h2>运行内容样例</h2>
      <p className="notice">
        逐步看完真实运行后，主动确认可获得案例首次观看奖励。浏览、运行和重播本身不会发放奖励。
      </p>
      <p className="muted">
        程序由此浏览器中的 Rust
        解释器执行。代码、输入和轨迹不会上传到执行服务器；网页和课程资源加载需要网络。
      </p>
      <LearningSaveStatus />
      {catalog && draft && (
        <InputPanel
          spec={catalog.inputSpec}
          draft={draft}
          seed={seed}
          length={length}
          issues={issues}
          preparing={state === 'preparing'}
          onPrepare={prepare}
          onField={(key, value) => {
            invalidateInput();
            setDraft((previous) => ({ ...previous, [key]: value }));
            setRandom(null);
          }}
          onSeed={(value) => {
            invalidateInput();
            setSeed(value);
            setRandom(null);
          }}
          onLength={(value) => {
            invalidateInput();
            setLength(value);
            setRandom(null);
          }}
          onGenerate={generate}
          onReset={resetInput}
        />
      )}
      {source && preparedInput && (
        <div data-testid="execution-input">
          <p>
            本次输入：<code>{JSON.stringify(preparedInput.values)}</code>
          </p>
          <p>
            {preparedInput.random ? (
              <>
                随机数据 · {preparedInput.random.generatorRef.id}@
                {preparedInput.random.generatorRef.version} · 种子：
                <code>{preparedInput.random.seed}</code>
              </>
            ) : (
              '手动或示例输入'
            )}
          </p>
        </div>
      )}
      <div className="inline-actions">
        {!source && (
          <button
            className="button button-primary"
            onClick={prepare}
            disabled={!catalog || !validation?.ok || issues.length > 0 || state === 'preparing'}
          >
            准备运行样例
          </button>
        )}
        {source && (
          <button className="button button-primary" onClick={run} disabled={state === 'running'}>
            运行示例
          </button>
        )}
        <button
          className="button button-secondary"
          onClick={cancel}
          disabled={state !== 'running' && !(state === 'preparing' && catalog)}
        >
          取消运行
        </button>
        {['failed', 'invalidated'].includes(state) && (
          <button
            className="button button-secondary"
            onClick={() => {
              player.invalidate();
              setState('preparing');
              setResult(undefined);
              setExportRun(null);
              setSource(undefined);
              setPreparedInput(undefined);
              setFailure('');
              setAttempt((value) => value + 1);
            }}
          >
            重试准备
          </button>
        )}
      </div>
      {!source && (
        <p role={failure ? 'alert' : 'status'}>
          {failure ||
            (state === 'preparing'
              ? '正在读取内容……'
              : state === 'cancelled'
                ? '已取消准备，可以重新准备。'
                : '点击准备运行样例，加载本地执行模块。')}
        </p>
      )}
      {!source && children}
      {source && (
        <div
          className="player-workspace"
          data-testid="player-workspace"
          tabIndex={0}
          aria-label="执行播放工作区"
          onKeyDown={(event) => {
            if (traceVisible.current) player.handleKey(event.nativeEvent);
          }}
        >
          <Workbench
            ref={workbench}
            kind="visualize"
            firstLabel="代码"
            secondLabel="运行画面"
            onSecondVisibility={traceVisibility}
            first={
              <SourcePanel
                diagnosticFocus={
                  diagnosticFocus?.runId === result?.identity.runId ? diagnosticFocus : undefined
                }
                source={source.text}
                nodes={result?.nodeMap ?? []}
                view={playerSnapshot.view}
              />
            }
            second={
              <section
                ref={tracePanel}
                className="workbench-panel"
                data-testid="animation-panel"
                aria-label="运行结果"
              >
                <header className="panel-heading">
                  <h3>当前步骤画面</h3>
                </header>
                <PlayerControls controller={player} snapshot={playerSnapshot} showDetail />
                <BasicTraceView
                  compact={playerSnapshot.detail === 'key'}
                  view={playerSnapshot.view}
                  result={result}
                  input={preparedInput?.values ?? {}}
                  bindings={catalog?.program.bindings ?? []}
                />
                <ExportPanel
                  available={Boolean(
                    exportRun && exportRun.result === result && playerSnapshot.view.state,
                  )}
                  port={{
                    read: exportContext,
                    pause: () => player.pause(),
                    subscribe: player.subscribe,
                  }}
                />
                <ChallengePanel
                  key={challengeRun?.result.identity.runId ?? 'waiting'}
                  session={challengeRun}
                  source={source.text}
                  result={result}
                  player={player}
                  snapshot={playerSnapshot}
                />
                <div className="panel-body" aria-live="polite">
                  <h4>本次完整运行结果</h4>
                  <p
                    data-testid="execution-terminal"
                    role={
                      failure || result?.terminal.status === 'infrastructure-failure'
                        ? 'alert'
                        : 'status'
                    }
                  >
                    {failure ||
                      (result
                        ? labels[result.terminal.status]
                        : state === 'preparing'
                          ? '正在准备执行模块与源码……'
                          : state === 'running'
                            ? '正在执行并检查轨迹……'
                            : '源码已就绪，可以运行。')}
                  </p>
                  {result && (
                    <>
                      <p data-testid="execution-steps">
                        有效轨迹：{result.trace?.steps.length ?? 0} 步
                        {result.trace?.completeness === 'prefix' ? '（未完成的有效前缀）' : ''}
                      </p>
                      {result.terminal.exitCode !== null && (
                        <p>返回值：{result.terminal.exitCode}</p>
                      )}
                      {source && (
                        <DiagnosticPanel
                          diagnostics={result.terminal.diagnostics}
                          source={{ text: source.text, nodes: result.nodeMap }}
                          onLocateSource={(range) => {
                            workbench.current?.reveal('first');
                            setDiagnosticFocus({
                              runId: result.identity.runId,
                              range,
                              request: (diagnosticFocus?.request ?? 0) + 1,
                            });
                          }}
                        />
                      )}
                      <pre
                        className="sample-source"
                        data-testid="execution-output"
                        tabIndex={0}
                        aria-label="程序完整输出"
                      >
                        {output || '（无输出）'}
                      </pre>
                    </>
                  )}
                  <p className="muted">此处是完整运行结果；上方画面对应当前播放步骤。</p>
                </div>
              </section>
            }
          />
        </div>
      )}
      <section
        className="case-view-confirmation"
        data-testid="case-view-confirmation"
        data-view-state={viewSave === 'incomplete' && coverage.complete ? 'ready' : viewSave}
        aria-labelledby="case-view-title"
      >
        <h3 id="case-view-title">确认本次观看</h3>
        <p
          data-testid="case-view-coverage"
          data-covered={coverage.seen}
          data-total={coverage.total}
          aria-live="polite"
        >
          已查看 {coverage.seen} / {coverage.total}{' '}
          {playerSnapshot.detail === 'key' ? '个关键步骤' : '个步骤'}
          {coverage.complete ? '，完整观看已就绪。' : '。请从初始状态逐步前进或播放至结束。'}
        </p>
        <p className="muted">
          请让当前变量或数组画面保持可见。首次确认获得 5
          分。按顺序看完关键步骤即可确认；全部步骤可查看中间细节。暂停和后退保留覆盖；更换输入、重新运行或刷新需重新观看。
        </p>
        <button
          type="button"
          className="button button-primary"
          disabled={
            !coverage.complete ||
            viewSave === 'saving' ||
            viewSave === 'saved' ||
            learningState.status === 'readonly'
          }
          onClick={() => void confirmView()}
        >
          确认已观看
        </button>
        {viewSave === 'saving' && <p role="status">正在保存本次观看……</p>}
        {viewSave === 'saved' && (
          <p role="status">本次观看已保存；同一案例的首次奖励只入账一次。</p>
        )}
        {viewSave === 'unsaved' && (
          <p role="alert">本次观看未保存，积分尚未确认。可再次确认以重试原操作。</p>
        )}
        {viewSave === 'unavailable' && (
          <p role="status">本次运行未满足观看确认条件，不会获得通过奖励。</p>
        )}
      </section>
    </section>
  );
}
