# GitHub Actions 构建修复交接

日期：2026-10-31（Asia/Shanghai）。状态：专项实施中，远端通过后更新。

## 授权与隔离

用户明确要求修复构建失败、不得影响其他窗口，并确认 GitHub Actions 正常通过。本次是独立 CI 修复，不冒称完成第16部分，也不按原任务编号领取产品子任务。

基线为远端 main `ec023619c4f49509360ead2365233b9c768b6df4`。在独立克隆 `D:/Files/Downloads/programming-visualization-ci-repair-20261031` 的 `fix/ci-reproducible-build-20261031` 分支工作。原项目目录只读；不改其文件、索引、分支、目标目录或中央台账，不纳入正在进行的16.1/16.2改动。此处独立登记文件归属，避免争用协调窗口台账。

## 范围与原因

- `.github/workflows/webpack.yml`：固定一次性 Windows runner 的 Cargo home 为历史验收所用目录，保留全部冻结指纹检查。Rust依赖的panic位置包含绝对路径，目录本身也是历史二进制构建输入。此路径只用于CI构建缓存，不是学习档案路径，也不要求其他窗口迁移工作区。checkout固定官方v7.0.1提交，使用Node24消除旧版警告。
- `.gitignore`：只为发布凭据目录内的 `ui-lint-vector-final.log` 增加例外，其实际内容为JSON；其他普通日志仍忽略。
- `项目文档/验收/发布凭据/15.4-1.0.33/ui-lint-vector-final.log` 及 `15.4-1.0.34/` 同名文件：从本机原件逐字节补齐，各37字节，均匹配已有归档索引SHA256 `c7c9974eb23149f3f5e2b2562c845543a66369e922be8570ee85a991b51ac4bd`。不修改旧索引或验收结果。
- `scripts/check-release-archives.mjs`：在下载工具前验证所有发布索引、登记文件及凭据确实受Git跟踪且哈希一致，避免本机存在但未提交的文件掩盖缺失。
- 本交接记录：记录验证、Git实交与后续同步入口。产品源码、依赖版本、锁文件、受审源码清单及既有三引擎SHA不变。

## 验证

独立克隆无target/生成文件起步，锁定npm安装、完整build、typecheck和lint均退出0；新增脚本及工作流的格式检查通过。真实编译三Rust/WASM，保持原指纹：

- C：`aed203f4fe30ccaafdb32d0c68c2a1f2634c10726c82977684d4e3d20228679d`。
- C++算法：`14be60eb14544c9be02f3818086b03db94596e6dc027336a8e2ffb84b49cfc0e`。
- C++内存：`4f3cb075dc0b7da3a0afc9dd96f178b6a1b71184f125c726ddf0b81384f6b3a7`。

归档检查在日志仍未跟踪时实际失败，明确指出遗漏路径；把两个原件纳入Git后，19个索引/193份凭据全部通过。新源码空白检查通过；两个原件原有CRLF被Git空白检查提示，按不可变哈希要求保留，不清洗验收资料。未改产品逻辑，本轮不重复全部浏览器/学习/性能验收。

远端尚待验证，不提前标记成功；后续实交记录将补充实际Actions链接和提交归属。

## 兼容与后续

历史WASM含本机绝对依赖目录，当前以固定CI构建环境保持原二进制及学习授权兼容。将来如迁移至中性路径，应作为正式引擎发布登记和验收，不能直接改旧指纹或移除断言。本轮不开展该迁移。

其他窗口在其正常集成时从远端快进/合并此小范围修复；本窗口不会在正在工作的原目录执行pull、reset、checkout或暂存。历史失败运行保留，最终以本次新提交的远端成功运行作为证据。

依据：[Cargo home官方说明](https://doc.rust-lang.org/cargo/guide/cargo-home.html)、[checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)。
