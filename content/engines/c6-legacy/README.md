# 固定 C6 运行资源

`0.1.0` 保存旧 CONTENT2 内容绑定的已发布 C6 编译运行时及其 WebAssembly 绑定。产品锁为 `content/build/c6-legacy-runtime-0.1.0.json`，WASM SHA-256 为 `3989554a5c6d195966fd8dbadbe1474e00360d6ac30d0348ed05a967e5226755`。

根构建验证这些固定资源，只在生成目录缺失时还原。已经存在的不同字节会被拒绝覆盖。修复后的 CONTENT3 解释器由 Rust 单独构建到 `web/src/generated/c6-teaching`，使用自己的构建锁及内容绑定。
