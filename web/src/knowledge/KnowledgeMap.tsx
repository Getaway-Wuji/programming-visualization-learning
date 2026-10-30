import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { StatePanel } from '../components/Ui';
import { paths } from '../navigation';
import { useLearning } from '../learning/react';
import { createKnowledgeMap, projectKnowledgeMap, type KnowledgeMapNode } from './model';
import './knowledge.css';

function edgePath(from: KnowledgeMapNode, to: KnowledgeMapNode) {
  if (from.knowledge.id === 'knowledge.c.variables' && to.knowledge.id === 'knowledge.c.input')
    return `M ${from.x} ${from.y - 32} V 10 H ${to.x} V ${to.y - 32}`;
  if (from.knowledge.id === 'knowledge.c.variables' && to.knowledge.id === 'knowledge.c.arrays')
    return `M ${from.x - 68} ${from.y} H 166 V ${to.y} H ${to.x - 68}`;
  if (from.x === to.x) return `M ${from.x} ${from.y + 32} V ${to.y - 32}`;
  if (from.y === to.y) return `M ${from.x + 68} ${from.y} H ${to.x - 68}`;
  return `M ${from.x} ${from.y + 32} V ${(from.y + to.y) / 2} H ${to.x} V ${to.y - 32}`;
}

export function KnowledgeMap() {
  const { state, service } = useLearning();
  const [selectedId, select] = useState('knowledge.c.entry');
  const result = useMemo(() => {
    if (!state.reading || state.readingStatus !== 'ready') return null;
    try {
      return { map: createKnowledgeMap(state.reading) };
    } catch {
      return { map: null };
    }
  }, [state.reading, state.readingStatus]);
  const view =
    result?.map && state.reading
      ? projectKnowledgeMap(
          result.map,
          state.snapshot,
          state.practiceCatalog ?? state.reading.catalog,
          !!state.recovery?.issues.some((issue) =>
            ['progress', 'aliases', 'receipts'].includes(issue.store),
          ),
        )
      : null;
  const selected = view?.nodes.find((node) => node.knowledge.id === selectedId) ?? view?.nodes[0];
  const lit = view?.nodes.filter((node) => node.state === 'lit').length ?? 0;
  const stateText = (status: string) =>
    status === 'lit' ? '已点亮' : status === 'unknown' ? '待确认' : '未学';
  return (
    <section
      className="knowledge-map"
      aria-labelledby="knowledge-map-title"
      data-testid="knowledge-map"
      data-state={view ? 'ready' : state.readingStatus === 'loading' ? 'loading' : 'failed'}
    >
      <div className="module-title">
        <h2 id="knowledge-map-title">我的知识图谱</h2>
        <span data-testid="knowledge-lit-count">
          {view?.known ? `${lit} / ${view.nodes.length} 已点亮` : '学习记录待确认'}
        </span>
      </div>
      <p className="knowledge-intro">完成相关小节，逐步点亮知识。选择节点，回到课程复习。</p>
      {!view ? (
        <StatePanel
          kind={state.readingStatus === 'loading' ? 'loading' : 'error'}
          title={state.readingStatus === 'loading' ? '正在读取知识图谱' : '知识图谱暂不可用'}
          description="图谱需要可校验的课程配置；已有学习档案会保留。"
        >
          <button className="text-link" type="button" onClick={() => void service.reloadReading()}>
            重新读取课程
          </button>
        </StatePanel>
      ) : (
        <>
          {(state.temporary || state.pendingCount > 0 || !view.known) && (
            <p className="notice" data-testid="knowledge-storage-note">
              {state.temporary || state.pendingCount > 0
                ? '本次有临时或未保存的学习记录，暂不用于点亮。图谱仅显示可确认的已保存完成记录。'
                : '学习记录暂不能完整确认，未知节点显示待确认；已有可确认的完成记录仍会点亮。'}
            </p>
          )}
          <div className="knowledge-layout">
            <div className="knowledge-overview">
              <label className="knowledge-mobile-picker">
                选择知识点
                <select
                  value={selected?.knowledge.id}
                  onChange={(event) => select(event.target.value)}
                >
                  {view.nodes.map((node) => (
                    <option key={node.knowledge.id} value={node.knowledge.id}>
                      {node.label} · {stateText(node.state)}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="knowledge-scroll"
                tabIndex={0}
                role="region"
                aria-label="知识关系图，可横向滚动"
              >
                <div className="knowledge-canvas">
                  <svg viewBox="0 0 708 360" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <marker
                        id="knowledge-arrow"
                        viewBox="0 0 6 6"
                        refX="5"
                        refY="3"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 6 3 L 0 6 z" fill="context-stroke" />
                      </marker>
                    </defs>
                    {view.edges.map((edge) => (
                      <path
                        key={`${edge.from}:${edge.to}`}
                        data-knowledge-edge={`${edge.from}:${edge.to}`}
                        data-lit={edge.lit ? 'yes' : 'no'}
                        className="knowledge-edge"
                        d={edgePath(
                          view.nodes.find((node) => node.knowledge.id === edge.from)!,
                          view.nodes.find((node) => node.knowledge.id === edge.to)!,
                        )}
                        markerEnd="url(#knowledge-arrow)"
                      />
                    ))}
                  </svg>
                  {view.nodes.map((node) => (
                    <button
                      key={node.knowledge.id}
                      type="button"
                      className="knowledge-node"
                      data-knowledge-node={node.knowledge.id}
                      data-state={node.state}
                      aria-pressed={selected?.knowledge.id === node.knowledge.id}
                      aria-controls="knowledge-detail"
                      onClick={() => select(node.knowledge.id)}
                      style={
                        {
                          '--node-x': `${(node.x / 708) * 100}%`,
                          '--node-y': `${(node.y / 360) * 100}%`,
                        } as CSSProperties
                      }
                    >
                      <strong>{node.label}</strong>
                      <span>
                        {stateText(node.state)}
                        {node.state !== 'unknown' &&
                          ` · ${node.completed.length}/${node.lessons.length} 节`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="knowledge-key">
                <span className="knowledge-key-lit">实线：两端已点亮</span>
                <span>虚线：先修关系待点亮</span>
              </p>
              <p className="muted knowledge-rule">
                箭头由先修指向后继。点亮表示已有相关小节完成记录，不代表全部掌握；先修关系不限制课程访问。
              </p>
            </div>
            {selected && (
              <div
                className="knowledge-detail"
                id="knowledge-detail"
                data-testid="knowledge-detail"
                aria-live="polite"
                aria-atomic="true"
              >
                <div className="module-title">
                  <h3>{selected.knowledge.title}</h3>
                  <span>{stateText(selected.state)}</span>
                </div>
                <p>{selected.description}</p>
                <p className="muted">
                  建议先修：
                  {selected.knowledge.prerequisiteRefs.length
                    ? selected.knowledge.prerequisiteRefs
                        .map(
                          (ref) => view.nodes.find((node) => node.knowledge.id === ref.id)!.label,
                        )
                        .join('、')
                    : '无，从这里开始'}
                </p>
                <h4>
                  关联课程 ·{' '}
                  {view.known || selected.state === 'lit'
                    ? `已完成 ${selected.completed.length}/${selected.lessons.length} 节`
                    : '完成记录待确认'}
                </h4>
                <ul className="knowledge-lessons">
                  {selected.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <Link to={paths.lesson(lesson.id)}>
                        <span>{lesson.title}</span>
                        <span>{view.completedIds.has(lesson.id) ? '复习' : '学习'} →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
