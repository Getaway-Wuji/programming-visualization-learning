import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { MissingPage } from '../components/Ui';
import { DebugSource } from '../debug/DebugSource';
import { CustomCodeController } from '../custom-code/controller';
import { visualModules, type VisualSpec } from './catalog';
import { parseVisualInput, type VisualDraft } from './input';
import { LabState } from './StateView';
import './lab.css';

const sources = import.meta.glob('../../../content/algorithms/visual-lab/*.cpp', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
export default function VisualLab() {
  const { slug } = useParams();
  const spec = visualModules.find((s) => s.slug === slug);
  return spec ? (
    <Lab key={spec.slug} spec={spec} />
  ) : (
    <MissingPage backTo="/cases" backLabel="返回算法目录" />
  );
}
function Lab({ spec }: { spec: VisualSpec }) {
  const [controller] = useState(() => new CustomCodeController(undefined, true));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [draft, setDraft] = useState<VisualDraft>(() => ({ ...spec.defaults }));
  const source = sources[`../../../content/algorithms/visual-lab/${spec.slug}.cpp`];
  const parsed = useMemo(() => parseVisualInput(spec, draft), [spec, draft]);
  const busy = snap.status === 'running';
  useEffect(() => {
    const input = parseVisualInput(spec, spec.defaults);
    void controller.execute(source, 'cpp', input.values);
    return () => controller.invalidate();
  }, [controller, source, spec]);
  const change = (key: string, value: string) => {
    controller.invalidate();
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  function randomize() {
    controller.invalidate();
    const value = () => Math.floor(Math.random() * 20);
    const next = { ...spec.defaults };
    if ('values' in next) {
      const a = Array.from({ length: spec.kind === 'tree' ? 7 : 8 }, value);
      if (['binary', 'block'].includes(spec.slug)) a.sort((a, b) => a - b);
      next.values = a.join(' ');
      if ('target' in next) next.target = String(a[Math.floor(Math.random() * a.length)]);
    } else if (spec.inputKind === 'strings') {
      next.text = Array.from({ length: 7 }, () => 'abc'[Math.floor(Math.random() * 3)]).join('');
      next.pattern = next.text.slice(2, 5);
    } else if (spec.inputKind === 'operations') {
      next.operations = `入 ${value()}\n入 ${value()}\n出\n入 ${value()}\n出`;
    } else if (spec.inputKind === 'scalar')
      next.number = String(1 + Math.floor(Math.random() * (spec.slug === 'hanoi' ? 4 : 10)));
    else if (spec.inputKind === 'graph')
      next.edges = next.edges
        .split('\n')
        .map((line) => line.replace(/\d+$/, String(1 + Math.floor(Math.random() * 9))))
        .join('\n');
    else if (spec.inputKind === 'knapsack')
      next.items = next.items
        .split('\n')
        .map((line) => line.replace(/\d+$/, String(1 + value())))
        .join('\n');
    else if (spec.inputKind === 'trie') {
      next.words = 'ab ac abc';
      next.pattern = ['ab', 'ac', 'bc'][Math.floor(Math.random() * 3)];
    } else if (spec.inputKind === 'unions')
      next.operations = `合 0 ${1 + Math.floor(Math.random() * 4)}\n合 1 2\n查 2`;
    setDraft(next);
    const input = parseVisualInput(spec, next);
    if (!input.issue) void controller.execute(source, 'cpp', input.values);
  }
  const range =
    snap.result?.terminal.status !== 'completed' && snap.view.cursor === snap.view.length
      ? (snap.result?.terminal.byteRange ?? snap.view.byteRange)
      : snap.view.byteRange;
  const fields: {
    key: string;
    label: string;
    hint?: string;
    multiline?: boolean;
    options?: { value: string; label: string }[];
  }[] = [];
  if ('values' in spec.defaults)
    fields.push({
      key: 'values',
      label: spec.kind === 'tree' ? '节点值' : '数据',
      hint:
        spec.kind === 'tree'
          ? '最多 7 项整数，用空格分隔；空序列写 []。'
          : spec.slug === 'counting'
            ? '最多 12 项，取值 0～20。'
            : spec.slug === 'radix'
              ? '最多 12 项，取值 0～999。'
              : ['binary', 'block'].includes(spec.slug)
                ? '最多 12 项，按从小到大排列。'
                : '最多 12 项，取值 −99～99；空序列写 []。',
    });
  if ('target' in spec.defaults) fields.push({ key: 'target', label: '查找目标' });
  if (spec.inputKind === 'array')
    fields.push(
      {
        key: 'action',
        label: '操作',
        options: [
          { value: '1', label: '插入' },
          { value: '2', label: '删除' },
          { value: '3', label: '反转' },
          ...(spec.slug === 'array' ? [{ value: '4', label: '查找' }] : []),
        ],
      },
      ...(!['3', '4'].includes(draft.action)
        ? [{ key: 'position', label: '位置（从 0 开始）' }]
        : []),
      ...(['1', '4'].includes(draft.action)
        ? [{ key: 'value', label: draft.action === '4' ? '查找值' : '插入值' }]
        : []),
    );
  if (spec.inputKind === 'traversal')
    fields.push({
      key: 'order',
      label: '遍历顺序',
      options: [
        { value: '1', label: '先序' },
        { value: '2', label: '中序' },
        { value: '3', label: '后序' },
      ],
    });
  if ('number' in spec.defaults)
    fields.push({
      key: 'number',
      label:
        spec.inputKind === 'graph'
          ? '节点数'
          : spec.inputKind === 'unions'
            ? '元素数'
            : spec.slug === 'hanoi'
              ? '盘子数（0～5）'
              : '台阶数（0～12）',
    });
  if ('operations' in spec.defaults)
    fields.push({
      key: 'operations',
      label: '操作序列',
      multiline: true,
      hint:
        spec.inputKind === 'unions'
          ? '每行写“合 0 1”或“查 2”，最多 8 次。'
          : '每行写“入 7”或“出”，最多 12 次；容量 8。',
    });
  if (spec.inputKind === 'graph')
    fields.push(
      {
        key: 'edges',
        label: '边',
        multiline: true,
        hint: `每行写“起点 终点 权重”，节点从 0 开始，权重 1～9，最多 8 条；${['topological', 'floyd'].includes(spec.slug) ? '有向图' : '无向图'}。`,
      },
      ...(['bfs-dfs', 'dijkstra', 'prim'].includes(spec.slug)
        ? [{ key: 'start', label: '起始节点' }]
        : []),
      ...(spec.slug === 'bfs-dfs'
        ? [
            {
              key: 'order',
              label: '遍历方式',
              options: [
                { value: '1', label: 'BFS 广度优先' },
                { value: '2', label: 'DFS 深度优先' },
              ],
            },
          ]
        : []),
    );
  if (spec.inputKind === 'strings')
    fields.push(
      {
        key: 'text',
        label: spec.slug === 'kmp' ? '文本' : '字符串 A',
        hint: '最多 8 个小写英文字母。',
      },
      { key: 'pattern', label: spec.slug === 'kmp' ? '匹配串' : '字符串 B' },
    );
  if (spec.inputKind === 'trie')
    fields.push(
      {
        key: 'words',
        label: '单词',
        hint: '使用 a、b、c，空格分隔，最多 3 个单词，共 12 个字母。',
      },
      { key: 'pattern', label: '查询前缀 / 单词' },
    );
  if (spec.inputKind === 'knapsack')
    fields.push(
      { key: 'capacity', label: '容量（0～8）' },
      {
        key: 'items',
        label: '物品',
        multiline: true,
        hint: '每行写“重量 价值”，最多 4 种；重量 1～8，价值 0～99。',
      },
    );
  return (
    <div className="visual-lab" data-testid="visual-lab" data-module={spec.slug}>
      <div className="lab-title-row">
        <div>
          <Link className="text-link" to="/cases">
            ← 算法目录
          </Link>
          <h1>{spec.title}</h1>
          <p>{spec.description}</p>
        </div>
        <span className="muted">{spec.complexity}</span>
      </div>
      <form
        className="card lab-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed.issue) void controller.execute(source, 'cpp', parsed.values);
        }}
      >
        <div className="lab-fields">
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.options ? (
                <select
                  aria-label={field.label}
                  value={draft[field.key]}
                  onChange={(e) => change(field.key, e.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.multiline ? (
                <textarea
                  aria-label={field.label}
                  value={draft[field.key]}
                  rows={3}
                  spellCheck={false}
                  onChange={(e) => change(field.key, e.target.value)}
                />
              ) : (
                <input
                  aria-label={field.label}
                  value={draft[field.key]}
                  spellCheck={false}
                  onChange={(e) => change(field.key, e.target.value)}
                />
              )}{' '}
              {field.hint && <small>{field.hint}</small>}
            </label>
          ))}
        </div>
        {parsed.issue && <p role="alert">{parsed.issue}</p>}
        <div className="inline-actions">
          <button className="button button-primary" disabled={busy || !!parsed.issue} type="submit">
            {busy ? '正在运行…' : '运行'}
          </button>
          <button className="button button-secondary" type="button" onClick={randomize}>
            随机数据
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              controller.invalidate();
              setDraft({ ...spec.defaults });
              void controller.execute(source, 'cpp', parseVisualInput(spec, spec.defaults).values);
            }}
          >
            恢复示例
          </button>
          {busy && (
            <button type="button" className="button" onClick={() => controller.cancel()}>
              取消
            </button>
          )}
        </div>
      </form>
      {snap.status === 'failed' && <p role="alert">运行未完成，请重试。{snap.error}</p>}
      {snap.result && snap.result.terminal.status !== 'completed' && (
        <p role="alert">
          程序未能完成：{snap.result.terminal.code ?? snap.result.terminal.status}
          。请检查输入后重试。
        </p>
      )}
      <div
        className="lab-workspace"
        tabIndex={0}
        aria-label="算法播放工作区"
        onKeyDown={(e) => {
          if (
            (e.target as HTMLElement).closest('input,textarea,select,button,a') ||
            e.ctrlKey ||
            e.altKey ||
            e.metaKey
          )
            return;
          if (e.code === 'Space') {
            e.preventDefault();
            controller.toggle();
          } else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            controller.step(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        <section className="card lab-stage" aria-label="算法动画">
          <p className="lab-step-caption" role="status">
            {snap.swap
              ? '交换两个元素'
              : snap.view.cursor === snap.startCursor
                ? '点击播放，或用下一步逐步观察。'
                : ((
                    {
                      condition: '比较当前条件',
                      'value.write': '更新数据',
                      'pointer.write': '更新连接',
                      'value.initialize': '设置初始值',
                      'output.append': '输出结果',
                      'function.enter': '进入函数',
                      'function.return': '返回上一层',
                      'program.return': '本次演示完成',
                      'input.read': '读取输入',
                    } as Record<string, string>
                  )[snap.view.stepKind ?? ''] ?? '执行当前语句')}
          </p>
          <LabState
            spec={spec}
            state={snap.view.state}
            result={snap.result}
            cursor={snap.view.cursor}
            changeStart={snap.swap?.start}
            draft={draft}
          />
          <div className="lab-transport">
            <button
              className="button button-small"
              disabled={snap.view.cursor <= snap.startCursor}
              onClick={() => controller.seek(snap.startCursor)}
            >
              重置
            </button>
            <button
              className="button button-small"
              disabled={snap.view.cursor <= snap.startCursor}
              onClick={() => controller.step(-1)}
            >
              上一步
            </button>
            <button
              className="button button-primary button-small"
              disabled={!snap.view.state || snap.view.cursor >= snap.endCursor}
              onClick={() => controller.toggle()}
            >
              {snap.view.playing ? '暂停' : '播放'}
            </button>
            <button
              className="button button-small"
              disabled={!snap.view.state || snap.view.cursor >= snap.endCursor}
              onClick={() => controller.step(1)}
            >
              下一步
            </button>
            <label>
              速度
              <select
                aria-label="播放速度"
                value={snap.rate}
                onChange={(e) => controller.setRate(Number(e.target.value))}
              >
                {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="lab-progress">
            进度 {snap.keyPosition} / {snap.keyLength}
            <input
              aria-label="播放进度"
              type="range"
              min="0"
              max={snap.keyLength}
              value={snap.keyPosition}
              disabled={!snap.view.state}
              onChange={(e) => controller.seekDisplay(Number(e.target.value))}
            />
          </label>
        </section>
        <section className="card lab-code memory-source">
          <h2>C++ 代码</h2>
          <DebugSource
            source={source}
            byteRange={snap.view.cursor === snap.startCursor ? null : (range ?? null)}
            breakpoints={snap.breakpoints}
            visitedLines={snap.visitedLines}
            ready={!!snap.result}
            onToggle={(line) => controller.toggleBreakpoint(line)}
          />
        </section>
      </div>
    </div>
  );
}
