/* Design-only artifact. All program/data examples are fixed illustrations; no C execution or learning storage. */
"use strict";
const design = window.P05_DESIGN;
const params = new URLSearchParams(location.search);
const state = {
  preset: design.themes[params.get("theme")] ? params.get("theme") : "minimal",
  mode: ["light", "dark", "system"].includes(params.get("mode")) ? params.get("mode") : null,
  count: [7, 15, 30].includes(Number(params.get("n"))) ? Number(params.get("n")) : 7,
  pane: "result", blockMode: false, themeOverrides: Object.fromEntries(Object.keys(design.themes).map(id=>[id,{accentColor:null}])), navCollapsed:false, menuOpen:false, focus:false, ratios:{practice:50,visualize:35,review:35},
  draft: '#include <stdio.h>\n\nint main(void) {\n  int x = 7; // 输入由平台绑定\n\n  // 在这里编写你的解答\n\n  return 0;\n}',
};
state.mode ??= design.themes[state.preset].defaultMode;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  courses: '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16"/>',
  lesson: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
  practice: '<path d="m8 6-5 6 5 6M16 6l5 6-5 6M14 3l-4 18"/>',
  visualize: '<path d="M4 20V9h4v11M10 20V4h4v16M16 20v-8h4v8"/>',
  review: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6M12 8v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l1-3 3-1 2-3-2-2 1-3-3-2-1-3z"/>',
  done: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.lesson}</svg>`;
const screens = [
  ["home","学习首页"], ["courses","C 语言课程"], ["lesson","课程小节"], ["practice","独立练习"], ["visualize","算法演示"], ["review","执行复盘"], ["settings","外观设置"],
];
const chapters = ["程序入门与输出","变量与程序状态","表达式与逻辑","条件与分支","循环与重复","一维数组基础","数组问题求解","排序与搜索入门"];
let active = location.hash.slice(1);
if (!screens.some(([key]) => key === active)) active = "home";
state.pane = active === "practice" ? "code" : "result";
function notify(message) {
  const el = $("#notice"); el.textContent = message; el.hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.hidden = true; }, 4000);
}
function luminance(hex) {
  const rgb = [1,3,5].map((i) => parseInt(hex.slice(i,i+2),16)/255).map((v) => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function contrast(a,b) { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
function accessibleAccent(requested, palette, dark) {
  const base = requested.toUpperCase(); const target = dark ? "#FFFFFF" : "#000000";
  for(let step=0; step<=100; step++) {
    const t=step/100;
    const color="#"+[1,3,5].map((i)=>Math.round(parseInt(base.slice(i,i+2),16)*(1-t)+parseInt(target.slice(i,i+2),16)*t).toString(16).padStart(2,"0")).join("").toUpperCase();
    if([palette.surface,palette.raised,palette.ground].every((bg)=>contrast(color,bg)>=4.5)) return color;
  }
  return target;
}
function applyTheme() {
  const dark = state.mode === "dark" || (state.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const theme=design.themes[state.preset], palette=theme[dark?"dark":"light"];
  const accent=accessibleAccent(state.themeOverrides[state.preset].accentColor || palette.accent,palette,dark);
  Object.entries(palette).forEach(([key,value])=>document.documentElement.style.setProperty(`--${key}`,value));
  document.documentElement.style.setProperty("--accent",accent);
  const rawAccent=state.themeOverrides[state.preset].accentColor || palette.accent;
  document.documentElement.style.setProperty("--accent-raw",rawAccent);
  document.documentElement.style.setProperty("--material-on",contrast(rawAccent,"#FFFFFF")>=contrast(rawAccent,"#000000")?"#FFFFFF":"#000000");
  document.documentElement.style.setProperty("--accent-on",contrast(accent,"#FFFFFF")>=contrast(accent,"#000000")?"#FFFFFF":"#000000");
  document.documentElement.style.setProperty("--radius",`${theme.panelRadius}px`);
  document.documentElement.style.setProperty("--control-radius",`${theme.controlRadius}px`);
  document.documentElement.style.setProperty("--row-pad",`${theme.density==="relaxed"?20:theme.density==="compact"?12:16}px`);
  document.documentElement.style.colorScheme=dark?"dark":"light";
  document.documentElement.dataset.theme=state.preset;
  document.documentElement.dataset.mode=dark?"dark":"light";
  if($("#custom-accent"))$("#custom-accent").value=state.themeOverrides[state.preset].accentColor || palette.accent;
}
function heading(title, subtitle, actions="", back="") {
  return `${back?`<a class="back-link" href="${back}">← 返回课程</a>`:""}<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${actions?`<div class="heading-actions">${actions}</div>`:""}</div>`;
}
function codeView(source, marked=-1) {
  return `<div class="code" aria-label="固定示例 C 代码">${source.split("\n").map((line,index)=>`<div class="code-line ${index===marked?"marked":""}"><span class="line-no" aria-hidden="true">${index+1}</span><code>${esc(line)}</code></div>`).join("")}</div>`;
}
const bubbleCode = '#include <stdio.h>\n\nint main(void) {\n  int values[7] = {7, 3, 5, 3, 9, 1, 6};\n  int n = 7;\n  for (int end = n - 1; end > 0;\n       end = end - 1) {\n    for (int j = 0; j < end; j = j + 1) {\n      if (values[j] > values[j + 1]) {\n        int temp = values[j];\n        values[j] = values[j + 1];\n        values[j + 1] = temp;\n      }\n    }\n  }\n  return 0;\n}';
function fixedArray(n) { return [7,3,5,3,9,1,6,4,8,2,6,9,3,1,5,8,4,7,2,9,5,6,3,8,1,4,7,9,2,5].slice(0,n); }
function chart(n) {
  const values=fixedArray(n);
  return `<div class="array-stage ${n>15?"dense":""}" aria-label="${n}项原始数组，全量概览"><div class="bar-chart" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${values.map((v,i)=>`<div class="bar-unit ${i===0?"selected":""}" aria-label="下标${i}，值${v}"><span class="bar-value">${v}</span><span class="bar-mark" style="--bar-height:${v/10*80}%"></span><span class="bar-index">${i}</span></div>`).join("")}</div><div class="stage-caption"><span>下标从 0 开始 · 当前选择 values[0] = 7</span><span>共 ${n} 项</span></div></div>`;
}
function mobileTabs() { return `<div class="mobile-tabs" role="group" aria-label="工作区区域"><button data-pane="code" aria-pressed="${state.pane==="code"}">代码</button><button data-pane="result" aria-pressed="${state.pane==="result"}">可视化 / 反馈</button></div>`; }
function visualize(review=false) {
  const title=review?"执行复盘":"冒泡排序";
  const displayedCode = bubbleCode.replace('int values[7] = {7, 3, 5, 3, 9, 1, 6};',`int values[${state.count}] = {${fixedArray(state.count).join(', ')}};`).replace('int n = 7;',`int n = ${state.count};`);
  return heading(title,review?"复盘布局示意 · 正式产品只显示同题当前接受的真实轨迹。":"相邻比较，把较大的元素逐步移动到右侧。",'<button id="focus-toggle">专注模式</button><button id="expand-array">展开可视化</button>')+
    mobileTabs()+`<div class="workbench" id="workbench" data-pane="${state.pane}">
      <section class="panel code-pane"><div class="panel-head"><h2>C 代码</h2><span class="badge">固定初始场景</span></div>${codeView(displayedCode,3)}<div class="code-foot">执行时，高亮会跟随当前语句。</div></section>
      <button class="separator" aria-label="调整代码区域宽度" title="使用左右方向键调整宽度"></button>
      <section class="panel trace-pane"><div class="panel-head"><h2>数组可视化</h2><span class="badge">尚未运行</span></div><div class="trace-top"><span class="meta">原始输入 · 全量概览</span><label class="visually-hidden" for="array-count">示例长度</label><select id="array-count"><option value="7">7 项</option><option value="15">15 项</option><option value="30">30 项</option></select></div>${chart(state.count)}<dl class="trace-summary"><div><dt>当前游标</dt><dd>初始状态</dd></div><div><dt>比较次数</dt><dd>0</dd></div><div><dt>交换次数</dt><dd>0</dd></div></dl><p class="trace-note">观察两个相邻元素：左边更大就交换，否则保持顺序。每轮结束，最大的未排序元素移动到右侧。</p></section>
    </div><div class="controls-bar"><button class="primary" data-demo="真实播放将消费 Rust 轨迹；设计稿保持固定初始状态。">开始播放</button><button data-demo="正式产品在接受轨迹后支持前后单步与完整恢复。">← 上一步</button><button data-demo="正式产品在接受轨迹后支持前后单步与完整恢复。">下一步 →</button><label class="visually-hidden" for="cursor">执行游标</label><input id="cursor" type="range" min="0" max="100" value="0" aria-label="游标布局示意"><span class="meta">空格播放 · ← / → 单步</span></div>
    <div class="state-grid"><section class="panel"><div class="panel-head"><h2>当前变量</h2><span class="meta">随游标同步</span></div><div class="panel-body"><dl class="state-list"><div><dt>n</dt><dd>${state.count}</dd></div><div><dt>end</dt><dd>尚未声明</dd></div><div><dt>j</dt><dd>尚未声明</dd></div></dl></div></section><section class="panel"><div class="panel-head"><h2>程序输出</h2><span class="meta">标准输出</span></div><div class="output">程序尚未开始，没有输出。</div></section></div>`;
}
function practice() {
  return heading("两倍加三","独立练习 · 用变量 x 计算 2 × x + 3，并输出结果。",'<button data-demo="正式产品在覆盖当前解答前说明重置范围；此设计稿不替换你的草稿。">重置解答</button>',"#lesson")+
    `<div class="intro-box"><p>输入为 −999 到 999 的整数。结果独占一行，末尾换行。你可以直接编写代码，也可以选择积木辅助。</p><span class="meta">教学目标：结果实际依赖输入，包含有效的乘法和加法；完整测试通过后才记完成。</span></div>`+
    mobileTabs()+`<div class="workbench practice" id="workbench" data-pane="${state.pane}"><section class="panel code-pane"><div class="panel-head"><h2>你的解答</h2><span class="badge">尚未提交</span></div><div class="tab-row" role="tablist" aria-label="作答形式"><button id="code-tab" role="tab" aria-selected="${!state.blockMode}">写代码</button><button id="blocks-tab" role="tab" aria-selected="${state.blockMode}">积木辅助</button></div>${state.blockMode?'<div class="empty-blocks"><div class="block-main">主程序 int main</div><div class="block-slot">空解答区：连接你的运算和输出</div><div class="block-end">结束并返回 0</div></div>':`<textarea id="answer" class="editor" spellcheck="false" aria-label="设计预览中的代码草稿">${esc(state.draft)}</textarea>`}<details class="helper"><summary>键盘与精确编辑</summary><p>正式实现中提供同一工作区的逐块选择、字段与连接操作，默认折叠。</p></details></section><button class="separator" aria-label="调整解答区域宽度"></button><section class="panel trace-pane"><div class="panel-head"><h2>判题反馈</h2><span class="badge">等待提交</span></div><div class="panel-body"><h3>从自己的思路开始</h3><p class="meta" style="margin-top:8px">这里没有预填解题代码。提交后，将逐项说明输出与教学目标是否满足。</p><div class="section-title"><h3>测试范围</h3><span class="meta">3 组</span></div><div class="test-row"><span>正数：x = 7</span><span>待测试</span></div><div class="test-row"><span>零：x = 0</span><span>待测试</span></div><div class="test-row"><span>负数：x = −9</span><span>待测试</span></div><div class="section-title"><h3>小节完成条件</h3></div><ul class="checklist"><li><span class="checkmark">○</span><span>确认已学习本节内容</span></li><li><span class="checkmark">○</span><span>必修题全部测试和教学目标通过</span></li></ul><button class="quiet-button" data-demo="提示按概念、思路、局部结构分层展开，不会直接填入答案。">需要一点提示 →</button></div></section></div><div class="controls-bar"><button data-demo="只运行当前输入用于观察；运行成功不等于全部测试通过。">运行当前输入</button><button class="primary" data-demo="正式产品会运行全部测试并检查教学目标；该设计稿不会判题或发放积分。">提交并判题</button><span class="meta">代码变化后，上次运行和判题结果立即失效。</span></div>`;
}
function progressRing(value,total,label) {
 const pct=Math.round(value/total*100);
 return `<div class="progress-dial" style="--progress:${pct}%" role="img" aria-label="${label}：${value}/${total}"><div><strong>${value}<small> / ${total}</small></strong><span>${label}</span></div></div>`;
}
function home() {
 const sample=design.sampleLearning, remaining=sample.lessonTotal-sample.completedLessons;
 const intro={minimal:['今天，读懂一段新代码。','从表达式到程序逻辑，一次只学会一个小概念。'],cute:['让灵感，慢慢发芽。','一个小问题，一次新发现。今天也和代码更熟悉一点。'],glass:['给思考，留一张书桌。','接着上次的理解，轻松走进下一个知识点。'],soft:['把知识，握在手里。','读一读，试一试。让抽象的程序变得有迹可循。'],cool:['把每一步，点亮。','在代码与数据之间，找到程序运行的方向。'],tech:['留一点时间，理解新概念。','安静地学习，也清楚地看见自己的每一步。']}[state.preset];
 const lessons=[['01','程序入门与输出','认识第一个 C 程序','已完成'],['02','变量与程序状态','让程序记住一个值','已完成'],['03','表达式与逻辑','把输入变成你想要的结果','正在学习'],['04','条件与分支','让程序学会做选择','待探索']];
 const symbol=`<div class="concept-object" aria-hidden="true"><span class="concept-brace">{</span><div><i></i><i></i><i></i></div><span class="concept-brace">}</span></div>`;
 return `<div class="home-heading"><div><p class="page-kicker">你的 C 语言学习空间</p><h1>${intro[0]}</h1><p>${intro[1]}</p></div><span class="sample-tag">设计示例档案</span></div>
 <div class="home-composition home-${state.preset}">
  <section class="study-feature"><div class="feature-copy"><span class="eyeline">继续学习 <span>章节 03 · 小节 01</span></span><h2>每个表达式，<br>都有自己的计算顺序。</h2><p>先乘后加，还是先加后乘？<br>从两倍加三开始，把思路写成代码。</p><button class="primary feature-action" data-goto="lesson">继续学习 <span aria-hidden="true">↗</span></button><div class="feature-meta"><span>基础入门</span><i></i><span>讲解 + 独立练习</span></div></div>${symbol}<div class="feature-code"><span>表达式 · 概念示意</span><code><b>int</b> result = (2 * x) + 3;</code></div></section>
  <section class="study-progress"><div class="module-title"><h2>你的学习足迹</h2><span>↗</span></div>${progressRing(sample.completedLessons,sample.lessonTotal,'已完成小节')}<div class="progress-foot"><div><strong>2 <small>/ 8</small></strong><span>已完成章节</span></div><div><strong>${remaining}</strong><span>等待探索的小节</span></div></div></section>
  <section class="study-path"><div class="module-title"><h2>知识，一点点连起来</h2><a href="#courses">全部 8 章 <span>↗</span></a></div><div class="chapter-rows">${lessons.map(([n,title,note,status],i)=>`<a href="#${i===2?'lesson':'courses'}" class="chapter-row ${i===2?'is-current':''}"><span class="chapter-number">${i<2?icon('done'):n}</span><span class="chapter-text"><strong>${title}</strong><small>${note}</small></span><span class="chapter-status">${status}</span><span class="row-arrow">↗</span></a>`).join('')}</div></section>
  <section class="study-today"><div class="module-title"><h2>今天的小目标</h2><span class="tiny-ring">0/2</span></div><p class="muted-copy">不必一次学完，向前一点就好。</p><div class="goal-row"><span class="goal-icon">${icon('lesson')}</span><span><strong>学会一个新概念</strong><small>完成 1 个小节</small></span><span class="goal-check"></span></div><div class="goal-row"><span class="goal-icon">${icon('practice')}</span><span><strong>把想法写出来</strong><small>完成 1 道独立练习</small></span><span class="goal-check"></span></div><div class="today-note"><span>一步一懂</span><p>理解，比赶进度更重要。</p></div></section>
  <section class="study-explore"><div><span class="eyeline">换一种方式理解</span><h2>让数据自己“说话”</h2><p>从 7 个元素开始，看懂一次相邻比较。</p><a href="#visualize">打开冒泡排序 <span>↗</span></a></div><div class="mini-array" aria-label="固定7项概念示意">${[7,3,5,3,9,1,6].map((v,i)=>`<span style="--v:${v}"><b>${v}</b><i></i><small>${i}</small></span>`).join('')}</div></section>
 </div>`;
}
function pathGrid() { return `<div class="learning-path">${chapters.map((title)=>`<a class="path-item" href="#courses"><h3>${title}</h3><p>4 小节 · 4 道必修练习</p></a>`).join("")}</div>`; }
function courses() {
  const rows=["main、语句和 return","变量和输出","printf 与格式输出","按顺序阅读代码"];
  return heading("C 语言课程","8 章 · 32 小节 · 每节都有独立练习。")+pathGrid()+`<div class="section-title"><h2>程序入门与输出</h2><span class="meta">入门 · 4 小节</span></div><section class="panel">${rows.map((s)=>`<a class="row-link" href="#lesson"><span>${s}<small>讲解、完整示例、边界情况与练习</small></span><span>开始学习 →</span></a>`).join("")}</section>`;
}
function lesson() {
 return heading("表达式：先乘，再加","章节 03 · 小节 01 · 从两倍加三，读懂表达式的计算顺序。",'<button class="primary" data-goto="practice">开始独立练习 →</button>',"#courses")+`<div class="lesson-layout"><article class="reading"><h2>从一句话，到一个表达式</h2><p>把输入 x 变成它的两倍，再加上 3，可以写成 <code>2 * x + 3</code>。乘法比加法优先执行，因此输入为 7 时，先得到 14，再得到 17。</p><pre><code>${esc('#include <stdio.h>\n\nint main(void) {\n  int x = 7;\n  int result = (2 * x) + 3;\n  printf("%d\\n", result);\n  return 0;\n}')}</code></pre><h2>括号，表达你的计算意图</h2><p><code>2 * (x + 3)</code> 会先把输入加 3，再乘 2。x 为 7 时结果是 20，与两倍加三不同。括号可以强调顺序，也可能改变结果。</p><table class="state-table"><thead><tr><th>概念示意</th><th>计算过程</th><th class="num">结果</th></tr></thead><tbody><tr><td>两倍加三</td><td>2 × 7 + 3</td><td class="num">17</td></tr><tr><td>先加三再翻倍</td><td>2 × (7 + 3)</td><td class="num">20</td></tr></tbody></table><h2>换一个输入，再看一遍</h2><p>输入为 0 时，两倍加三得到 3；输入为 −9 时，得到 −15。表达式必须使用输入变量，不能直接打印某个样例的答案。</p><h2>开始自己的练习</h2><p>接下来从无答案的解答骨架开始，自己写出运算和输出。运行只观察一组输入，提交才检查全部测试与教学目标。</p></article><aside><section class="panel"><div class="panel-head"><h2>本节完成清单</h2></div><div class="panel-body"><ul class="checklist"><li>理解运算优先级与括号</li><li>主动确认已学习</li><li>独立练习通过并保存</li></ul><button data-demo="正式产品保存学习确认；当前为未连接的设计预览。">确认已学习</button></div></section></aside></div>`;
}

function settings() {
  const theme=design.themes[state.preset];
  const descriptions={minimal:'细线 · 纸面',cute:'粉晶 · 软弹',glass:'磨砂 · 通透',soft:'浮雕 · 按压',cool:'深蓝 · 流光',tech:'轻雾 · 浮雕'};
  const options=Object.entries(design.themes).map(([id,t])=>`<button class="theme-option mini-${id}" data-theme="${id}" aria-pressed="${state.preset===id}"><span class="theme-diagram" aria-hidden="true"><i></i><b></b><em></em></span><strong>${t.label.split(" · ")[0]}</strong><small>${descriptions[id]}</small></button>`).join("");
  return heading("把工作台，变成你的风格","选择界面风格，再为它调一套自己的颜色。")+`<div class="settings-layout"><section class="settings-section"><div class="settings-description"><h2>外观与主题</h2><p>导航、窗口、材质和反馈一起切换。每套主题都单独保留自己的配色。</p><p class="profile-note">当前：${theme.label}</p></div><div><div class="theme-options">${options}</div><div class="field-row"><label for="custom-accent">${theme.label.split(" · ")[0]}主题色</label><input type="color" id="custom-accent" value="${state.themeOverrides[state.preset].accentColor || theme[document.documentElement.dataset.mode||'light'].accent}"><span class="color-value">${state.themeOverrides[state.preset].accentColor || '使用预设色'}</span><button id="reset-style">恢复当前主题颜色</button></div><p class="meta">只修改当前主题；其他五套的颜色继续保留。过浅或过深的颜色会适配文字对比度。</p><div class="field-row"><label for="settings-mode">明暗模式</label><select id="settings-mode"><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></div></div></section><section class="settings-section"><div class="settings-description"><h2>材质与操作反馈</h2><p>${state.preset==='cute'?'磨砂玻璃外壳、晶亮的内缘、按压后轻轻回弹。文字和代码留在清楚的底面上。':state.preset==='glass'?'柔和的渐变透过磨砂桌面，独立玻璃窗口让内容保持清楚。':state.preset==='soft'?'同色凸起和凹槽、柔和光影和按下去的触感。':state.preset==='tech'?'珍珠白的浅浮雕、柔和的凹入控件与窄导航。浅紫高光只点亮当前操作。':state.preset==='cool'?'深蓝舞台、边缘光晕和下方代码控制台。': '纸张般的平面、细线和留白，保持阅读专注。'}</p></div><div class="material-sample"><div class="sample-window"><span>${icon('practice')} 你的解答</span><p>int idea = 1;</p><button id="material-demo" class="primary">试试这个手感</button></div><p class="meta">点击可体验本主题的按钮反馈。减少动态效果时自动停用。</p></div></section><section class="settings-section"><div class="settings-description"><h2>背景与工作区</h2><p>背景导入在后续任务接入。积木辅助按你的需要打开。</p></div><div class="field-stack"><div class="background-well"><span>本地图片 · PNG / JPEG / WebP · ≤ 5 MiB</span><button data-demo="本地背景导入属于 P0.5-03，设计预览不会读取文件。">选择图片</button></div><label for="block-preference">积木默认显示方式</label><select id="block-preference"><option>自动：按小节推荐</option><option>始终显示</option><option>隐藏，使用代码作答</option></select></div></section><div class="controls-bar"><button class="primary" data-demo="这里只预览六主题及各自配色，未连接存档；正式产品将显式保存并在刷新后恢复。">保存外观</button><span class="meta">设计预览：只在本次打开期间记住颜色。</span></div></div>`;
}
const brand=()=>`<a class="brand" href="#home" aria-label="一步一懂，学习首页"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><path d="M10 5H5v22h5M22 5h5v22h-5M13 22l6-12M12 14h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span><strong>一步一懂</strong><small>从代码，到理解。</small></span></a>`;
const nav=()=>`<nav class="product-nav" aria-label="主导航">${[['home','学习首页'],['courses','C 语言课程'],['visualize','算法演示'],['settings','本地设置']].map(([id,label])=>`<a class="nav-link" href="#${id}" title="${label}" aria-label="${label}" ${id===(['lesson','practice','review'].includes(active)?'courses':active)?'aria-current="page"':''}>${icon(id)}<span>${label}</span></a>`).join('')}</nav>`;
const toggle=()=>`<button id="nav-toggle" class="icon-button" aria-label="展开或收起导航" aria-expanded="${state.menuOpen}">${icon('courses')}</button>`;
const footer=()=>`<footer class="preview-footer">设计固定场景 · 不执行 C，不判题，不写学习档案</footer>`;
function shellMarkup(content) {
 const main=`<main class="sheet" id="main" tabindex="-1" data-page="${active}">${content}</main>`;
 const note='<span class="local-note">当前浏览器 · 本地学习</span>';
 if(state.preset==='minimal')return `<div class="app-shell paper-shell"><aside class="sidebar">${brand()}<p class="nav-caption">学习空间</p>${nav()}<div class="sidebar-bottom">一步一步，读懂程序。<br>学习记录保存在当前浏览器。</div></aside><div class="app-body"><header class="topbar">${toggle()}<span>C 语言 / ${screens.find(([k])=>k===active)[1]}</span>${note}</header>${main}${footer()}</div></div>`;
 if(state.preset==='cute')return `<div class="app-shell jelly-shell"><header class="jelly-header">${nav()}${toggle()}</header><div class="jelly-world" aria-hidden="true"><i class="jelly-orb one"></i><i class="jelly-orb two"></i><i class="jelly-orb three"></i></div><div class="app-body"><div class="jelly-context">${brand()}<span>今天也把一个小问题想明白。</span>${note}</div>${main}${footer()}</div></div>`;
 if(state.preset==='glass')return `<div class="app-shell ambient-shell"><div class="ambient-background" aria-hidden="true"></div><aside class="sidebar frosted-rail">${brand()}<span class="nav-caption">你的学习桌面</span>${nav()}<div class="sidebar-bottom">在一个安静的地方，<br>把程序看清楚。</div></aside><div class="app-body"><header class="ambient-toolbar">${toggle()}<span>C 语言 / ${screens.find(([k])=>k===active)[1]}</span>${note}</header>${main}${footer()}</div></div>`;
 if(state.preset==='soft')return `<div class="app-shell tactile-shell"><header class="tactile-header">${brand()}<span class="tactile-tag">慢慢想，试试看。</span>${toggle()}</header><div class="app-body">${main}${footer()}</div><div class="tactile-dock">${nav()}</div></div>`;
 if(state.preset==='cool')return `<div class="app-shell theater-shell"><aside class="sidebar tool-rail">${brand()}${nav()}<span class="rail-word">逐步学习</span></aside><div class="app-body"><header class="theater-tabs">${toggle()}<span class="file-tab">${icon(active)} ${screens.find(([k])=>k===active)[1]}</span><span class="session-label">代码 · 可视化</span>${note}</header>${main}<div class="terminal-status"><span>◦ 初始场景</span><span>UTF-8 · C 子集</span></div>${footer()}</div></div>`;
 return `<div class="app-shell mist-shell"><aside class="mist-rail">${brand()}${nav()}</aside><div class="app-body"><header class="mist-header"><span>一步一懂 <small>/ ${screens.find(([k])=>k===active)[1]}</small></span>${toggle()}${note}</header>${main}${footer()}</div></div>`;
}
function render() {
 applyTheme();
 $('#shell').className=`theme-${state.preset} ${state.navCollapsed?'collapsed':''} ${state.menuOpen?'menu-open':''} ${state.focus?'focus':''}`;
 $('#shell').innerHTML=shellMarkup(({home,courses,lesson,practice,visualize,review:()=>visualize(true),settings}[active])());
 if(state.preset==='cool'&&['visualize','review'].includes(active)) {
   const controls=$('.controls-bar');$('.trace-pane').append(controls);
 }
 if($('#array-count'))$('#array-count').value=String(state.count);
 if($('#settings-mode'))$('#settings-mode').value=state.mode;
 document.querySelectorAll('[data-demo]').forEach(el=>el.addEventListener('click',()=>notify(el.dataset.demo)));
 document.querySelectorAll('[data-goto]').forEach(el=>el.addEventListener('click',()=>{location.hash=el.dataset.goto;}));
 document.querySelectorAll('button[data-theme]').forEach(el=>el.addEventListener('click',()=>chooseTheme(el.dataset.theme)));
 document.querySelectorAll('button[data-pane]').forEach(el=>el.addEventListener('click',()=>{state.pane=el.dataset.pane;render();}));
 $('#array-count')?.addEventListener('change',e=>{state.count=Number(e.target.value);render();});
 $('#answer')?.addEventListener('input',e=>{state.draft=e.target.value;});
 $('#code-tab')?.addEventListener('click',()=>{state.blockMode=false;render();});
 $('#blocks-tab')?.addEventListener('click',()=>{state.blockMode=true;render();});
 $('#focus-toggle')?.addEventListener('click',()=>{state.focus=!state.focus;$('#shell').classList.toggle('focus',state.focus);});
 $('#expand-array')?.addEventListener('click',()=>$('#workbench').classList.toggle('array-full'));
 $('#nav-toggle')?.addEventListener('click',()=>{if(innerWidth<=1100){state.menuOpen=!state.menuOpen;$('#shell').classList.toggle('menu-open',state.menuOpen);$('#nav-toggle').setAttribute('aria-expanded',state.menuOpen);}else{state.navCollapsed=!state.navCollapsed;$('#shell').classList.toggle('collapsed',state.navCollapsed);}});
 $('#settings-mode')?.addEventListener('change',e=>{state.mode=e.target.value;applyTheme();});
 const editedThemeId=state.preset;
 $('#custom-accent')?.addEventListener('input',e=>{const color=e.target.value.toUpperCase();state.themeOverrides[editedThemeId].accentColor=color;if(state.preset===editedThemeId){applyTheme();$('.color-value').textContent=color;}});
 $('#reset-style')?.addEventListener('click',()=>{state.themeOverrides[state.preset].accentColor=null;render();});
 $('#material-demo')?.addEventListener('click',e=>{e.currentTarget.classList.remove('material-feedback');void e.currentTarget.offsetWidth;e.currentTarget.classList.add('material-feedback');notify('这是当前主题的操作反馈；减少动态效果时保持静止。');});
 const separator=$('.separator');
 if(separator){let ratio=state.ratios[active]??35;const update=x=>{ratio=Math.min(70,Math.max(30,x));state.ratios[active]=ratio;if(!(state.preset==='cool'&&active!=='practice'))$('#workbench').style.gridTemplateColumns=`minmax(0,${ratio}fr) 10px minmax(0,${100-ratio}fr)`;};update(ratio);separator.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();update(e.key==='Home'?30:e.key==='End'?70:ratio+(e.key==='ArrowRight'?5:-5));}});separator.addEventListener('pointerdown',e=>separator.setPointerCapture(e.pointerId));separator.addEventListener('pointermove',e=>{if(separator.hasPointerCapture(e.pointerId)){const r=$('#workbench').getBoundingClientRect();update((e.clientX-r.left)/r.width*100);}});separator.addEventListener('pointerup',e=>{if(separator.hasPointerCapture(e.pointerId))separator.releasePointerCapture(e.pointerId);});}
}
function chooseTheme(id){state.preset=id;state.menuOpen=false;render();}
addEventListener('hashchange',()=>{active=location.hash.slice(1);if(!screens.some(([key])=>key===active))active='home';state.pane=active==='practice'?'code':'result';state.menuOpen=false;render();scrollTo(0,0);});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.mode==='system')applyTheme();});
render();

