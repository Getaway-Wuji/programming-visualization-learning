# Rust 2018 教学解释器

此工作区独立解析 Rust 源码，先对所有函数及分支进行静态检查，再解释受支持的教学子集。不会调用本机 Rust 编译器或执行用户原生程序。`wasm` 包提供浏览器入口，核心库提供 `execute(bytes, build_id, meter)`，请求与结果使用版本为 `1.0.0` 的封闭 JSON 协议。

支持 i32、bool、unit、函数与递归、局部作用域及同名隐藏、条件、循环、固定 i32 数组、String 移动及克隆，以及用户函数调用中的直接共享或可变借用。标准输入使用虚拟文本，支持 `read_line` 追加和 i32 解析。未开放的语法返回明确诊断。

模块分工：

- `syntax.rs`：词法、带原始字节范围的 AST、节点索引与语法深度限制。
- `check.rs`：类型、可变性、控制流、移动状态及调用借用检查。
- `runtime.rs`：真实解释执行及输出数据和控制来源的内部跟踪。
- `model.rs`：帧、绑定、对象、借用和临时拥有者的可序列化状态。
- `trace.rs`：原子前后差分、每 128 步的检查点及累计资源接纳。
- `api.rs`：封闭请求校验、执行、编辑分析和四组当前源码判题。

轨迹初态为空。每步仅包含变化分量的 before / after；所有 before 应同时校验，再原子应用全部 after，后退使用相反方向。检查点只在游标 0 及 128 的正整数倍保存完整状态。对象身份和绑定身份为教学用编号。

判题各组重置解释器状态，共享同一个预算。`usage.resultBytes` 累加所有已接纳 Step 记录和正游标检查点的紧凑 UTF-8 JSON 字节数，初始检查点、节点表和结果信封不计入该统计；实际编码结果另受结果字节上限约束。接纳同时为节点表、信封和最终编码保留预算。

判题中的语言特征必须参与真实输出的数据或控制来源。未使用的克隆、移动、函数调用或数组修改不能满足对应目标。共同输入样板中的 String::new、read_line 借用和解析不计 String 或用户借用目标。

在仓库固定工具链下运行：

```text
cargo test --manifest-path engine/rust2018/Cargo.toml --workspace --locked
cargo clippy --manifest-path engine/rust2018/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo build --manifest-path engine/rust2018/Cargo.toml --package c-viz-rust2018-wasm --target wasm32-unknown-unknown --release --locked
```
