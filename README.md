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
- C 课程及受支持的 C/C++ 案例按各自解释器子集执行，不代表支持完整语言标准。Python、Java 和完整 C++ 课程尚未交付。
- 学习进度、奖励和偏好保存在当前浏览器。没有账号、云存档或多人协作。
- 可选 AI 调试默认关闭，需在设置中临时输入自己的 API Key。启用后，经用户确认的上下文会发送给所选官方服务；学习记录仍保存在浏览器。
- 笔记支持本地 Markdown、PNG、JSON ZIP 导出；不提供 PDF 导出。

## 开发与验证

```powershell
pwsh -NoProfile -File scripts/task.ps1 typecheck
pwsh -NoProfile -File scripts/task.ps1 lint
pwsh -NoProfile -File scripts/task.ps1 test
pwsh -NoProfile -File scripts/task.ps1 check:rust
pwsh -NoProfile -File scripts/task.ps1 test:schemas
pwsh -NoProfile -File scripts/task.ps1 check:repository
```

`content/` 保存课程和案例，`engine/` 保存 Rust 解释器，`web/` 保存前端，`server/ai-proxy/` 保存可选 AI 网关，`shared/contracts/` 和 `tests/fixtures/` 保存程序与测试实际使用的协议和固定输入。

构建核对源码输入和 WASM 哈希，不依赖历史交接、截图或测试日志。历史发布元数据仅用于保留旧课程及学习记录的稳定身份；它不代表本次重新执行过历史验收。修改构建输入后，运行 `lock:build` 更新输入清单，再执行相应检查。

## 仓库范围

GitHub 只保存产品源码、依赖锁定、必要协议与测试输入、构建配置和使用说明。AI 技能、缓存、交接、任务包、进度台账、临时设计稿、截图、日志、教材 PDF 和一次性工作脚本留在本机，由 `.gitignore` 及 CI 检查阻止再次上传。
