<!-- translation: {"version":1,"source":"packages/inspector/docs/MIGRATION.md","sourceHash":"e549be64650d3a3a25840d975ae08898b80f0e97fa4152b38750d69172345392","state":"ready"} -->

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

<a id="zenfginspector-upgrade-notes"></a>

# @zenfg/inspector 升级说明

各包 API 版本与 Snapshot 线协议版本相互独立。下文所述历史变更适用于列出的版本，不代表所有当前集成方式。

<a id="inspector-initial-graph-visibility"></a>

## Inspector 初始图可见性

在 Graph 视图中，资源声明节点默认隐藏。若要保留 0.1.0 的初始显示方式，请将 `showResourceDeclarations: true` 传给 `FrameGraphInspector` 或 `mountFrameGraphInspector`。用户也可以打开 Declarations 控件，或在图中显示某项资源。无论此显示设置如何，资源表和 Snapshot 数据都会保留这些声明。

重新设计的 Overview、搜索、键盘导航、关系聚焦和缩放控件不需要迁移捕获 provider API。现有受支持的初始化方式以及 CPU/GPU/both 捕获请求均可继续使用。

<a id="capture-providers-in-beta4"></a>

## beta.4 中的捕获 provider

将请求的 CPU、GPU 或 both 计时模式传递给运行时。Capture 操作会同时请求 CPU 和 GPU；导入的文件会保留捕获时已有的数据。即使不支持 timestamp-query，纯 CPU 的程序化捕获也必须能够工作。

<a id="release-history"></a>

## 发布历史

各包版本和历史验收依据见[组件发布说明](https://github.com/uinosoft/zenfg/tree/npm/inspector/v0.2.0/docs/releases)。
