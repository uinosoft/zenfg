<!-- translation: {"version":1,"source":"packages/snapshot/SPEC.md","sourceHash":"c300f263ff9ca94e3b4b40a287a53957751c9252f75da73c549a95d5c301e70e","state":"ready"} -->

<a id="framegraph-snapshot-12-specification"></a>

# FrameGraph Snapshot 1.2 规范

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./SPEC.md
[documentation-zh]: ./SPEC.zh-CN.md
<!-- generated:language:end -->

<a id="1-status-and-terminology"></a>

## 1. 状态与术语

本文以与语言无关的方式规范定义 FrameGraph Snapshot 1.2。MUST、MUST NOT、REQUIRED、SHOULD、SHOULD NOT 和 MAY 等关键词规定了生产者与消费者必须遵守的要求。

Snapshot 是对一个已编译 FrameGraph 帧的诊断描述。它不包含 GPU 命令、着色器、资源内容、屏幕截图或 UI 工作区状态，因此 MUST NOT 被视为回放格式。

JSON Schema 规范性地定义结构校验；本文规范性地定义引用、顺序、可用性及其他跨字段语义。Snapshot 只有同时满足这两个层面的要求才有效。

<a id="2-encoding-format-and-versions"></a>

## 2. 编码、格式与版本

- 文件 MUST 使用 UTF-8 JSON，通常以 `.fgsnapshot.json` 为扩展名。
- `format` MUST 为 `zenfg.frame-graph-snapshot`。
- 1.2 版本表示为 `{ "major": 1, "minor": 2 }`。不再接受规范版 1.0。
- 读取方 MUST 按下文说明显式迁移规范版 1.1。读取方 MUST 拒绝所有其他不受支持的版本，且 MUST NOT 猜测兼容性。
- 规范版 V1 指当前 V1 数据模型；它不规定对象键顺序、无意义空白或逐字节一致的规范 JSON。
- 所有计数、字节大小、帧索引、排序索引、偏移量和长度 MUST 为非负 JavaScript 安全整数（`0..9007199254740991`）。纹理尺寸、mip 数、采样数、数组层数和深度切片数 MUST 为正数。
- 时长以微秒为单位，MUST 是有限且非负的 JSON 数值。

<a id="3-identifiers-and-strings"></a>

## 3. 标识符与字符串

已声明实体的 ID MUST 为非空字符串，并使用下列精确前缀：

| 实体 | 前缀 |
| --- | --- |
| group | `group:` |
| node | `node:` |
| resource | `resource:` |
| texture view | `view:` |
| access | `access:` |
| segment | `segment:` |
| allocation | `allocation:` |

ID 后缀 MUST 非空，且 MUST NOT 包含换行符 U+000A (LF)、U+000D (CR)、U+2028（行分隔符）或 U+2029（段落分隔符）。后缀可以包含其他空白和 Unicode 字符。

同一 Snapshot 中所有已声明实体 ID MUST 全局唯一。`compatibility:` ID 是等价类标记，并非已声明实体；兼容的分配可有意复用同一标记。运行时资源池分区可能限制兼容关系：对于属于不同分区的分配，生产者 MUST 使用不同标记，但不得暴露运行时或资源池实例身份。分区标记仅在单次捕获中有效；线格式不变。

`stableKey` 为可选项。生产者无法提供可靠身份时 MUST 省略它。除非 Schema 另有规定，纹理格式、尺寸、切面、通道映射、生产者元数据和运行时元数据均为非空的不透明字符串。生产者 SHOULD 使用 WebGPU 的名称写法。消费者 MUST 保留并显示未知的不透明值。资源来源、用途标志、节点类型、访问类型、根原因和分段类型均为封闭的 V1 枚举。

<a id="4-capture-metadata-and-unknown-facts"></a>

## 4. 捕获元数据与未知事实

`capture.frameIndex` 标识所捕获的帧。若存在，`capturedAt` 属于生产者元数据，不影响图语义。

所有新生产者 MUST 将 `resource.initialContents` 写为 `defined` 或 `undefined`。瞬态资源和表面资源 MUST 为 `undefined`；导入资源可使用任一值。若历史迁移无法还原导入资源的初始状态，可以省略该字段；省略表示未知。

缺少可选标量或对象表示该事实未知，并不表示零或空。必需数组始终是已知的，即使数组为空也是如此；但 Legacy 迁移明确将表级事实标为不可用时除外：

```json
{
  "migration": {
    "sourceFormat": "legacy-v0",
    "unavailableFacts": ["graph.textureViews", "graph.nodes.recordingOrder"]
  }
}
```

允许标记为不可用的事实及其不变量如下：

- `graph.groups`：`groups` 为空，且节点/资源不含 `groupId` 字段。
- `graph.textureViews`：`textureViews` 为空，且访问不含 `textureViewId` 字段。
- `graph.nodes.recordingOrder`：所有 `recordingOrder` 字段均缺失；MUST NOT 将节点数组顺序解释为原始录制顺序。
- `graph.accesses.regions`：一个或多个访问缺少对应范围。已提供的范围仍具有权威性且 MUST 有效。
- `graph.roots.range`：一个或多个资源根缺少归一化范围。
- `graph.roots.resolution`：一个或多个资源根缺少最终内容解析结果。缺失的解析结果表示未知，并非空生产者列表或 false。

若未声明对应事实不可用，则适用正常的 V1 完整性规则。迁移元数据属于规范版 V1，重新编码时 MUST 保留。

<a id="5-graph-tables-and-ordering"></a>

## 5. 图数据表与排序

- `groups` 按分组创建/打开顺序排列。父级 MUST 出现在子级之前。父级引用 MUST 存在且 MUST NOT 构成环。
- 原生 `nodes` 按录制顺序排列。每个节点的 `recordingOrder` 均等于其数组索引。保留和裁剪的节点共用此表。
- 保留节点的 `executionOrder` 值构成连续范围 `0..N-1`。
- 除非另有说明，资源、纹理视图、访问、依赖、根和分配数组的顺序均无语义含义。
- 每个引用 MUST 解析到其字段所要求类型的已声明实体。
- 纹理视图 MUST 引用纹理资源。访问中的视图与资源 MUST 标识同一资源。资源与其分配 MUST 具有相同种类。
- `side-effect` 根 MUST 只引用保留节点。其他所有根原因 MUST 只引用资源。

若存在，资源的 `lifetime.firstUse` 和 `lastUse` 使用保留节点的执行顺序索引，须满足 `firstUse <= lastUse`，且落在 `0..N-1` 范围内。

依赖引用保留节点和现有资源。它们 MUST 从较早的执行顺序指向较晚的执行顺序。`fromNodeId`、`toNodeId`、`resourceId` 和 `kind` 均相同的重复元组无效。

分段按执行顺序排列，且 `segment.order` 等于其数组索引。每个分段至少包含一个保留节点。依次拼接所有分段的 `nodeIds`，结果必须恰好是按执行顺序排列的全部保留节点，且每个节点仅出现一次。`external-submission` 分段恰好包含一个 `external-submission` 节点；`frame-graph` 分段不得包含此类节点。

<a id="6-accesses-and-regions"></a>

## 6. 访问与区域

访问仅存在于中央 `graph.accesses` 表中。资源和节点 MUST NOT 重复保存访问列表。

| 访问种类 | 必需模式 |
| --- | --- |
| `texture-sampled` | read |
| `texture-storage-read` | read |
| `texture-depth-read` | read |
| `texture-copy-src` | read |
| `buffer-uniform` | read |
| `buffer-storage-read` | read |
| `buffer-vertex` | read |
| `buffer-index` | read |
| `buffer-indirect` | read |
| `buffer-copy-src` | read |
| `texture-storage-write` | write |
| `texture-color-attachment-write` | write |
| `texture-depth-write` | write |
| `texture-copy-dst` | write |
| `buffer-storage-write` | write |
| `buffer-copy-dst` | write |

读取访问将 `producesValue` 设为 false，并省略 `contents`。写入访问必须包含 `contents`（`overwrite` 或 `preserve`）和布尔值 `producesValue`。`contents` 表示此次写入是否依赖此前内容；`producesValue` 表示产生的逻辑值能否供后续读取。两者相互独立。

纹理访问必须包含 `textureRegion`，且不得包含 `bufferRange`。缓冲区访问必须包含 `bufferRange`，且不得包含 `textureRegion` 和 `textureViewId`。纹理复制访问也不得包含 `textureViewId`。其他纹理访问 MAY 引用显式逻辑视图。缓冲区范围省略 `size` 表示一直到缓冲区末尾，并非未知。

纹理区域的 mip 数必须为正，且恰好包含一种完整区间：`baseArrayLayer` 与 `arrayLayerCount`，或 `baseDepthSlice` 与 `depthSliceCount`。MUST NOT 同时包含两种区间形式。

<a id="7-roots-and-final-contents"></a>

## 7. 根与最终内容

原生 1.2 资源根 MUST 包含 `range` 和 `resolution`。缓冲区范围包含 `kind: "buffer"`、已解析的 `offset` 和正数 `size`。纹理范围包含 `kind: "texture"`，以及使用上述纹理区域字段的非空归一化 `regions`。范围 MUST 与资源种类相符，且不得超出其描述符定义的边界；3D 纹理还须考虑随 mip 变化的深度。根范围不能为空；普通空缓冲区访问的合约不因此改变。

根的身份由资源 ID、原因和归一化范围构成，绝不由数组位置或纹理视图 ID 决定。生产者会去重完全相同的声明，独立保留不同范围，且不会合并重叠的根。纹理生产者按 mip 和切面归一化所选区域，并解析切片区间。

`resolution` 仅包含 `producerNodeIds` 和 `usesInitialContents`。生产者 ID MUST 是按执行顺序排列且互不重复的保留节点，用于标识对所选范围有贡献的所有最终写入者。若已定义的初始内容有贡献，则 `usesInitialContents` 为 true；它 MAY 与非空生产者 ID 同时出现。至少必须有一个生产者或初始内容作出贡献。无论是否启用诊断报告，编译器 MUST 拒绝所选内容中部分未定义或已丢弃的情况（FG1004）。副作用根既没有范围，也没有解析结果。

历史迁移 MAY 省略不可用的范围或解析结果，并声明上文对应的不可用事实。MUST NOT 根据图可达性猜测最终写入者。Inspector 会保留来源未知的输出端点，不会虚构来源边。历史根若有歧义，则无法提供跨捕获稳定的选择身份。

<a id="8-memory-timing-diagnostics-and-extensions"></a>

## 8. 内存、计时、诊断与扩展

资源仅单向指向分配；分配不会重复列出资源 ID。分段同样只单向列出节点。消费者应自行构建反向索引。

分配与资源池报告以及 GPU 计时，均使用明确的 `available` 或 `unavailable` 变体。不可用原因不得为空。可用的 GPU 计时对每个保留的渲染或计算节点最多引用一次。

`timings.cpu` 和 `timings.gpu` 均为必需字段，且彼此独立。可用的 CPU 报告包含 `executionDurationMicros`，以及 `nodes`，其中每项包含 `nodeId` 和 `durationMicros`。所有时长 MUST 为有限非负数。CPU 计时 MUST 对每个保留节点至多引用一次；所有节点类型都可参与计时。允许只覆盖部分节点；节点耗时总和无需等于执行总耗时。CPU 测量同步经过时间，包括节点本地准备和清理；它既不是线程 CPU 占用时间，也不表示 GPU 已完成。共享准备、提交和瞬态资源释放计入执行总耗时，不强行摊入各通道。读数为零不保证实际成本为零，也不保证微秒级时钟精度。未请求的计时使用 `unavailable` 和原因 `not-requested`；历史 CPU 数据使用 `not-collected`。

诊断代码不得为空。可选的节点/资源引用 MUST 能解析到对应实体。

扩展名须匹配 `^.+\..+$`，且名称任意位置 MUST NOT 含 U+000A、U+000D、U+2028 或 U+2029。允许其他空白和 Unicode 字符。扩展值 MUST 为 JSON 值：不得包含非有限数、undefined、数组空洞、宿主对象或循环引用。基本类型扩展值的容器深度为 0。作为扩展根的数组或对象深度为 1；每嵌套一层数组或对象，深度加 1。空容器也计入深度。扩展值 MUST NOT 超过 64 层容器；公开的 TypeScript 和 Rust 绑定通过 `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` 暴露此限制。

每个超出限制的扩展最多产生一个 `extension-depth-exceeded` 问题。其路径是指向扩展根的 JSON Pointer（扩展名按 JSON Pointer token 规则转义），准确消息为 `Extension JSON nesting depth must not exceed 64 container levels.` 消费者 MUST 保留自身不理解的扩展。

<a id="9-historical-migration"></a>

## 9. 历史迁移

规范版 1.1 MUST 先通过自身的结构和语义校验，其中包括拒绝 `timings.cpu` 属性。迁移会将版本改为 1.2，并添加 CPU `unavailable` / `not-collected`。此前的迁移来源、未知事实和扩展 MUST 保留；否则应记录 `sourceFormat: "snapshot-v1.1"`，并使用空的不可用事实数组。解码结果将直接来源报告为 `snapshot-v1.1`，并发出迁移警告。规范校验和序列化只接受 1.2。规范版 1.0 仍不受支持。下述 Legacy 输入也会迁移到 1.2，并将 CPU 标记为不可用。


读取方识别不带版本号的 `{ compilation, gpuTiming, resourcePool }` Legacy V0 捕获格式，以及 `zenfg.frame-graph-snapshot-candidate` Legacy Candidate V1 格式。迁移 Legacy V0 时，会将数值 ID 转换为带前缀字符串，合并保留与裁剪的节点，将 WebGPU 用途位转换为 V1 token，并将 `swapchain` 来源转换为 `surface`。

Legacy Candidate V1 会保留图事实、稳定键和命名空间扩展，修改格式标识符，将瞬态/表面内容设为 `undefined`，并移除导入资源的 `initialContents` 值，以未知状态表示其历史情况。迁移成功后，`capture.migration.sourceFormat` 记录为 `legacy-v0` 或 `legacy-candidate-v1`。历史 Rust 捕获若已将持久状态编码为 `side-effect`，则保持不变，因为无法还原其原始意图。

迁移 MUST 在转换前校验源值，并 MUST 拒绝未知用途位或格式错误的字段。MUST NOT 虚构稳定键、描述符、估算值、分组表、视图表、录制顺序、访问区域、根范围或输出解析结果。重新编码时始终写入 1.2，并持久保留 `capture.migration` 来源信息。

<a id="10-conformance"></a>

## 10. 一致性

`conformance/manifest.json` 是可移植测试索引。V1 有效案例须通过 Schema 和语义校验器；结构无效案例两者均须拒绝。语义无效案例可能通过 Schema，但必须无法通过语义校验；特意记录了这一区别。Legacy 案例不按 V1 Schema 校验，而须符合声明的解码结果和规范输出。每个案例都比较 `(code, path, message)` 问题的完整多重集合。深度 64 和 65 的案例定义了共享的扩展嵌套边界。问题数组顺序不属于协议语义；一致性实现比较前须按 `path`、`code`、`message` 排序实际和预期问题。清单中的 `requiredIssueCodes` 表记录共享覆盖范围；JSON 无法表示的程序化 JavaScript 值仍明确仅适用于 TypeScript。
