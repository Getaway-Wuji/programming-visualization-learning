import{readFileSync,writeFileSync}from'node:fs';
let s=readFileSync('web/src/structures/StructurePage.tsx','utf8');
for(const [a,b]of Object.entries({parseOperations:'parseNodeOperations',prepareStructure:'prepareNodeCase',structureCases:'nodeCases',structureCase:'nodeCase',structureCatalog:'nodeCatalog',StructureCase:'NodeCase',StructureWorkspace:'NodeCaseWorkspace',StructurePage:'NodeCasePage',StructureController:'NodeCaseController',structureExplanation:'nodeExplanation',structureId:'nodeCaseId'}))s=s.replaceAll(a,b);
s=s.replace("import { StructureState } from './StructureState';",`import { NodeGraph } from './NodeGraph';
import { MemoryPanel } from '../memory/MemoryPanel';
import { StackPanel } from '../stack/StackPanel';
import { projectMemoryStep } from '../engine/memory-protocol';
import '../memory/memory.css';`);
s=s.replace("import './structures.css';","import './nodes.css';");
s=s.replaceAll('structure-','node-').replaceAll('/structures/','/nodes/');
s=s.replace("const [draft, setDraft] = useState(spec.defaultDraft),","const [mode, setMode] = useState<'graph'|'memory'|'stack'>('graph');\n  const [draft, setDraft] = useState(spec.defaultDraft),");
s=s.replace('const completeOutput = useMemo(',`const previous = useMemo(() => view.state && result?.trace && view.cursor > 0 ? projectMemoryStep(view.state,result.trace.steps[view.cursor-1],result.types,true) : null,[view,result]);\n  const completeOutput = useMemo(`);
const helpStart=s.indexOf('        <p id="node-input-help">'),helpEnd=s.indexOf('        </p>',helpStart)+12;
s=s.slice(0,helpStart)+`        <p id="node-input-help">每行：{spec.syntax}。参数−999～999；空行忽略，空序列写[]，编码总计最多30整数槽。链表插占3槽/删2槽/遍历1槽，BST插查各2槽/遍历1槽。容量7，空满/位置/重复由C++实际处理；修改输入撤销旧运行，观察不计课程或积分。</p>`+s.slice(helpEnd);
s=s.replaceAll('运行C++操作','运行C++节点操作').replaceAll('结构边界样例','节点边界样例').replaceAll('结构操作序列','节点操作序列').replaceAll('结构播放控制','节点播放控制').replaceAll('结构播放速度','节点播放速度').replaceAll('结构执行步骤','节点执行步骤').replaceAll('数据结构执行观察','动态节点执行观察').replaceAll('结构观察','节点观察').replaceAll('可复制的完整结构C++源码','可复制的完整节点C++源码');
s=s.replace('                <StructureState view={view} result={result} spec={spec} />',`                <div className="step-counters">{Object.entries(view.state.counters).map(([key,value])=><span key={key}>{{comparisons:'比较',scalarWrites:'变量写入',arrayWrites:'数组写入',swaps:'交换'}[key]} <strong data-testid={\`node-counter-\${key}\`}>{value}</strong></span>)}</div>
                <p className="muted">计数含初始化和同值写，不把没有cell差异当作没赋值。</p>
                <label>当前视图 <select aria-label="节点观察视图" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="graph">节点连接</option><option value="memory">内存对象</option><option value="stack">调用栈</option></select></label>
                {mode==='graph'?<NodeGraph state={view.state} result={result} spec={spec} step={view.cursor?result.trace!.steps[view.cursor-1]:null}/>:mode==='memory'?<MemoryPanel state={view.state} previous={previous} result={result}/>:<StackPanel state={view.state} previous={previous} result={result} source={source} cursor={view.cursor}/>}
                <h3>当前实际输出</h3><pre className="node-output" tabIndex={0} aria-label="当前节点程序输出" data-testid="node-output">{view.state.output||'（无输出）'}</pre>`);
s=s.replace('FULL/EMPTY仍表示对应操作被实际拒绝。','FULL/RANGE/DUP表示对应操作被实际拒绝，MISS表示未找到。');
s=s.replace('先给出合法操作序列并运行，再核对真实物理槽与有效项。','先输入合法操作序列并运行，再核对真实节点、指向关系和对象生命周期。');
s=s.replace('本例没有挑战、双算法对比或快照导出','本例没有挑战、双算法对比或快照导出');
s=s.replace('切换栈与队列案例','切换链表与BST案例').replace('找不到这个结构案例','找不到这个节点案例');
writeFileSync('web/src/node-cases/NodeCasePage.tsx',s,{flag:'wx'});
let p='web/src/App.tsx',t=readFileSync(p,'utf8');t=t.replace("const StructurePage = lazy(() => import('./structures/StructurePage'));","const StructurePage = lazy(() => import('./structures/StructurePage'));\nconst NodeCasePage = lazy(() => import('./node-cases/NodeCasePage'));");t=t.replace('<Route path="structures/:structureId" element={<StructurePage />} />','<Route path="structures/:structureId" element={<StructurePage />} />\n          <Route path="nodes/:nodeCaseId" element={<NodeCasePage />} />');writeFileSync(p,t);
p='web/src/components/Layout.tsx';t=readFileSync(p,'utf8').replaceAll("location.pathname.startsWith('/structures/')","location.pathname.startsWith('/structures/') || location.pathname.startsWith('/nodes/')");writeFileSync(p,t);
p='web/src/pages/CatalogPages.tsx';t=readFileSync(p,'utf8').replace("import { StructureCatalog } from '../structures/StructureCatalog';","import { StructureCatalog } from '../structures/StructureCatalog';\nimport { NodeCaseCatalog } from '../node-cases/NodeCaseCatalog';");t=t.replace('<StructureCatalog />','<StructureCatalog />\n      <NodeCaseCatalog />');writeFileSync(p,t);
console.log('Node workspaces and necessary three shared entry points created.');
