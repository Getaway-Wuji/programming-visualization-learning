# 07.3 公开案例的真实轨迹

本目录只保存项目自有公开开发样例的验收数据，依据DEC-001 KEEP-09；不是用户程序档案、产品日志或正式发布内容。实际采集与验证结果见[纵向验收](../07.3-纵向执行验收.md)及[机器证据](../07.3-纵向执行证据.json)。原02.1—02.4夹具与黄金不改写。

六组数据来自生产构建的真实案例页面。测试通过输入面板应用参数，由Rust生成当前显示的完整源码，再经Dedicated Worker调用同一Rust/WASM执行核心。测试旁观器在transfer前复制原请求、复制实际返回缓冲，等待页面接受终态后记录UI；没有注入预制结果或在前端运行C。复制本身有额外成本，不作为11.4性能测量。

| 目录 | 实际输入 | 可独立核对的输出 | 终态 |
|---|---|---|---|
| assignment | x = −7 | `-5\n` | completed / complete |
| array-traversal | [-2, 5, 5, 0] | `8\n` | completed / complete |
| bubble-sort | [4, -1, 4, 0] | `-1 0 4 4\n` | completed / complete |
| array-empty | [] | `0\n` | completed / complete |
| assignment-div-zero | x = −7 | `-7\n`（故障前输出） | program-error / prefix / E_DIV_ZERO |
| array-out-of-bounds | [-2, 5, 5, 0] | `8\n`（故障前输出） | program-error / prefix / E_INDEX_BOUNDS |

每组包括以下原始证据：

- `request.json`、`result.json`：原请求/结果的规范UTF-8字节，无重排、格式化或补写。运行身份和技术耗时源于本次真实执行，重跑会变化。
- `catalog.json`：发送给Worker的独立静态catalog副本；不是从结果包自报构造。
- `source.c`：页面实际只读源码，须与request.source.text完全相等。
- `ui.json`：页面接受后的实际输入、输出、状态、步数与诊断。
- `capture.json`：浏览器版本、Worker旁观事实、字节长度/校验摘要及来源说明。其expected只作采集说明，独立验证器使用固定已知期望，不以该字段自证正确。

两个故障目录的`capture.json.fault`保留公开模板原文、隔离修改后原文及精确替换。故障只在验收浏览器截取的公共内容响应副本中启用，经原准备/执行链路产生真实Rust运行错误；没有修改生产内容。catalog中的原版本引用只标明测试上下文，不能据此声称修改后的正文是原始正式内容。此方法不开放任意源码工作台。

故障后解除内容替换并重新加载页面，再以同组合法输入实际完成；两个故障目录下的`recovery/`各保存同样六份原始证据，正式Firefox也独立验证新文档恢复。正常完成、空数组和错误有效前缀均可通过正式协议的完整正向/逆向状态校验。这里没有播放器控制/动画/高亮验收，后续08应消费Step事实，不另算算法。

在项目根目录使用固定环境重新采集：

```powershell
pwsh -NoProfile -File scripts/task.ps1 build
pwsh -NoProfile -File scripts/task.ps1 test:browser vertical-execution.spec.ts
```

采集输出位于`.artifacts/07.3/browser-captures/<project>/<key>/`；请保留已接受的原始字节，不能以静态手写轨迹替换。独立验证器和正式Firefox运行方法见主验收报告。归档文件摘要见`manifest.json`。
