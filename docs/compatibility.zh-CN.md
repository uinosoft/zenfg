<!-- translation: {"version":1,"source":"docs/compatibility.md","sourceHash":"4b9e569ee0bcf986a3b5e896af377bcf7c967ee1cfe8bfb06e0a5741f6dd1091","state":"ready"} -->

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./compatibility.md
[documentation-zh]: ./compatibility.zh-CN.md
<!-- generated:language:end -->

<a id="compatibility-matrix"></a>

# 兼容性矩阵

<!-- generated:compatibility:start -->
| ZenFG 包 | 版本 | 运行环境／工具链 | Snapshot |
| --- | --- | --- | --- |
| `@zenfg/webgpu` | `0.2.0` | Native WebGPU; tooling Node >=24.0.0 <25 | produces 1.2 |
| `@zenfg/snapshot` | `0.1.1` | ESM, ES2022 | reads Legacy V0, Legacy Candidate V1, 1.1 (migrated), 1.2 |
| `@zenfg/inspector` | `0.2.0` | Modern DOM; no WebGPU dependency | reads through @zenfg/snapshot |
| `zenfg` | `0.2.0` | Rust 1.98; wgpu 30.0.1 | produces 1.2 |
| `zenfg-snapshot` | `0.1.1` | Rust 1.98; no wgpu | reads Legacy V0, Legacy Candidate V1, 1.1 (migrated), 1.2 |
<!-- generated:compatibility:end -->

各包的版本号不会同步递增。Snapshot 主版本或次版本发生变化时，读取方必须显式实现迁移；未知格式和版本都会被拒绝。

已发布的 beta.2 使用 Snapshot 1.0，beta.3 使用 Snapshot 1.1。beta.4 生成 1.2，并显式迁移 1.1；规范版 1.0 仍会被拒绝。读取方必须先升级，才能打开新生成的 1.2 文件。归档捕获结果和源代码层面的 API 变更请参阅 [beta.3 迁移指南](migration-0.1.0-beta.3.zh-CN.md)。

0.1.0 保留了 beta.4 的公开 API 和 Snapshot 1.2 格式。运行时与 Inspector 0.2.0、Snapshot 包 0.1.1 均继续使用 Snapshot 1.2 线协议。错误处理、TypeScript 句柄类型标记、Rust 报告 JSON 和 Inspector 默认值的变更请参阅[从 0.1.0 迁移](migration-0.2.0.zh-CN.md)。1.0 发布前公开 API 仍可能变化；升级前请固定精确的包版本并查看迁移说明。

<a id="repository-toolchains"></a>

## 仓库工具链

<!-- generated:toolchains:start -->
仓库工具链： Node `>=24.0.0 <25`, pnpm `12.11.2`, npm publishing client `11.11.0`, TypeScript `^6.0.3`, Rust `1.98`, wgpu `30.0.1`.
<!-- generated:toolchains:end --> Node.js 用于开发和打包，不是浏览器运行时的依赖。浏览器运行需要原生 WebGPU 和现代 DOM 支持。

TypeScript 用户应从文档列出的包入口导入，而不要导入源文件或未声明的 `dist` 路径。Rust 用户应使用各 crate 文档中列出的 feature 标志。发布检查会在发布包之前验证工具链变更。

beta.4 的 API 变更见[统一执行计时与 Snapshot 1.2 迁移说明](migration-timing-snapshot-1.2.zh-CN.md)。
