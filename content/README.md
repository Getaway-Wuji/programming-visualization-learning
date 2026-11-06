# 公开教学内容

`c/` 保存 C 课程、练习、积木及历史发布身份；`cpp/` 和 `algorithms/` 保存受支持 C++ 案例；`advanced/` 保存进阶课程、例题与语言对照；其余目录提供主题、目标、奖励、头像和学习兼容配置。

`python3/course/` 保存 Python CONTENT4 课包。清单按文章列出正文块的路径、字节数和哈希，块内保存目录、正文、例子和学习活动。`python3/judges-1.0.0.json` 保存 Rust 判题使用的固定用例。构建核验引擎、判题数据和内容身份，将课包发布为同源静态文件。

内容由构建脚本校验后生成同源静态资源。前端读取器检查严格 JSON、协议版本、精确引用、输入约束、版本兼容及体积限制；真实程序由 Rust 解释执行。前端不根据配置自行计算算法答案。

基础协议与固定样例见 [shared/contracts](../shared/contracts/README.md)。原课程程序的 REF-01 至 REF-10 来源见 [参考程序](../shared/fixtures/reference-programs.md)。公开配置不保存个人学习档案、用户提交或运行历史。

课程和学习身份、旧版本引用及奖励去重规则需要兼容保存。历史发布 JSON 保留这些身份；当前构建根据 `content/build/source-lock.json` 核对实际产品源码，不读取 AI 工作日志。
