# 第17步 Git交付

2026-11-01（Asia/Shanghai）；root；依据项目守则§8.1既有整块授权执行。17.4开发/验收于10月31日开始，Git收尾跨至11月1日。17.1设计、17.2真实执行、17.3工作台与SAVE8、17.4对抗恢复均已验收；没有进入18/21。

产品提交[9010778110e0942c63864be0b61958f1b7a7d0fa](https://github.com/Getaway-Wuji/programming-visualization-learning/commit/9010778110e0942c63864be0b61958f1b7a7d0fa)，备注“完成17部分”，父提交8e2ed5f81b426711cfdb1fa5e98f4d83cb954648。已推送main，原历史未改写，提交前待推送链为0；推送后远端SHA与本地一致。作者/提交者均为Getaway-Wuji，邮箱146464204+Getaway-Wuji@users.noreply.github.com；GitHub账号映射二者均为Getaway-Wuji，仓库仍为private。只设本仓库身份，没有机器人或共同作者署名。

417个文件、17886271字节逐暂存blob核对与工作区一致；包含第17所需源码/测试/契约/交接、不可变发布及作为直接前置的已验收UI反馈48/49。没有夹带其他窗口的16份CI交接/同步归档，完成后再次逐SHA核对仍与领取时相同。37个发布索引/299份凭据已受版本控制并逐SHA验证，三轮QA索引共207份冻结文件均入Git，含此前被通用*.log忽略的原始日志。

源码/脚本/文档格式与类型、ESLint、双目标严格Clippy、生产构建通过；543 Rust（原忽略1）、1868前端和55唯一正式Chrome通过。固定原件采用项目*-text规则保存原字节；Git空白检查识别CRLF，并仅排除17.2/17.3及UI冻结日志目录中的真实工具输出尾空格，未改写原始日志。其余新增/修改文件检查通过；冻结文件完整性由SHA及暂存blob精确比较保证。

[Actions 41217615764](https://github.com/Getaway-Wuji/programming-visualization-learning/actions/runs/41217615764)实际completed/success，全部步骤成功，含检出、37/299归档检查、工具/依赖准备、四WASM及产品/内部harness真实构建、TypeScript与ESLint。详见[实际交付证据](../验收/17-Git交付/实际交付.json)。本文及必要台账为推送后补充记录，后续记录提交继续使用“完成17部分”，其最终SHA在聊天结果中返回，避免文件自引用。

当前正式1.0.52/329来源，SAVE8/DB8/16store；原73/88、主路线73/98、P2 4/19、P0.5 9/9、21为0/10。18.1可领取，本窗口停止于第17交付。
