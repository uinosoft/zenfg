<!-- translation: {"version":1,"source":"packages/webgpu/docs/MIGRATION.md","sourceHash":"eeb670a26da0f1466b76a254164318a7740190a2d33e4f8136a62ce013150911","state":"ready"} -->

<a id="zenfgwebgpu-upgrade-notes"></a>

# @zenfg/webgpu 升级说明

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

包 API 版本与 Snapshot 线格式版本彼此独立。以下历史变更适用于所列版本，并不代表每种当前集成都需要调整。

<a id="webgpu-errors-and-logical-handles"></a>

## WebGPU 错误与逻辑句柄

`FrameGraphError` 在 0.1.0 中已存在。0.2.0 扩大了它覆盖的范围：更多由 ZenFG 检出的录制、编译和执行失败会使用该错误类型，而此前这些情况会抛出普通 `Error` 或 `TypeError`。对于这些错误，请将按构造函数名称或内置错误类型精确匹配的判断改为检查 `FrameGraphError.code`，并使用可用的阶段与位置元数据。错误消息仍是便于阅读的文本。回调异常和原生 WebGPU 异常会原样传递。Snapshot 验证使用 `FrameGraphSnapshotValidationError`；该类型现在也由 `@zenfg/webgpu/snapshot` 导出，因此不要把所有失败都当成 `FrameGraphError`。

逻辑纹理、视图和缓冲区句柄的 TypeScript 声明现在使用私有的唯一 symbol 类型标记。运行时的旧 `__brand` 属性已移除。请使用录制对象提供的创建、导入和视图工厂，并在集成代码中传递这些句柄。不要再自行构造结构相似的对象或读取 `__brand`；公开的 `kind`、`id` 和可选 `label` 仍可用于诊断。所有权校验仍要求句柄确实来自对应的录制对象。

<a id="native-validation-and-copy-content"></a>

## 原生校验与复制内容

两个运行时都会校验图所有权、范围、内容流、用途约束、格式类别以及有界的规划输入。设备能力、原生资源/纹理视图描述符、渲染通道兼容性，以及原生复制的对齐、格式、切面和重叠规则仍由浏览器 WebGPU 或 wgpu 负责。部分此前在录制阶段被拒绝的输入，现在会继续进入原生分配或编码阶段。请保留宿主自身的原生错误处理和设备丢失策略。浏览器错误可能通过 error scope 或 `uncapturederror` 异步到达；同步图执行不会等待或转换这些错误。

原生分配前会检查与设备无关的纹理形状，以及保留的瞬态分配用途。浏览器采样数仍仅支持 1 或 4；由于 Snapshot 1.2 无法编码 `TRANSIENT_ATTACHMENT` 用途，因此会拒绝该标志。这个原生用途标志与 ZenFG 的瞬态资源生命周期策略是两回事。

零尺寸复制不会产生图级读写效果，也不能定义输出内容。即使零尺寸操作被保留，仍会编码为原生空操作，以便执行原生参数校验。非空的缓冲区与纹理之间复制必须具有已知的格式占用范围，才能跟踪依赖。带有行或层填充的纹理到缓冲区复制会保留占用范围内已有的字节；单行或单层情况下未使用的步幅值不会让连续写入变成保留式写入。执行保留式写入前，请先初始化目标所需的原有内容。

当省略 size 时，WebGPU `clearBuffer()` 现在只会清除逻辑缓冲区范围的剩余部分，即使导入的原生缓冲区更大也是如此。若只需清除该逻辑剩余范围的一部分，请明确指定 size。

<a id="timing-and-snapshot-export"></a>

## 计时与 Snapshot 导出

GPU 计时返回 `no-timed-nodes` 时，应将其视为计时不可用，而不是可用但耗时为零的测量。保留的渲染/计算节点超过 2048 个时，WebGPU 也会返回 `too-many-timed-nodes`，而不会分配超过 4096 个时间戳查询。执行仍会提交；`both` 模式仍会保留 CPU 报告。Rust 的计时节点上限在 0.1.0 中已经存在。调用方应处理计时不可用的原因，不要据此认定执行失败。

Snapshot 导出器会拒绝与保留编译序列不一致的计时节点 ID、重复项、顺序或节点种类。按顺序排列的部分覆盖仍符合 Snapshot 1.2。请传入同一次编译帧的编译报告和计时报告；不要仅因数值帧索引相同就混用不同帧。Rust 使用 `SnapshotExportError::InvalidTimingReport` 报告这些失败；TypeScript 使用 `FrameGraphSnapshotValidationError`。

WebGPU 的 Snapshot 入口现在重新导出可移植 Snapshot 类型和规范序列化器。`resourcePool` 在 `createFrameGraphSnapshot()` 中是可选项；省略时会将池可用性记录为 `not-requested`，而不改变线格式。为保留同一帧的数据，请在等待 GPU 回读前采集可选的 CPU 结果和资源池计数器。

<a id="optional-webgpu-render-pass-descriptor-extras"></a>

## 可选的 WebGPU 渲染通道描述符扩展字段

现有 `render()` 调用无需修改即可继续使用。只有宿主需要额外原生描述符字段时，才使用新增的 `webgpuDescriptor` 选项。`label`、`colorAttachments`、`depthStencilAttachment` 和 `timestampWrites` 仍由 ZenFG 管理；尝试覆盖这些字段会被 `FG2013` 拒绝。只接受对象自身可枚举的字符串数据属性，并在录制时进行浅拷贝。被引用的原生对象会保留其身份，仍归调用方所有。

标准字段仍使用其 WebGPU 类型。实验性字段的类型，以及功能检测、启用的功能、管线兼容性、原生校验和原生对象生命周期，均由应用自行负责。通过扩展字段访问的资源仍须在图中显式声明 `uses`；透传不会推导依赖。描述符扩展仅用于执行，不会写入可移植 Snapshot，并且只适用于 TypeScript WebGPU 运行时。

该能力提供通用的描述符透传，并非完整的 bindless API。新增字段尚未经过真实 GPU 验证；现有 mock/CPU 检查也不能证明实验性浏览器或驱动支持这些字段。应用负责的集成边界和类型示例见 [WebGPU README](README.zh-CN.md#native-render-pass-descriptor-extras)。

<a id="runtime-calls"></a>

## 运行时调用

TypeScript 中请将 `compiled.execute({ gpuTiming: true })` 替换为 `compiled.executeWithTiming({ timing: 'gpu' }).gpu!`。选择 `'cpu'` 或 `'both'` 可收集 CPU 耗时。返回对象是同步的，只有其中的 GPU Promise 是异步的。保留现有 frameIndex 和提交钩子。请通过 `await` 或拒绝处理器消费返回的 GPU Promise，应用关闭期间也一样。即使同步执行已经成功，异步生命周期/回读失败仍遵循现有 GPU 合约。兼容别名和 GPU 重载均已移除。普通执行不会收集计时。

<a id="snapshot-inputs"></a>

## Snapshot 输入

TypeScript 的 `createFrameGraphSnapshot` 现在要求显式提供 `frameIndex`。`cpuTiming` 和 `gpuTiming` 都是可选项。请在执行后立即保存 CPU、编译和资源池计数器，再等待 GPU 回读。所有提供的报告必须描述同一编译帧，并携带相同的调用方指定帧索引。

<a id="interpreting-cpu-values"></a>

## 解读 CPU 数值

CPU 表示同步耗时，包括本地准备/清理和外部提交回调。共享准备、提交和资源释放会计入 execute 总耗时。录制、编译、等待 GPU 以及 Snapshot/UI 工作不计入该总耗时。线程抢占和 GC 都可能影响数值；以微秒为单位并不保证测量精度。发生失败后不会返回部分报告。

<a id="runtime-integrations"></a>

## 运行时集成

现有的单参数 WebGPU 根调用仍可使用。现在缓冲区根可以选择范围，纹理根可以选择纹理视图。即使未生成诊断报告，只要所选范围中有任何内容未定义或已丢弃，编译就会以 FG1004 拒绝。例如，新建的 16 字节缓冲区若只初始化了前 8 字节，请将 `markOutput(buffer)` 改为 `markOutput(buffer, { offset: 0, size: 8 })`，或初始化全部 16 字节。根范围不能为空；普通的空缓冲区访问不受影响。

调用方应通过资源、原因和归一化范围识别资源根，不要只依赖数组索引或资源 ID。Inspector 现在采用统一的 Frame Flow 视图，其中包括输出端点及其最终内容来源。

<a id="release-history"></a>

## 发布历史

包版本和历史验收依据见[各组件发布说明](https://github.com/uinosoft/zenfg/tree/npm/webgpu/v0.2.0/docs/releases)。
