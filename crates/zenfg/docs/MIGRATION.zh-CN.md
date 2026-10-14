<!-- translation: {"version":1,"source":"crates/zenfg/docs/MIGRATION.md","sourceHash":"6fb75dc5baa139beefaaecd3d341cb4d35add0a7040884f55355940846d5c1bc","state":"ready"} -->

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

<a id="zenfg-upgrade-notes"></a>

# zenfg 升级说明

各包 API 版本与 Snapshot 线协议版本相互独立。下文所述历史变更适用于列出的版本，不代表所有当前集成方式。

<a id="rust-compilation-report-json"></a>

## Rust 编译报告 JSON

现在，Rust 编译报告的 `serde` 表示会保留此前在序列化时被跳过的生产事实：节点录制顺序、调试组关系、被裁剪节点的原因，以及完整报告中的调试组。缺少新增必需字段的现有报告 JSON，例如 `recording_order`、被裁剪节点的 `reason` 或 `debug_groups`，可能无法再反序列化。

请从原录制重新生成已持久化的报告，或在应用边界根据实际缺失事实转换报告。不要随意填入默认值后就假定捕获语义相同。Rust 编译报告 JSON 与可移植的 Snapshot 1.2 约定不同；现有有效 Snapshot 捕获数据仍保持兼容。

<a id="native-validation-and-copies"></a>

## 原生校验与复制

图校验涵盖所有权、范围、内容、使用约定和有界规划。原生描述符、设备限制、复制对齐、aspect 和重叠仍由 wgpu 校验。零尺寸复制不会影响图内容；带行或层间距的纹理到缓冲区复制会保留所需的原有内容。

<a id="unified-timing-in-beta4"></a>

## beta.4 中的统一计时

将 execute_with_gpu_timing 替换为 execute_with_timing，并使用 TimingMode::Gpu、Cpu 或 Both。CPU 报告会立即提供；GPU 回读单独进行。普通执行不收集计时数据。导出时应使用同一帧的编译、计时和资源池事实，并明确标识帧；异步回读前先保留立即可用的事实。

<a id="runtime-integrations"></a>

## 运行时集成

在 Rust 中，将 `root.producers` 替换为 `root.resolution.producer_node_ids`。`root.resolution.uses_initial_contents` 表示已定义的初始内容是否参与结果生成。`SnapshotRoot` 现在是带原因标签的枚举；创建和匹配时使用它的变体，读取信息时使用 `resource()`、`node_id()` 和 `reason()`，不要再访问旧结构体字段。

带范围的根会规范化纹理视图和缓冲区范围。根范围内含未定义或已丢弃的内容时，即使未启用报告也会以 FG1004 失败。空根范围无效；普通的空缓冲区访问仍有效。根的身份由资源、原因和规范化范围共同确定，不再只看数组索引或资源本身。

<a id="timing-and-snapshot-export-in-020"></a>

## 0.2.0 中的计时与 Snapshot 导出

GPU 计时的 no-timed-nodes 表示计时不可用，并非可用的零时长读数。现有的 2048 个渲染/计算计时节点限制会保留执行和 CPU 报告。Snapshot 导出方要求计时 ID、顺序和节点类型与保留后的编译顺序一致；按顺序覆盖部分节点仍然有效。不匹配时会返回 SnapshotExportError::InvalidTimingReport。编译、计时和资源池事实应来自同一个编译帧，不能仅凭数值帧索引相同就合并。

<a id="release-history"></a>

## 发布历史

各包版本和历史验收依据见[组件发布说明](https://github.com/uinosoft/zenfg/tree/cargo/zenfg/v0.2.0/docs/releases)。
