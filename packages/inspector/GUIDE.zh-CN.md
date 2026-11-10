<!-- translation: {"version":1,"source":"packages/inspector/GUIDE.md","sourceHash":"2c4bd0ace235944930c633be80f473841e862dfb8d7a3e0be75a41d3cf9b3879","state":"ready"} -->

<a id="zenfginspector-usage"></a>

# @zenfg/inspector 使用指南

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./GUIDE.md
[documentation-zh]: ./GUIDE.zh-CN.md
<!-- generated:language:end -->

<a id="inspector-workbench-guide"></a>



`@zenfg/inspector` 是一个可嵌入、与渲染器无关的 DOM 工作台，用于查看 ZenFG Snapshot 数据。它依赖 `@zenfg/snapshot`、Cytoscape 和 ELK，不依赖 WebGPU、wgpu、具体引擎或宿主 UI。

通过捕获的图、资源信息和可选计时了解一帧的情况，然后将 Snapshot JSON 与代码一起导出，供人工或 AI 辅助分析。参见[分析与验证工作流](GUIDE.zh-CN.md#analyze-and-verify-a-frame)。

该包负责 Snapshot 校验、迁移、可视化和工作台状态。宿主负责工作台周围的布局、实时捕获策略、文件保留，以及生成 Snapshot 数据的渲染器。

资源和访问统计描述的是图中捕获到的声明。它们不会自动扫描所有着色器绑定，也不会测量 GPU 总内存；工作负载私有的缓冲区可能不会出现在数据中。更明确的声明有助于诊断。参见[选择资源声明粒度](https://uinosoft.github.io/zenfg/docs/zh-CN/concepts/webgpu.html#choosing-resource-declaration-granularity)。

<!-- skill:description:start -->
使用 @zenfg/inspector 嵌入 Snapshot 工作台、连接实时捕获、导入诊断、自定义主题，或释放 Inspector 实例。
<!-- skill:description:end -->

<!-- skill:quick-start:start -->
<a id="quick-start"></a>

## 快速入门

在现有 TypeScript 应用中，使用现代浏览器运行此示例。为宿主元素设置明确尺寸（例如 `height: 600px`），并提供有效的 Snapshot 捕获数据。调用下面的 `mountInspector(host, capture)`；返回的函数用于移除工作台。

将 Inspector 挂载到宿主元素，并提供可选的实时捕获回调：

```ts
import { mountFrameGraphInspector, type FrameGraphCaptureRequest } from '@zenfg/inspector';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';

export function mountInspector(
	host: HTMLElement,
	capture: (request: FrameGraphCaptureRequest) => FrameGraphSnapshot | Promise<FrameGraphSnapshot>,
): () => void {
	const inspector = mountFrameGraphInspector(host, {
		captureSnapshot: capture,
		branding: 'ZenFG Inspector',
	});

	return () => inspector.destroy();
}
```

宿主元素必须具有非零宽度和高度。`FrameGraphInspector` 会填满宿主，因此同一工作台既可嵌入工具面板，也可作为全页应用挂载。

`mountFrameGraphInspector(host, options)` 和 `new FrameGraphInspector(options)` 都接受 `FrameGraphInspectorOptions`。Graph 默认隐藏资源声明节点，以突出通道依赖和显式输出。设置 `showResourceDeclarations: true` 可让声明节点初始可见：

```ts
import { FrameGraphInspector } from '@zenfg/inspector';

const inspector = new FrameGraphInspector({
	showResourceDeclarations: true,
});
```

此选项设置 Graph 的初始可见性。用户可通过工具栏的 **Declarations** 开关修改；选择会在当前实例的多次捕获和导入之间保留。通过 Graph 搜索或 **Show in Graph** 定位资源时，会自动显示声明。Resources 表格、详情、内存视图和 Snapshot 导出始终保留完整资源数据。
<!-- skill:quick-start:end -->

<a id="themes-and-style-customization"></a>

## 主题与样式自定义

Inspector 默认使用 Tokyo Night Storm 主题，并提供完整的 Light 预设。可在自有宿主上使用公开的 `--zfgi-*` 变量，也可传入主题对象并调用 `setTheme()` 更新单个实例，同时保留图交互状态。动态修改外部 CSS 后，调用 `refreshTheme()` 以同步 Canvas 图。挂载时会自动读取静态 CSS。

JS 预设、可选 CSS 预设样式表、变量参考、兼容别名和多实例行为，详见[主题说明](THEMING.zh-CN.md)。

<!-- skill:tasks:start -->
<a id="common-tasks"></a>

## 常见任务

| 任务 | 公共 API |
| --- | --- |
| 挂载到现有元素 | `mountFrameGraphInspector()` |
| 创建实例但不追加到页面 | `new FrameGraphInspector()` 及其 `dom` 属性 |
| 从宿主请求实时数据 | `captureSnapshot` 选项 |
| 替换当前捕获 | `setSnapshot()` |
| 读取当前规范捕获 | `getSnapshot()` |
| 导入并迁移文件 | `importSnapshot()` |
| 下载规范 Snapshot JSON | `downloadSnapshot()` |
| 复制规范 Snapshot JSON | `copySnapshotJson()` |
| 初始显示资源声明节点 | `showResourceDeclarations` 选项（默认 `false`） |
| 应用预设或自定义主题 | `theme` 选项和 `setTheme()` |
| 外部 CSS 变更后同步图主题 | `refreshTheme()` |
| 设置可见的产品品牌标识 | `branding` 选项 |
| 限制导入文件大小 | `maxImportBytes` 选项 |
| 限制自动图布局 | `maxGraphElements` 选项 |
| 释放 DOM、worker 和监听器 | `destroy()` |

准确选项、默认值、返回类型和生命周期行为见随包源代码及声明中保留的 TSDoc。
<!-- skill:tasks:end -->

<!-- skill:mistakes:start -->
<a id="common-mistakes"></a>

## 常见错误

| 现象 | 处理方式 |
| --- | --- |
| Inspector 已挂载但不可见 | 为宿主元素设置非零宽度和高度。 |
| 实时捕获始终不可用 | 提供 `captureSnapshot`，或使用规范数据调用 `setSnapshot()`。 |
| 大型捕获没有图布局 | 谨慎提高 `maxGraphElements`，或使用表格/Raw 视图。 |
| 导入失败后似乎没有变化 | 查看显示的校验反馈；此前有效的捕获会按设计保留。 |
| 宿主代码中的旧捕获结果覆盖新结果 | 由 Inspector 管理捕获顺序，不要单独应用异步结果。 |
| 卸载后 DOM 或 worker 资源仍存在 | 释放宿主工具时调用 `destroy()`。 |
<!-- skill:mistakes:end -->

<a id="further-reading"></a>

## 延伸阅读

- [在线 Inspector](https://uinosoft.github.io/zenfg/inspector/)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.2.0/packages/snapshot/README.md)
- [ZenFG 文档索引](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.2.0/docs/README.md)

<a id="cpu-and-gpu-capture"></a>

## CPU 与 GPU 捕获

Capture 操作始终同时请求 CPU 和 GPU 计时。数据提供方会收到 `FrameGraphCaptureRequest`，并须将其中的计时模式转发给运行时。仅捕获帧会收集计时；导入数据和普通帧不受影响。CPU 列、排序、分组汇总和覆盖率包含所有保留节点类型。CPU 执行总耗时与 GPU 时间跨度分别显示。缺失、已裁剪和实际读数为零是不同情况；零读数不表示 CPU 成本为零。


<a id="analyze-and-verify-a-frame"></a>

## 分析并验证一帧

1. 捕获一帧实际数据，并检查图、资源生命周期和诊断信息。
2. 查看可用的 CPU/GPU 计时及其覆盖范围。确定要修改什么之前，先定位相关通道和依赖。
3. 使用工作台下载或复制 Snapshot JSON，并连同相关图声明和渲染器代码一起交给人工或 AI 辅助分析。说明观察到的问题和约束，并使用通道名称与资源 ID 让反馈更精确。Snapshot 描述的是已声明工作，不包含着色器行为或整个引擎的内部情况。
4. 修改代码后再次捕获。在工作负载和设备条件相近时，比较产生的结构及可用测量结果。

这是一套分析流程，不是内置 AI 集成或自动优化功能。GPU 计时取决于设备支持和节点覆盖情况；没有计时不等于零。外部引擎内部仍不可见。Snapshot 不包含 GPU 资源内容或可回放命令。Inspector 本身不会上传导入的 Snapshot；将导出数据分享给其他工具是用户单独执行的操作。

<a id="workbench-behavior"></a>

## 工作台行为

工作台提供 Overview、Graph、Passes、Resources、Memory 和 Diagnostics 视图，以及所选对象的 Inspector。它支持实时捕获、直接替换 Snapshot、导入文件、支持的旧格式迁移、下载规范文件、复制到剪贴板、筛选、排序、展开分组和图导航。

首次捕获后会打开 Graph，且不选择对象并关闭详情面板。后续捕获若仍包含相同对象，会保留当前视图、筛选条件和选择状态。Pass 选择会根据节点 ID 在保留/裁剪状态之间跟随；若所选对象被移除，则清除选择并关闭详情。这些偏好、分组展开状态和详情宽度仅属于当前 Inspector 实例，不会跨会话保存。

| 视图 | 用途 |
| --- | --- |
| Overview | 显示全帧 GPU 时间跨度、CPU 执行耗时、物理分配估算、保留通道指标、GPU 或 CPU 耗时最长的五个通道、资源/资源池摘要和诊断数量。通道类型数量和非零已裁剪通道的快捷入口位于 Retained passes 指标中。可展开查看捕获元数据、分组数量和执行分段信息。 |
| Graph | 展示 Frame Flow 结构，可按通道、资源、分组或输出搜索，并提供显式定位和可折叠图例。 |
| Passes | 查看全部、保留或已裁剪通道，可按类型及名称/ID/分组筛选，并按执行顺序、名称、类型或所选来源的耗时排序。Pass List 每次比较 CPU 或 GPU 中的一种计时来源，与 Overview 使用相同的通道名称、类型标签、坐标轴、条形、毫秒数和占比展示。便于识别的名称后缀保持可见。已裁剪通道行以裁剪原因代替计时。独立的 Group Hierarchy 支持展开、路径搜索和 View passes 操作。 |
| Resources | 可按名称/ID/分组、类型以及 Transient/Imported/Surface 筛选，并按名称、估算大小和首次使用排序。行内显示简要描述符；完整描述符和分配信息位于详情中。 |
| Memory | 显示物理分配和别名节省估算、精简且独立的资源池摘要，以及包含首末 Pass Order 的生命周期。Single 分配与其资源共用一行；Shared 分配可折叠，成员按首次使用顺序排列。支持搜索、按分配/大小排序以及 All/Shared/Single/Unreferenced/Unallocated 筛选。 |
| Diagnostics | 显示捕获到的所有错误、警告和信息消息，包括重复代码。可按严重级别按钮计数，并按代码/消息搜索；Compilation 详情另行展示可展开的保留根、裁剪原因和执行分段。 |

列表显示匹配数量和总数，支持连续滚动，并提供 **Clear filters**。默认情况下，Passes 先按执行顺序排列保留工作，再按录制顺序排列已裁剪工作；没有录制顺序时则按捕获顺序排列。保留表示编译器保留了某通道，并不证明 GPU 实际执行了它。已裁剪工作没有执行顺序、分段或 GPU 计时。Group Hierarchy 的箭头只改变树形结构；**Show in Graph** 是独立操作。

Overview 和 Pass List 将通道名称单独放在第一行，类型与一份 Read/Write 汇总放在第二行。数量统计 Snapshot 中声明的访问条目。Read/Write 标签使用与 Graph 中对应关系相同的颜色，数量使用普通文字颜色。

Pass List 使用独立的 Order 列显示从零开始的保留通道执行顺序；已裁剪通道行显示 —。Overview 没有 Order 列。Pass List 的通道行不显示分组路径，但仍保留分组路径搜索、Group Hierarchy 和完整的分组筛选范围路径。

Group Hierarchy 中的 **View passes** 会打开 Pass List，查看该组及其全部后代组中的通道，同时清除原有的搜索、类型和编译状态筛选，并保留排序方式。筛选范围显示完整分组路径及 **includes subgroups**；通过分组 ID 区分同名分组。此范围可以清除，捕获刷新后若该分组 ID 仍存在则继续保留。**Clear filters**、导航至全部或已裁剪通道，以及显式定位通道都会清除此范围。普通分组选择只打开详情，不改变通道筛选。分组摘要包含后代组，因此不能将父组与子组的汇总值相加。

Diagnostics 会在每种严重级别内部保留捕获顺序；当消息同时引用节点和资源时，会分别提供链接。已裁剪节点的链接与保留节点相同。Diagnostics 标签页显示错误/警告数量。Overview 的 **Capture information** 中可查看来源、帧和捕获时间；未提供时间戳时显示为未知。**Legend** 按钮固定在左下角，可滚动面板在其上方展开，不改变画布尺寸和视口。再次点击按钮、使用面板关闭按钮、按 Escape 或点击面板外部即可关闭。
图控件也悬浮在画布上。**Search** 打开搜索框，**Escape** 关闭。结果显示对象类型、ID 和可用的分组路径；精确名称和 ID 优先。使用方向键浏览结果，按 Enter 定位当前结果。**Display** 菜单含 Declarations、Groups 和 Collapse All。缩放控件显示当前比例，提供放大/缩小、**100%**、**Fit selection** 和适配整张图的 **Fit**。这些控件会保留选择状态且不会展开分组。选中分组后，可使用明确的 Expand/Collapse 控件或双击手势。

选择面板包含 **Summary**、**Relations** 和 **Raw** 标签。Summary 说明编译状态、计时覆盖、访问、分配关系和关联诊断。Relations 区分访问事实、依赖、输出来源和分配归属。Raw 显示规范 Snapshot 中所选原始对象及其 JSON 路径，支持按字段/值搜索、折叠，以及无论当前搜索条件如何都复制完整对象。Legacy 导入会明确标记已迁移的规范数据。复制 ID 时不会附带展示标签。

在对象视图中选择对象会打开其详情。Overview 保留选择，同时使用全部宽度。详情面板默认宽 300px，可调整至 480px，并为主视图至少保留 520px。工作区窄于 828px 时使用最大宽度 340px 的模态抽屉，外侧至少留出 24px，并提供背景遮罩、键盘焦点约束和关闭后的焦点恢复。表格和信息布局取决于主内容宽度；空间不足时，辅助表格列会移入详情。方向键和 Home/End 切换标签。Escape 会先关闭最内层活动菜单或详情面板；Examples 宿主会遵循已处理的按键事件。

<a id="timing-and-memory-interpretation"></a>

### 计时与内存信息解读

计时标签会区分未采集、部分覆盖、完全覆盖、不适用和测得为零。**Measured pass sum** 是可用通道计时的总和，并显示已计时/符合条件的数量；**GPU span** 单独显示。不会推测不透明外部工作的耗时。单个计时应在 Passes 中比较；Diagnostics 不会重复展示。

Overview 和 Pass List 在同一个 Inspector 实例中共享一项 CPU/GPU 计时来源选择。仅当 CPU 有已测通道而 GPU 没有时，初始来源才选择 CPU；其他情况均选择 GPU，包括两种来源都没有测量值时。用户显式选择后，捕获刷新会保留该来源，即使其测量值已不可用。切换来源会保留通道筛选条件和分组范围。耗时排序按所选来源排列，切换来源时会重新排序；按执行顺序、名称或类型排序时则保持原有顺序。通道详情仍保留 CPU 和 GPU 两种读数。

两个视图均显示所选来源的毫秒数，以及占整份捕获中该来源全部已测通道总和的比例。每种来源使用独立的全捕获毫秒坐标轴；搜索、类型/状态筛选、分组范围及排序不会改变该来源的占比分母或条形比例尺。通道筛选生效时，Matched 显示所选来源的已测总和及其占该来源捕获总和的比例。这些通道总和与 CPU 执行耗时及 GPU 时间跨度分别统计。计时缺失或不透明时，只显示文字状态，不绘制条形。缺失测量值不等于零，通道总和为零时不计算百分比。

Overview 按耗时排列已测量的通道，并显示其占全部已测量通道总和的比例，包括前五名以外的通道；其余已测量通道另行汇总。GPU 覆盖率统计保留的渲染/计算通道；CPU 覆盖率统计所有保留通道。总和为零时不计算百分比。点击通道可在 Passes 中定位；点击 **View all passes** 会清除 Pass 筛选并打开列表，同时保留排序方式和共享计时来源。已展开的 Overview 内容随 Inspector 实例保留。

Resources 首行展示名称，随后展示类型、来源和精简描述符。长名称保留用于识别的尾部，悬停可查看完整名称和 ID；组路径仍可搜索，也可在详情中查看。大小条以整个捕获中最大的已知估算为尺度，比较 Snapshot 提供的逻辑资源估算。搜索、筛选和排序不会改变尺度。未知估算不显示大小条；`0 B` 表示已知零值。声明的缓冲区容量在提供额外信息时单独展示，不会用于填补缺失估算。逻辑估算与共享物理分配及实际 GPU 内存用量不同。**Data scope** 说明各字段口径和已知估算覆盖情况。

资源的 **Read** 和 **Write** 统计每条声明访问记录，包括重复范围和已裁剪通道中的访问，不代表执行次数或不同通道数。点击计数可打开按该模式筛选的 Relations。生命周期首尾使用保留通道的执行 **Order**，包含两端，与 Passes 一致；点击边界可定位到对应通道。它不是经过时间，生命周期不可用也不代表资源未使用。

内存数值是估算值，各指标的统计范围不同：

| 指标 | 含义 |
| --- | --- |
| 瞬态估算 | 声明的逻辑瞬态资源估算大小。 |
| 逻辑容量 | 按每个已分配的逻辑瞬态资源计数的分配容量。 |
| 物理分配估算 | 分配报告中各物理分配的估算大小，每项只计一次。 |
| 别名节省估算 | 对包含多个瞬态成员的分配，分别计算 `(transient member count − 1) × allocation capacity` 后求和。Overview 使用同一估算值。 |
| 空闲资源池估算 | 采样时生产者报告的资源池空闲分配；它们可能比当前图存续更久。 |

无引用分配仍计入物理总量，但不会抵消别名节省。Single 或无引用分配的大小缺失不会使已知节省失效；共享分配大小缺失时，节省显示为未知，并展示覆盖情况。Imported 和 Surface 成员不参与节省计算。**Data scope** 将有引用和无引用的物理估算与逻辑容量分开说明。Shared 成员关系不代表分配器决策的原因。

报告不可用不等于数值为零。未知的资源/分配大小仍然未知，部分汇总会显示已知大小的覆盖情况。有效的空报告可以具有真实的零总量。这些指标都不是 GPU 总内存或实测峰值。内存汇总始终覆盖整个 Snapshot；筛选只改变可见行和匹配数量。生命周期包含首次和末次执行槽。刻度、网格线和资源条共用稳定的 Snapshot 坐标范围；生命周期缺失时不显示资源条。范围也包含显式关联到报告中分配的 Imported/Surface 成员；这些行会标明来源。

Memory 行将物理分配容量与各资源的逻辑估算分开标注。点击资源名称或生命周期条可检查该资源，点击分配名称可检查分配；定位图标跳转至 Resources。点击包含两端的 Order 边界可定位到对应保留通道。长资源名和分配名保留用于识别的尾部，悬停可查看完整名称。刷新和折叠后，焦点恢复到对应控件；目标消失时回退至合适入口。滚动时筛选栏和时间轴刻度保持在一起。

组层级在内容宽度低于 1000px 时合并次要列，低于 600px 时使用紧凑行。通道计时行在低于 600px 时重排；Resources 和 Memory 在低于 800px 时重排，让名称占满整行，并将大小和生命周期放在下方。这些断点依据主内容实际可用宽度判断，包括选择详情侧栏打开后的情况。GPU/CPU 计时和资源估算仍保持可见。所有宽度下的内存生命周期都使用完整执行槽范围。分配折叠状态和估算信息会跨捕获保留；搜索会临时展开匹配分配，显式定位会展开目标，但不会改变普通选择行为。

Diagnostics 的严重级别数量始终统计整个 Snapshot；匹配数同时反映搜索条件和严重级别。筛选消息不会筛选 Compilation 详情。Summary 优先显示对象自身测量值，再显示辅助事实，并记住每个对象的展开状态。Relations 将对象选择与定位图标分开。Raw 会高亮匹配字段和值，并始终复制完整规范对象，包括当前隐藏的字段。

Overview 将资源池复用标为累计值：复用/获取计数器覆盖资源池整个生命周期，而不只是当前捕获帧。空闲资源池字节数与当前帧的物理分配估算分开显示。逻辑瞬态估算可能包含仅被已裁剪通道引用的资源，可在 **Additional snapshot details** 中查看。

<a id="frame-flow-interaction"></a>

### Frame Flow 交互

<!-- skill:group-view:start -->
<a id="reading-groups"></a>

#### 阅读分组

打开 **Declarations**，可查看位于声明分组内的资源入口；使用 **Groups** 和展开控件浏览捕获到的层级。跨组使用不会移动入口；捕获的边界关系会计入组的 Inputs/Outputs。**Imported** 表示调用方拥有的原生存储，不表示从其他诊断分组借用。相同标签仍对应不同分组。

分组描述诊断归属，不决定保留、分配隔离或 GPU 内存独占所有权。共享/别名分配可能同时计入多个分组摘要。完整的显示和选择行为见 [Frame Flow 指南](#frame-flow-interaction)。
<!-- skill:group-view:end -->

Graph 是单一的 **Frame Flow** 视图：资源声明 → 保留通道的依赖 → 显式资源输出。资源入口归属于其声明分组；输出根保持在顶层，并使用编译器提供的最终生产者和初始内容贡献信息。已裁剪通道仍可在列表和详情中查看，但不显示在图中。折叠分组会汇总关系，但不会丢弃底层语义。
Graph 初始隐藏资源声明入口，以便聚焦通道依赖和输出。打开工具栏的 **Declarations** 开关即可显示入口。隐藏时，声明入口、相关关系（包括初始内容到输出的边）以及仅包含资源的分组都会从布局中移除；通道依赖和生产者到输出的边仍保留。宿主可设置 `showResourceDeclarations: true`，并通过 `FrameGraphInspectorOptions` 构造或挂载 Inspector，让声明默认可见；此选项只设置初始可见性。
已知有初始内容贡献的输出显示 **With initial contents** 或 **Initial contents only**；不会推断不可用的 Legacy 来源。
该开关会在当前 Inspector 实例的不同视图、捕获和导入之间保持状态。
切换后会适配更新后的图，同时保留选择和分组展开状态。Resources 表格、详情、内存视图和 Snapshot 导出仍包含完整数据。

所有节点均使用单线边框。普通通道为圆角矩形，外部提交为切角矩形，资源入口为椭圆，输出根为向右的标签形状。声明和输出各自使用独立于 Buffer/Texture 的角色颜色；不同通道类别使用不同颜色。Resources 和 Memory 视图仍按资源类型着色。悬停和选择只强调边框，不改变形状、文字颜色或填充。

通道节点先显示名称，随后显示类型、从零开始的执行槽（``#n``），以及可用时的分段索引（``Sn``）。横向布局表达依赖关系，不代表实测执行时间或时间线。
入口先显示来源/类型，再显示资源名称；输出先显示用途，再显示名称。长名称会换行，悬停和详情中可查看完整名称。只有同一资源和用途具有不同范围时才显示范围。精确范围和最终来源仍可在悬停/详情中查看。语义缩放会隐藏辅助类型和范围摘要。分组图例描述整个 Snapshot 的 Frame Flow（包括已折叠对象），遵循 Declarations 开关，并在分组展开/折叠时保持稳定。仅含已裁剪节点的类别和未使用资源不会新增图例项。

类别填充使用叠加在画布上的不透明 sRGB 色调：Storm 为 18%，Light 为 8%。各主题节点文字目标对比度至少为 7:1，辅助文字为 4.5:1，识别性边框/符号相对于邻近背景为 3:1。自动检查覆盖两个官方主题及交互状态；自定义 CSS 颜色也必须保持这些对比度关系。

实线表示声明、值和输出来源；虚线表示仅有顺序关系。边上不显示标签。悬停时会显示临时提示：资源入口和边只会关联到具有相同逻辑资源 ID 的可见入口和边，与范围无关。通道、分组和输出节点只高亮自身。这些关联不表示范围相同或存在连续数据流路径，也不会用折叠分组替代隐藏的资源入口。
直接悬停和关联悬停使用相同的强调样式。选择状态使用蓝色描边，不添加辉光。悬停 Summary 或 Relations 中的链接时，会按相同规则在图中预览目标，但不改变选择或移动视图；移开链接或更改/关闭详情面板后，预览会清除。

资源的 **Pass accesses** 按通道归组，保留通道按执行 Order 排列，随后列出明确标记的已裁剪通道。每条声明记录保留访问模式、写入内容、producesValue 和可用范围，作为说明文本显示。只有通道名称用于选择详情，独立定位图标负责跳转到 Passes。通道详情使用相同的访问事实。访问本身不是图关系，不会映射到任意依赖边。Resource Relations 还可按原因和范围链接到各个输出根。

点击入口、边或 Resources 行会选择同一逻辑资源，包括其所有可见入口和边，但不会选择通道、分组或输出。输出仍会选择对应的 Root。其 **View resource** 操作和其他资源链接也使用相同的资源选择方式。切换到其他资源会打开 Summary；再次选择当前资源则保留活动的详情标签。选择不会切换工作台视图、改变筛选、展开分组或移动视口。手动展开后，隐藏入口会显示为选中；入口隐藏时，其可见跨组边仍保持选中。悬停预览独立于选择状态，选择样式优先，且不会固定工具提示。边提示显示可见端点、资源、不同关系类型和底层关系数量（包括聚合边中的混合类型）。点击边仍会选择其逻辑资源。
**Focus relations** 会明确强调所选通道直接记录的关系及其可见端点，或可见分组的子树和直接边界邻居。无关内容会淡化；悬停和选择仍清晰可见。聚焦不会根据共享资源 ID 推断连续路径，也不会展开分组、改变选择、移动视口或筛选 Snapshot。关闭后恢复完整图。选择其他对象会更新聚焦；不支持的选择类型或图不可用时，此功能会禁用。
双击分组可展开或折叠，而不会替换当前选择；单击分组选择会短暂等待，以便区分这两种手势。解析结果不可用的 Legacy 输出仍会显示，但不会推断来源边。

显式 **Show in …** 操作会执行导航：切换视图、清除阻挡目标的筛选、展开必要的祖先分组，并滚动到或居中显示目标。窄屏宿主的抽屉会关闭，以显示目标。图搜索使用相同的显式定位方式。通过图搜索或 **Show in Graph** 定位资源时，也会打开 Declarations；普通选择和悬停不会改变开关。定位失败时会恢复此前的声明和分组设置。Frame Flow 中不存在的对象会显示说明及列表视图操作；定位对象不会绕过图元素数量上限。普通选择和悬停仍遵循前述行为。

捕获、导入和直接替换共用修订计数器，避免过期的异步结果覆盖更新的数据。导入失败或文件过大时，会保留当前有效捕获和 UI 状态；操作反馈可展开查看完整失败原因。视图在首次激活时渲染新捕获；选择变化只刷新活动视图和详情。内存分组与生命周期坐标按 Snapshot 缓存；只有打开 Raw 时才创建该视图。图布局按需生成；捕获超过 `maxGraphElements` 时会禁用图并显示说明，表格和 Raw 仍可用。

Snapshot 标签、URL、扩展和诊断内容都通过 DOM 文本 API 设置，不会作为标记或代码执行。`apps/site/inspector` 中的独立 Site 页面直接挂载同一个包，不会重复添加控件。

<!-- skill:reading:start -->
<a id="usage-references"></a>

## 使用参考

- [工作台与 Frame Flow](#frame-flow-interaction)
- [主题](THEMING.zh-CN.md)
- [升级说明](docs/MIGRATION.zh-CN.md)
<!-- skill:reading:end -->
