<!-- translation: {"version":1,"source":"packages/webgpu/README.md","sourceHash":"c420bb11ead9d8b47ae385e2d41a12950eca91d9133adb0b0a40adbe0f3f6fd2","state":"ready"} -->

# @zenfg/webgpu

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

<!-- usage-source: docs/README.md -->

<!-- generated:badges:start -->
[![@zenfg/webgpu published latest version](https://img.shields.io/npm/v/%40zenfg%2Fwebgpu/latest?label=npm)](https://www.npmjs.com/package/@zenfg/webgpu)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/webgpu/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/LICENSE)
<!-- generated:badges:end -->

`@zenfg/webgpu` 是一个轻量级 WebGPU FrameGraph，用于声明并执行逐帧 GPU 工作。它负责排列图节点、校验资源访问、裁剪未使用的工作、推导 WebGPU 使用标志、跟踪资源生命周期，并复用瞬态纹理和缓冲区。

<a id="installation"></a>

## 安装

<!-- generated:installation:start -->
```sh
npm install @zenfg/webgpu@0.2.0
```
<!-- generated:installation:end -->

<a id="quick-start"></a>

## 快速入门

导入方式、调用方提供的输入及执行生命周期见[完整快速入门](docs/README.zh-CN.md#quick-start)。

<a id="guides"></a>

## 指南

<!-- generated:usage:start -->
<a id="lifecycle"></a>

- [生命周期](docs/README.zh-CN.md#lifecycle)

<a id="diagnostic-grouping"></a>

- [诊断分组](docs/README.zh-CN.md#diagnostic-grouping)

<a id="bloom-grouping-adapter"></a>

- [Bloom 分组适配器](docs/README.zh-CN.md#bloom-grouping-adapter)

<a id="common-tasks"></a>

- [常见任务](docs/README.zh-CN.md#common-tasks)

<a id="key-pattern-declare-list-and-unwrap-access"></a>

- [关键模式：声明、列出并解析访问令牌](docs/README.zh-CN.md#key-pattern-declare-list-and-unwrap-access)

<a id="native-render-pass-descriptor-extras"></a>

- [原生渲染通道描述符扩展](docs/README.zh-CN.md#native-render-pass-descriptor-extras)

<a id="resource-and-integration-choices"></a>

- [资源与集成方式](docs/README.zh-CN.md#resource-and-integration-choices)

<a id="error-handling"></a>

- [错误处理](docs/README.zh-CN.md#error-handling)

<a id="diagnostics-and-snapshot"></a>

- [诊断与 Snapshot](docs/README.zh-CN.md#diagnostics-and-snapshot)

<a id="download-a-snapshot-for-inspector"></a>

- [下载 Snapshot 并在 Inspector 中查看](docs/README.zh-CN.md#download-a-snapshot-for-inspector)

<a id="common-mistakes"></a>

- [常见错误](docs/README.zh-CN.md#common-mistakes)

<a id="complete-recipes"></a>

- [完整示例](docs/README.zh-CN.md#complete-recipes)

<a id="resource-pool-maintenance"></a>

- [资源池维护](docs/README.zh-CN.md#resource-pool-maintenance)

<a id="further-reading"></a>

- [延伸阅读](docs/README.zh-CN.md#further-reading)

<a id="usage-references"></a>

- [使用参考](docs/README.zh-CN.md#usage-references)
<!-- generated:usage:end -->

- [完整使用指南](docs/README.zh-CN.md)
- [所有权、内容与集成](docs/CONCEPTS.zh-CN.md)
- [完整示例](./examples/)
- [升级说明](docs/MIGRATION.zh-CN.md)

<a id="documentation-and-versions"></a>

## 文档与版本

<!-- generated:documentation:start -->
包清单声明 **@zenfg/webgpu 0.2.0**. 注册表徽章显示当前发布渠道，并非已安装版本。

- 已安装版本的准确 API：查看 `package.json` → `exports` → `dist/*.d.ts`; 声明映射指向包内的 `src/`. 只有声明的导出路径属于公共 API。
- [在线指南（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/packages/webgpu.html). 网站可能包含晚于此包版本的变更。
- [TypeScript API（开发分支，英文）](https://uinosoft.github.io/zenfg/docs/api/webgpu/).
- [此发布版本的源码与文档](https://github.com/uinosoft/zenfg/tree/npm/webgpu/v0.2.0/packages/webgpu).
- 使用约定由本包维护，请阅读包内指南。历史源码链接对应指定发布版本，可能早于当前开发分支。
- [包升级说明](docs/MIGRATION.zh-CN.md).
- [纯 Markdown 文档索引（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/llms.txt).
- 包内完整示例： [examples](examples/README.zh-CN.md).
<!-- generated:documentation:end -->
