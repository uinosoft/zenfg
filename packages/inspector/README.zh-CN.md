<!-- translation: {"version":1,"source":"packages/inspector/README.md","sourceHash":"e433f1b82aaf471c73616a6005443696f43fc3c6407e00ffca5784b2ee5c4deb","state":"ready"} -->

# @zenfg/inspector

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->

<!-- usage-source: GUIDE.md -->

<!-- generated:badges:start -->
[![@zenfg/inspector published latest version](https://img.shields.io/npm/v/%40zenfg%2Finspector/latest?label=npm)](https://www.npmjs.com/package/@zenfg/inspector)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/inspector/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.2.0/LICENSE)
<!-- generated:badges:end -->

`@zenfg/inspector` 是用于检查 ZenFG Snapshot 数据的可嵌入式 DOM 工作台，与具体渲染器无关。它依赖 `@zenfg/snapshot`、Cytoscape 和 ELK，不依赖 WebGPU、wgpu、游戏引擎或宿主 UI。

<a id="installation"></a>

## 安装

<!-- generated:installation:start -->
```sh
npm install @zenfg/inspector@0.2.0
```
<!-- generated:installation:end -->

## Agent Skills

此开发版本随附英文 [zenfg-inspector Skill](./skills/zenfg-inspector/SKILL.md)，用于指导
工作台嵌入、实时捕获、导入、主题和资源清理。
Skills 支持尚未发布：已发布的 0.2.0 包不包含此能力。
请使用明确随包提供 Skills 的发布版本，或从此分支构建的 tarball。

使用 pnpm 12.11.0 或更高版本（已验证 12.11.2），先将上述包安装为应用的直接依赖，然后运行：

```sh
pnpm approve
pnpm install
```

在交互提示中批准此包的 Skills；构建脚本权限单独控制。pnpm 会将已批准的 Skills
链接到受支持的项目代理目录。如果没有合适的目录，请在安装前配置 `skills.dirs`。
目录选择和批准细节见 [pnpm Agent Skills](https://pnpm.io/agent-skills)。
编程助手会读取链接的 Skill 及其引用的包内资料。

<a id="quick-start"></a>

## 快速入门

导入方式、调用方提供的输入及执行生命周期见[完整快速入门](GUIDE.zh-CN.md#quick-start)。

<a id="guides"></a>

## 指南

<!-- generated:usage:start -->
<a id="themes-and-style-customization"></a>

- [主题与样式自定义](GUIDE.zh-CN.md#themes-and-style-customization)

<a id="common-tasks"></a>

- [常见任务](GUIDE.zh-CN.md#common-tasks)

<a id="common-mistakes"></a>

- [常见错误](GUIDE.zh-CN.md#common-mistakes)

<a id="further-reading"></a>

- [延伸阅读](GUIDE.zh-CN.md#further-reading)

<a id="cpu-and-gpu-capture"></a>

- [CPU 与 GPU 捕获](GUIDE.zh-CN.md#cpu-and-gpu-capture)

<a id="analyze-and-verify-a-frame"></a>

- [分析并验证一帧](GUIDE.zh-CN.md#analyze-and-verify-a-frame)

<a id="workbench-behavior"></a>

- [工作台行为](GUIDE.zh-CN.md#workbench-behavior)

<a id="timing-and-memory-interpretation"></a>

- [计时与内存信息解读](GUIDE.zh-CN.md#timing-and-memory-interpretation)

<a id="frame-flow-interaction"></a>

- [Frame Flow 交互](GUIDE.zh-CN.md#frame-flow-interaction)

<a id="usage-references"></a>

- [使用参考](GUIDE.zh-CN.md#usage-references)
<!-- generated:usage:end -->

<a id="workbench-guide"></a>

- [完整使用指南](GUIDE.zh-CN.md)
- [主题](THEMING.zh-CN.md)
- [升级说明](docs/MIGRATION.zh-CN.md)

<a id="documentation-and-versions"></a>

## 文档与版本

<!-- generated:documentation:start -->
包清单声明 **@zenfg/inspector 0.2.0**. 注册表徽章显示当前发布渠道，并非已安装版本。

- 已安装版本的准确 API：查看 `package.json` → `exports` → `dist/*.d.ts`; 声明映射指向包内的 `src/`. 只有声明的导出路径属于公共 API。
- [在线指南（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/packages/inspector.html). 网站可能包含晚于此包版本的变更。
- [TypeScript API（开发分支，英文）](https://uinosoft.github.io/zenfg/docs/api/inspector/).
- [此发布版本的源码与文档](https://github.com/uinosoft/zenfg/tree/npm/inspector/v0.2.0/packages/inspector).
- 使用约定由本包维护，请阅读包内指南。历史源码链接对应指定发布版本，可能早于当前开发分支。
- [包升级说明](docs/MIGRATION.zh-CN.md).
- [纯 Markdown 文档索引（开发分支）](https://uinosoft.github.io/zenfg/docs/zh-CN/llms.txt).
- 包内指南： [工作台](GUIDE.zh-CN.md) and [主题](THEMING.zh-CN.md).
<!-- generated:documentation:end -->
