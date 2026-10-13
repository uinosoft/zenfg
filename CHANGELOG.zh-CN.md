<!-- translation: {"version":1,"source":"CHANGELOG.md","sourceHash":"7f92adde93babff0aead9508f222f2620519c25c45d0027392c3788ea0fde72e","state":"ready"} -->

<a id="changelog"></a>

# 更新日志

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./CHANGELOG.md
[documentation-zh]: ./CHANGELOG.zh-CN.md
<!-- generated:language:end -->

本文记录 ZenFG 的重要变更。五个可发布包分别维护版本号，并通过组件标签标识各自的版本。

<a id="unreleased"></a>

## 未发布

- 在运行时指南中说明诊断分组、重复的 Bloom 阶段，以及原生资源所有权与图中可见访问之间的区别；并将精简的分组/资源规则和 Inspector 展示指南整理为 npm Skills。

- 将运行时、Snapshot 和 Inspector 的使用/升级指南放在所属包旁。在三个 npm 产物中随包发布可复现且纳入版本控制的 Agent Skills，并提供包内参考资料及 pnpm 发现/审批检查。Rust 指南继续归所属 crate 管理；Rust Skill 的分发暂缓。保留文档路由和历史发布记录，不更改已发布版本。

- 为 `@zenfg/webgpu` 和 `zenfg` 增加显式的运行时资源池作用域及同步谓词驱逐。作用域隔离瞬态别名与复用；谓词接收只读物理规格和空闲执行次数。导入资源仍归调用方所有。全清默认行为、累计计数器和 Snapshot 1.2 线格式保持不变。

<a id="runtime-and-inspector-020-snapshot-packages-011---2026-10-10"></a>

## 运行时与 Inspector 0.2.0、Snapshot 包 0.1.1 - 2026-10-10

| 包 | 版本 |
| --- | --- |
| `@zenfg/webgpu` | 0.2.0 |
| `@zenfg/inspector` | 0.2.0 |
| `zenfg` | 0.2.0 |
| `@zenfg/snapshot` | 0.1.1 |
| `zenfg-snapshot` | 0.1.1 |

各包版本仍彼此独立。运行时和 Inspector 包固定依赖 Snapshot 0.1.1；可移植 Snapshot 线格式仍为 1.2。详见[迁移指南](docs/migration-0.2.0.zh-CN.md)。

<a id="compatibility"></a>

### 兼容性

- 扩展 WebGPU 现有 `FrameGraphError` 的覆盖范围，并将句柄公开的 `__brand` 字段替换为私有唯一 symbol 类型标记。更新对内置错误的精确判断，以及会构造或检查标记的集成代码。
- 保留此前被跳过的 Rust 编译报告 Serde 字段。缺少新增必需生产者信息的已持久化报告 JSON 可能需要重新生成或由应用适配；这不影响可移植 Snapshot 的兼容性。
- 原生能力、描述符和命令校验仍由浏览器 WebGPU 或 wgpu 负责。部分原生失败现在会在分配或编码阶段发生，而不是图录制阶段；宿主仍须处理错误。
- Inspector 初始时隐藏资源声明节点。设置 `showResourceDeclarations: true` 可恢复此前的初始图视图。

<a id="added-and-fixed"></a>

### 新增与修复

- 为 WebGPU 增加可选的 `render({ webgpuDescriptor })` 透传，以支持调用方所有的原生描述符字段，同时仍由图管理附件、标签和计时写入。显式 `uses`、功能检测、管线兼容性和原生对象生命周期仍由应用负责。这并非完整的 bindless 集成；扩展字段尚未在真实 GPU 上验证。
- 从 `@zenfg/webgpu/snapshot` 重新导出可移植 Snapshot 类型、规范序列化器和验证错误；允许在没有资源池计数器时导出 Snapshot。
- 增加带类型的 WebGPU CPU/GPU/both 计时结果；两个运行时都改为报告 `no-timed-nodes`，不再将无节点计时表示成可用的零耗时 GPU 测量。
- 使 Rust 通道完成和组合访问录制具备原子性，并统一解析纹理视图层。
- 回滚失败的 WebGPU 资源池获取操作。
- 为 Inspector 增加概览指标、关系聚焦、图搜索和缩放控件；提升面板可读性、详情视图的响应式布局、键盘交互和异步状态保留能力。
- 将省略的 WebGPU 清除范围归一化到逻辑缓冲区边界，使依赖报告与原生命令清除相同的字节。
- 当纹理回读占用范围包含行或层填充时，保留缓冲区中已初始化的内容。单行或单层时未使用的步幅不会让连续复制变成保留式写入；两个运行时采用相同规则。
- 保留的渲染/计算节点超过 2048 个、会导致时间戳查询超过 4096 个时，WebGPU 以 `too-many-timed-nodes` 报告 GPU 计时不可用。执行仍正常提交，`both` 模式仍保留 CPU 计时。
- 在解析发生冲突的本地资源 ID 之前，先以 `ForeignHandle` 拒绝来自其他图或录制的 Rust 访问令牌。
- 使用线性迭代遍历校验 Snapshot 分组祖先关系，同时保留问题消息、顺序和重复 ID 的首个匹配引用。以迭代方式遍历 WebGPU 节点保留关系，支持较长的依赖链。
- 在原生分配前校验与设备无关的纹理描述符结构及保留瞬态分配的用途。浏览器 WebGPU 仍使用采样数 1 和 4；Rust 保留原生 wgpu 的采样数能力。在 Snapshot 合约能够表示 `TRANSIENT_ATTACHMENT` 前，该用途明确不受支持。
- 将零尺寸缓冲区和纹理复制保留为原生空操作命令，同时从 FrameGraph 内容依赖、输出生成和访问报告中排除。
- 若纹理格式没有可用于 FrameGraph 依赖跟踪的已知复制占用范围，则在录制时拒绝非空的缓冲区-纹理复制。纹理内存大小估算仍与缓冲区复制布局元数据分开处理。
- 为 ZenFG 检出的 `@zenfg/webgpu` 验证失败提供结构化的 `FrameGraphError` 代码及阶段/位置元数据。原先精确判断 `TypeError` 或普通 `Error` 的代码应改为检查 `FrameGraphError.code`。
- 重新导出 `FrameGraphSnapshotValidationError`（来自 `@zenfg/webgpu/snapshot`），并将未知用途位报告为 Snapshot 问题。
- 导出 Snapshot 时，拒绝节点 ID、顺序或种类与保留编译序列不符的运行时 CPU 及可用 GPU 计时报告，同时保留 Snapshot 1.2 的部分覆盖合约。

<a id="per-package-notes"></a>

### 各包说明

- [@zenfg/webgpu 0.2.0](docs/releases/npm-webgpu-0.2.0.md)
- [@zenfg/inspector 0.2.0](docs/releases/npm-inspector-0.2.0.md)
- [@zenfg/snapshot 0.1.1](docs/releases/npm-snapshot-0.1.1.md)
- [zenfg 0.2.0](docs/releases/cargo-zenfg-0.2.0.md)
- [zenfg-snapshot 0.1.1](docs/releases/cargo-zenfg-snapshot-0.1.1.md)

## [0.1.0] - 2026-09-15

- 将全部五个包作为首个正式版本发布，保留 beta.4 的公开 API、运行时行为和 Snapshot 1.2 兼容性。
- 将内部精确依赖和公开安装文档更新至 0.1.0。npm 包使用 `latest` 通道；从 beta.4 升级无需迁移。


- 改进发布工具：增加只读包评估、registry 进度、Node 24 产物 Actions、去重后的 PR CI，以及不依赖版本号的黄金测试。这些工具变更不影响运行时 API。

## [0.1.0-beta.4] - 2026-09-15

本次协调发布将全部五个公开包更新为 0.1.0-beta.4。之后各包仍独立维护版本。

<a id="breaking-changes"></a>

### 破坏性变更

- TypeScript 和 Rust 将仅支持 GPU 的执行入口替换为统一的 CPU/GPU/both 计时 API。普通执行不收集计时。
- Snapshot 1.2 会写入 CPU 和 GPU 可用性记录。读取方会显式迁移已验证的 1.1 输入；规范版 1.0 仍会被拒绝。
- TypeScript Snapshot 要求显式提供帧索引；Inspector 的数据提供方计时请求须通过宿主适配器转发。
- 参见[迁移指南](docs/migration-timing-snapshot-1.2.zh-CN.md)。

<a id="added-and-fixed-1"></a>

### 新增与修复

- 为所有已执行节点类型增加 CPU 计时及同步执行总耗时；在 GPU 回读前采集 CPU/资源池信息，以保留同帧数据。
- 加强 Snapshot 对继承字段的校验，并统一 Rust/TypeScript 的标识符、数值和迁移行为。
- 改进 Inspector 的 CPU 测量、主题、搜索、导航、响应式详情视图和捕获替换失效处理；延迟加载非活动视图。
- 更新包内文档和示例。新增自动生成的文档网站、PlayCanvas GSplat 演示，以及可分享的 Canvas 全屏模式。
- 增加逐包批准的 OIDC 发布流程，并验证归档文件和隔离的 registry 消费方。

<a id="per-package-notes-1"></a>

### 各包说明

- [@zenfg/snapshot](docs/releases/npm-snapshot-0.1.0-beta.4.md)
- [zenfg-snapshot](docs/releases/cargo-zenfg-snapshot-0.1.0-beta.4.md)
- [@zenfg/webgpu](docs/releases/npm-webgpu-0.1.0-beta.4.md)
- [zenfg](docs/releases/cargo-zenfg-0.1.0-beta.4.md)
- [@zenfg/inspector](docs/releases/npm-inspector-0.1.0-beta.4.md)

## [0.1.0-beta.3] - 2026-09-07

<a id="breaking-changes-1"></a>

### 破坏性变更

- 将 Snapshot 规范线格式从 1.0 升级到 1.1。两个解码器都会拒绝规范版 1.0；仍支持 Legacy V0 和 Legacy Candidate V1。
- 原生 Snapshot 1.1 要求资源根范围经过归一化，并解析最终内容。根现在区分资源选择与副作用。
- Rust 将 `RootReport.producers` 替换为 `RootReport.resolution.producer_node_ids`，并将 `SnapshotRoot` 从结构体改为带原因标签的枚举。
- WebGPU 编译时以 FG1004 拒绝所选根中未定义或已丢弃的内容，并拒绝空资源根范围。

<a id="added-and-changed"></a>

### 新增与变更

- 为 WebGPU 增加缓冲区范围和纹理视图根选择、最终写入者与初始内容报告，以及对应的跨语言一致性覆盖。
- 将 Inspector 可视化统一为 Frame Flow，加入输出端点、范围标识和最终内容来源，并优化标签、颜色和图例。
- 新增公开 Examples、可运行的包级示例、交互式背景，以及注明来源的 TypeGPU 黏菌演示。

协调全部五个包发布为 `0.1.0-beta.3`，并固定内部精确依赖。参见 [beta.3 迁移指南](docs/migration-0.1.0-beta.3.zh-CN.md)。

## [0.1.0-beta.2] - 2026-09-02

- 使 WebGPU 纹理尺寸和复制操作输入类型与运行时现有的可迭代对象支持保持一致，包括类型化数组形式的范围和原点，并在编译与执行前物化这些输入。
- 修复 Rust/wgpu 在编译保留非连续录制分组 ID 时的 GPU 调试分组执行及计时祖先关系。
- 统一 Inspector 导出菜单，优化图缩放行为，并改进大型图或新加载图的视口取景。
- 重新组织公开文档，围绕双语项目入口、包内快速参考、统一的 Core Concepts 指南，以及明确的 API 文档、示例和未来交互式故事事实来源策略展开。

本次发布协调全部五个包至 `0.1.0-beta.2`，使包内文档和内部精确依赖保持一致。

## [0.1.0-beta.1] - 2026-09-01

Inspector 现在是尺寸随宿主调整且始终可见的工作台，并集成品牌标识、文件选择和拖放功能。预发布版中的可折叠外壳及其 `expanded`/`setExpanded()` API 已移除。

WebGPU 运行时现在会同时通过 TypeScript 类型和运行时检查强制执行同步回调。Render、compute、command、外部提交、`beforeSubmit` 和 `afterSubmit` 回调必须返回 `undefined`；类 Promise 结果会被拒绝，不会等待。`execute()` 还会在分配资源或启动 GPU 工作前拒绝无效的 `frameIndex`。

首批公开 beta 版本：

- [`@zenfg/snapshot@0.1.0-beta.1`][npm-snapshot-0.1.0-beta.1]
- [`@zenfg/webgpu@0.1.0-beta.1`][npm-webgpu-0.1.0-beta.1]
- [`@zenfg/inspector@0.1.0-beta.1`][npm-inspector-0.1.0-beta.1]
- [`zenfg-snapshot@0.1.0-beta.1`][cargo-snapshot-0.1.0-beta.1]
- [`zenfg@0.1.0-beta.1`][cargo-zenfg-0.1.0-beta.1]

此候选版本建立了独立的 TypeScript/WebGPU 和 Rust/wgpu FrameGraph 运行时、与渲染器无关的 Inspector、跨语言一致性夹具，以及手动包验证流程。

开发者和编程代理的易用性也是此候选版本的契约组成部分：

- 一份精简 Quick Reference 对照包选择、生命周期、所有权、内容语义、常见任务、TypeScript/Rust 名称及故障修复；
- 通过公开 TSDoc/rustdoc、自包含的包 README 和完整可编译示例记录受支持的工作流，无需搜索仓库；
- npm 声明映射指向包内源文件，Rust crate README 则作为经过测试的 crate 级文档；
- 发布检查验证文档、示例、包内容和链接完整性，同时不改变运行时 API 或 Snapshot 1.0 语义。

首个公开版本发布前，此候选版本还加强了 Snapshot 解码：

- TypeScript 程序化解码、校验和编码会拒绝非 JSON 运行时值，不调用 getter 或 `toJSON` 钩子，也不泄漏原生序列化错误；Legacy Candidate V1 迁移采用写时复制，不会修改调用方输入或静默丢弃无效数据；
- Snapshot 1.0 为每个扩展值规定统一的最大容器深度 64 层（对象/数组），Schema 以及 TypeScript 和 Rust 校验器均会强制执行，并使用稳定问题代码 `extension-depth-exceeded`。

各包版本与 ZenFG FrameGraph Snapshot 线格式相互独立；此候选版本的线格式为 `1.0`。

[Unreleased]: https://github.com/uinosoft/zenfg/compare/cargo/zenfg/v0.2.0...HEAD
[0.1.0]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0
[0.1.0-beta.4]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
[npm-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fsnapshot%2Fv0.1.0-beta.1
[npm-webgpu-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fwebgpu%2Fv0.1.0-beta.1
[npm-inspector-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Finspector%2Fv0.1.0-beta.1
[cargo-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg-snapshot%2Fv0.1.0-beta.1
[cargo-zenfg-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
