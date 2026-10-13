<!-- translation: {"version":1,"source":"crates/zenfg/README.md","sourceHash":"c38ec210dabe418b3c6446cf8bd1cc1b4f40627e8f333357a7e25b81df8eabfa","state":"ready"} -->

# zenfg

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

<!-- usage-source: docs/README.md -->

<!-- generated:badges:start -->
[![zenfg published version](https://img.shields.io/crates/v/zenfg?include_prereleases)](https://crates.io/crates/zenfg)
[![docs.rs](https://img.shields.io/docsrs/zenfg/0.2.0)](https://docs.rs/zenfg/0.2.0/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/LICENSE)
<!-- generated:badges:end -->

`zenfg` 是适用于 wgpu、与渲染器无关的 FrameGraph 编译器和瞬态资源执行器。它会记录逻辑资源及其访问、校验内容流、构建依赖、裁剪无用工作、推导使用标志、规划瞬态资源别名，并可选择在调用方拥有的设备和队列上实例化保留的工作。

<a id="installation"></a>

## 安装

<!-- generated:installation:start -->
```sh
cargo add zenfg@=0.2.0
```
<!-- generated:installation:end -->

<a id="quick-start"></a>

## 快速入门

导入方式、调用方提供的输入及执行生命周期见[完整快速入门](docs/README.zh-CN.md#quick-start)。

<a id="guides"></a>

## 指南

<!-- generated:usage:start -->
<a id="features"></a>

- [功能特性](docs/README.zh-CN.md#features)

<a id="lifecycle"></a>

- [生命周期](docs/README.zh-CN.md#lifecycle)

<a id="diagnostic-grouping"></a>

- [诊断分组](docs/README.zh-CN.md#diagnostic-grouping)

<a id="bloom-grouping-adapter"></a>

- [Bloom 分组适配器](docs/README.zh-CN.md#bloom-grouping-adapter)

<a id="validation-boundary"></a>

- [校验边界](docs/README.zh-CN.md#validation-boundary)

<a id="common-tasks"></a>

- [常见任务](docs/README.zh-CN.md#common-tasks)

<a id="key-pattern-bind-and-resolve-typed-access"></a>

- [关键模式：绑定并解析类型化访问](docs/README.zh-CN.md#key-pattern-bind-and-resolve-typed-access)

<a id="resource-and-integration-choices"></a>

- [资源与集成方式](docs/README.zh-CN.md#resource-and-integration-choices)

<a id="common-mistakes"></a>

- [常见错误](docs/README.zh-CN.md#common-mistakes)

<a id="complete-examples"></a>

- [完整示例](docs/README.zh-CN.md#complete-examples)

<a id="resource-pool-maintenance"></a>

- [资源池维护](docs/README.zh-CN.md#resource-pool-maintenance)

<a id="further-reading"></a>

- [延伸阅读](docs/README.zh-CN.md#further-reading)

<a id="execution-timing"></a>

- [执行计时](docs/README.zh-CN.md#execution-timing)

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
包清单声明 **zenfg 0.2.0**. 注册表徽章显示当前发布渠道，并非已安装版本。

- 已安装版本的准确 API：阅读包内的 `src/`, 或运行 `cargo doc --open` （在使用该包的项目中）。
- [在线指南（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/packages/zenfg.html). 网站可能包含晚于此包版本的变更。
- [此版本的 Rust API（英文）](https://docs.rs/zenfg/0.2.0/).
- [此发布版本的源码与文档](https://github.com/uinosoft/zenfg/tree/cargo/zenfg/v0.2.0/crates/zenfg).
- 使用约定由本包维护，请阅读包内指南。历史源码链接对应指定发布版本，可能早于当前开发分支。
- [包升级说明](docs/MIGRATION.zh-CN.md).
- [纯 Markdown 文档索引（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/llms.txt).
- 完整 Cargo 示例位于 `examples/`.
<!-- generated:documentation:end -->
