<!-- translation: {"version":1,"source":"docs/README.md","sourceHash":"d48401c38667328f3ae6207c55ffbc67a557eeb371619c0f93a209e56513b4d9","state":"ready"} -->

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

<a id="getting-started-with-zenfg"></a>

# ZenFG 入门

选择适合你应用的路线。ZenFG 协调图可见的 GPU 工作；设备、渲染策略和呈现由应用负责。

| 目标 | 从这里开始 | 你将获得 |
| --- | --- | --- |
| 集成 TypeScript 与 WebGPU | [WebGPU 快速入门](../packages/webgpu/README.zh-CN.md#quick-start) | 仅执行清除操作的呈现帧 |
| 集成 Rust 与 wgpu | [Rust 快速入门](../crates/zenfg/README.zh-CN.md#quick-start) | 仅由 CPU 编译的图，以及后续由设备驱动的示例 |
| 读取或生成 Snapshot 数据 | [TypeScript Snapshot](../packages/snapshot/README.zh-CN.md) 或 [Rust Snapshot](../crates/zenfg-snapshot/README.zh-CN.md) | 经过验证、规范化的可移植诊断数据 |
| 嵌入可视化调试器 | [Inspector 快速入门](../packages/inspector/README.zh-CN.md#quick-start) | 用于检查捕获结果的浏览器工作台 |

<a id="before-you-start"></a>
<a id="continue-by-task"></a>

<a id="package-documentation"></a>

## 包文档

每个包或 crate 都维护自己的使用方法、概念和升级说明。查看上方链接中的版本专属指南，或浏览[在线文档](https://uinosoft.github.io/zenfg/docs/zh-CN/)。

<a id="api-reference"></a>

要查阅准确的 API，请从各包 README 前往其中附带的类型定义/源代码或 Rust API 文档。[开发版 TypeScript API](https://uinosoft.github.io/zenfg/docs/api/)由公开源代码注释生成。

<a id="versions-and-contributing"></a>

## 版本与贡献

网站对应开发分支。已安装包中的 README、随包发布的示例和各包的发布标签会保留对应已发布版本的文档。升级运行时或 Inspector API 前，请先阅读[从 0.1.0 迁移](migration-0.2.0.zh-CN.md)。旧版 beta 捕获结果另见[Snapshot 1.2 计时迁移](migration-timing-snapshot-1.2.zh-CN.md)，各包的变更见[更新日志](../CHANGELOG.zh-CN.md)。

参与仓库开发时，请阅读英文版[贡献指南](../CONTRIBUTING.md)、[文档维护流程](documentation.md)和[发布流程](release-process.md)。
