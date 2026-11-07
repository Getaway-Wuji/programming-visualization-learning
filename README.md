# 编程可视化教学平台

React + Rust/WASM 编程学习应用。提供课程、积木与代码练习、真实执行轨迹、逐步回放、算法与内存观察、复习和学习笔记导出。

## 启动

在 Windows PowerShell 7 中运行：

```powershell
pwsh -NoProfile -File scripts/setup.ps1
pwsh -NoProfile -File scripts/task.ps1 ci
pwsh -NoProfile -File scripts/task.ps1 build
pwsh -NoProfile -File scripts/task.ps1 dev
```

也可使用根目录的 `启动项目.bat`。工具版本由项目配置固定；安装的依赖与工具保存在本机，不进入仓库。

## 功能与边界

- 前端消费 Rust 解释器的真实轨迹，支持前进、后退、暂停和重播；不运行用户原生程序。
- C、Python、Java、C++ 课程和受支持的 C/C++ 案例按各自解释器子集执行。复杂算法案例使用独立的 C++ 算法入口。
- C 课程按《C Primer Plus》第6版组织为17章、404个学习小节。A/B附录仅供参考；在正文中滚动到页末后自动记录小节完成，练习可独立进入并通过真实测试判定。同日重复阅读只计一次，跨日复习计入当天目标，首次奖励不重复发放。阅读例子保留完整代码，只讲解本节关键点。
- 从「Python 课程」进入81篇文章或打开 Python 工作台。标为可运行的示例和12道课程练习由 Python Rust/WASM 执行，阅读示例可以展开自检解析。受支持的程序可在代码与 Blockly 积木之间切换并显式应用积木修改。练习可保存草稿、查看判题复盘，也可按当前步骤下载本机快照和笔记。
- 从「Java 课程」进入 56 篇文章，或在 Java 工作台输入带 `public static void main(String[] args)` 的单文件程序。可运行示例和 12 道练习通过浏览器中的 Java Rust/WASM 解释器执行，练习使用四组固定测试。工作台支持整数、布尔值、字符串、受限的静态方法、一维数组、数据对象和读取虚拟输入的 Scanner。课文标记了反射、线程、文件等只供阅读的内容。
- Java 工作台可切换受支持的 Blockly 积木、设置源码断点、查看变量和对象、回放本次运行及导出选定步骤的 JSON、PNG、Markdown 或 ZIP。Java 与 Python 分别保存草稿、阅读及判题复盘。
- 从「C++ 课程」查看 4 篇、18 章的完整目录，或在 C++ 工作台运行受支持的单文件 `int main()` 程序。12 个示例和 12 道四组练习由浏览器中的 C++ Rust/WASM 解释器执行。C++20 教学子集覆盖整数和标准流、函数、受限数组与指针、`int&` 参数和简单公开聚合类。模板、继承、STL 等内容可阅读及自检。工作台提供 Blockly、源码断点、可逆回放和 JSON、PNG、Markdown、ZIP 导出。C++ 草稿、阅读及判题复盘按课包保存在当前浏览器。
- 学习进度、奖励和偏好保存在当前浏览器。没有账号、云存档或多人协作。
- 可选 AI 调试默认关闭，需在设置中临时输入自己的 API Key。启用后，经用户确认的上下文会发送给所选官方服务；学习记录仍保存在浏览器。
- 笔记支持本地 Markdown、PNG、JSON ZIP 导出；不提供 PDF 导出。

从旧档案 DB1—9 首次切换至《C Primer Plus》课程时，按 C 课程首次启用规则重建学习档案，有效的主题、头像和背景等非学习偏好保留。DB10、DB11 和 DB12 升级至 DB13 时保留已有学习记录、奖励、草稿与偏好，并补充缺少的 Python、Java 或 C++ 活动及草稿存储。若其他页面阻塞升级，关闭对应页面后重新读取即可。

## 开发与验证

```powershell
pwsh -NoProfile -File scripts/task.ps1 typecheck
pwsh -NoProfile -File scripts/task.ps1 lint
pwsh -NoProfile -File scripts/task.ps1 test
pwsh -NoProfile -File scripts/task.ps1 check:rust
pwsh -NoProfile -File scripts/task.ps1 test:schemas
pwsh -NoProfile -File scripts/task.ps1 check:repository
```

浏览器回归先安装本机 Chrome、Edge 和 Playwright Firefox，再运行：

```powershell
pwsh -NoProfile -File scripts/task.ps1 browser:install:firefox
pwsh -NoProfile -File scripts/task.ps1 test:cross-browser
```

完整入口依次运行三浏览器主套件、七套独立解释器和课程检查、四类历史数据迁移、原生 Firefox，以及保留原阈值的性能检查。每次使用独立证据目录，核对源码在测试期间未变化，失败不重试。也可加 `--suite=main`、`engines`、`migrations`、`stock` 或 `performance` 单独运行一组；单组通过不代表完整回归通过。

内部 QA 构建单独挂载保留的执行诊断与复习调度组件，直接使用产品组件、真实解释器和浏览器存储。主套件同时检查现行公开入口；旧 `/reviews` 地址跳转到错题与陌生点。

迁移检查需要本机保留的历史构建；尚未支持 Firefox 的旧版先在 Chrome 中真实完成学习，再将原始物理分区完整读入 Firefox，核对结构与数据全等后检查其实际升级、清除和新课学习。历史构建保持原样，不将此过程称为旧版 Firefox 执行支持。原生 Firefox 使用 `.tools/firefox/core/firefox.exe` 和 `.tools/geckodriver/geckodriver.exe`。性能检查使用现有 Windows 主机采样与本地 HTTPS 证书配置，要求可见浏览器和符合既定条件的显示环境；不满足条件会报告失败，不降低阈值。所有截图、执行原包和报告保存在 `.artifacts/`，不上传仓库。

`content/` 保存课程和案例，`engine/` 保存 Rust 解释器，`web/` 保存前端，`server/ai-proxy/` 保存可选 AI 网关，`shared/contracts/` 和 `tests/fixtures/` 保存程序与测试实际使用的协议和固定输入。

构建核对源码输入和 WASM 哈希，不依赖历史交接、截图或测试日志。历史发布元数据保留既有程序与机器协议的稳定身份，不会恢复已清除的学习档案，也不代表本次重新执行过历史验收。修改构建输入后，运行 `lock:build` 更新输入清单，再执行相应检查。

## 仓库范围

GitHub 只保存产品源码、依赖锁定、必要协议与测试输入、构建配置和使用说明。AI 技能、缓存、交接、任务包、进度台账、临时设计稿、截图、日志、教材 PDF 和一次性工作脚本留在本机，由 `.gitignore` 及 CI 检查阻止再次上传。
