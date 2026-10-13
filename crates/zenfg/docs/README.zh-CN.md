<!-- translation: {"version":1,"source":"crates/zenfg/docs/README.md","sourceHash":"352f24f45c1cb89290a6727c096b8c83207c1bd2d09f867e79c674f562f003fc","state":"ready"} -->

<a id="zenfg-usage"></a>

# zenfg 使用指南

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->



`zenfg` 是适用于 wgpu、与渲染器无关的 FrameGraph 编译器和瞬态资源执行器。它会记录逻辑资源及其访问、校验内容流、构建依赖、裁剪无用工作、推导使用方式、规划瞬态资源别名，并可选择在调用方拥有的设备和队列上实例化保留的工作。

使用 wgpu 构建领域专用的渲染与计算功能，同时保持资源和执行边界清晰。详情见
[组合模型][zenfg-composition].

ZenFG 不拥有场景、管线、绑定组、采样器、表面、呈现或设备丢失策略。1.0 发布前公开 API 仍可能变化；集成时请固定精确的包版本并查看迁移说明。

<a id="features"></a>

## 功能特性

| 功能标志 | 默认启用 | 提供的能力 |
| --- | --- | --- |
| `default` | 是 | 空功能集；核心编译器和设备驱动的执行器始终可用 |
| `serde` | 否 | 为当前版本运行时编译报告提供 Serde 支持；可移植交换应使用 Snapshot |
| `snapshot` | 否 | `zenfg-snapshot`、线协议类型重新导出，以及可移植报告导出 |

`FrameGraph::new()` 仅执行 CPU 工作。`FrameGraph::with_device()` 会保存克隆的
`wgpu::Device`, 并拥有瞬态资源池，从而启用执行。队列和所有
导入资源仍由调用方拥有。

<a id="quick-start"></a>

## 快速入门

请使用 Cargo 应用及随 crate 提供的 Cargo.toml 中声明的 Rust 工具链。将代码放入 `fn main() -> Result<(), zenfg::FrameGraphError>`，并以 `Ok(())` 结束。运行 `cargo run`；无需 GPU，断言也会通过。此 Markdown 中以 `#` 开头的行是 rustdoc 测试框架代码，不要复制到应用中。

这个完整的纯 CPU 示例会录制一个瞬态输出、将其保留，并编译诊断计划：

```rust
use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, RootReason,
    UsagePolicy, WriteContents,
};

let mut graph = FrameGraph::new();
let mut frame = graph.begin_frame();
let output = frame.create_buffer(BufferDesc {
    label: "output".into(),
    size: 1024,
    usage: UsagePolicy::Infer,
})?;

let mut pass = frame.compute_pass("produce");
let _output = pass.storage_buffer_write(
    output,
    BufferRange::whole(),
    WriteContents::Overwrite,
)?;
pass.finish()?;

frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;
let compiled = frame.compile(CompileOptions::full_report())?;
assert_eq!(compiled.report().unwrap().summary.retained_node_count, 1);
# Ok::<(), zenfg::FrameGraphError>(())
```

<a id="lifecycle"></a>

## 生命周期

```text
FrameGraph -> Frame<'frame> -> CompiledFrame<'frame> -> execute(queue)
runtime       recording         retained CPU plan        optional, one-shot
```

- `begin_frame()` 会独占借用运行时并创建一次录制。
- `Frame::compile()` 会消耗该次录制。句柄和访问令牌携带运行时与录制的身份信息，由 API 和校验逻辑强制检查。
- `CompiledFrame::execute()` 只能执行一次。只供已裁剪工作使用的原生绑定和回调会在编译后释放。
- 表面获取和呈现仍由调用方负责；每个呈现帧都应导入并绑定一张新的当前表面纹理。
- 丢弃 `FrameGraph` 会释放保留的资源池和 profiler 资源，但不会释放调用方拥有的导入资源。

<a id="diagnostic-grouping"></a>

## 诊断分组

调试组会在报告和 Inspector 中标注声明和通道。录制通道的路径还可以生成可选的原生 GPU 标记。分组不会建立依赖、保留工作、拥有原生存储或隔离分配。资源池作用域用于另一项独立功能。

- 使用简洁且有意义的名称对相关功能和阶段分组。例如，Atmosphere 可包含 sky、clouds、haze 和 lens flare，但不应把 Water 也归入其中。
- 在不改变正确录制顺序的前提下，将功能内的图可见声明和通道放在一起。每次录制时在组合边界导入一次共享存储，并跨组复用其句柄。
- 保持录制和提交顺序。交错的功能可以使用 `atmosphere.environment`、`atmosphere.sky`、`atmosphere.air-haze` 和 `atmosphere.lens-flare` 等语义阶段标签；这些只是示例，并非必需名称。
- Bloom 的重复通道适合使用外层 `bloom` 组，并可选用 `downsample`/`upsample` 阶段。通道应标注实际 mip/迭代编号，不要为每个 mip 单独嵌套一个组。对有意义的迭代可以编号。
- 使用同步的 `with_debug_group()`，或成对调用 push/pop；编译前关闭所有组。每次 push/with 都会创建新组。返回的 `DebugGroupId` 不能再次传入来重开组；重复标签仍对应不同组，点分隔标签也不表示层级。
- 资源归属在注册时捕获；通道则在创建 `PassBuilder` 时捕获所属组。跨组使用不会移动声明，也不会改变存储所有权或录制内句柄的有效范围。

<a id="bloom-grouping-adapter"></a>

### Bloom 分组适配器

调用方提供的闭包会按有效顺序录制实际通道，并使用 `bloom.downsample.mip-2` 和 `bloom.upsample.mip-1` 等具体标签。此适配器只提供诊断层级。只有现有计划中的 downsample 和 upsample 阶段连续时才使用；否则，应在原调用位置按语义阶段分组。共享输入句柄可以留在这些组之外；局部中间资源应在适当的录制位置声明。

~~~rust
use zenfg::{Frame, FrameGraphError};

pub fn record_bloom_groups<'frame>(
    frame: &mut Frame<'frame>,
    downsample: impl FnOnce(&mut Frame<'frame>) -> Result<(), FrameGraphError>,
    upsample: impl FnOnce(&mut Frame<'frame>) -> Result<(), FrameGraphError>,
) -> Result<(), FrameGraphError> {
    frame.with_debug_group("bloom", |frame| {
        frame.with_debug_group("downsample", downsample)?;
        frame.with_debug_group("upsample", upsample)
    })
}
~~~

线协议可以描述非连续的组引用；执行时也可以在后续由图拥有的命令片段上重新打开原生标记。但两者都不支持录制时重新进入某个组。原生标记需通过 `ExecutionOptions::with_gpu_debug_groups(true)` 显式启用。

<a id="validation-boundary"></a>

## 校验边界

ZenFG 会校验图语义，包括逻辑资源范围、内容流、使用约定、格式类别和有界规划输入。非空的缓冲区与纹理复制还需要已知的格式占用信息，以便跟踪复制所用的缓冲区字节范围。设备功能、设备限制、原生描述符有效性、渲染通道兼容性、纹理视图兼容性，以及原生复制命令的对齐和格式有效性仍由 wgpu 负责。因此，原生 wgpu 校验错误可能在分配或命令编码期间报告，而不是在录制图时报告。图不会接管调用方的错误处理或设备丢失策略。

ZenFG 会校验与设备无关的纹理形状规则，以及保留瞬态分配的结构化使用要求。多重采样支持仍取决于 wgpu 的格式和后端，不会强制采用浏览器 WebGPU 的采样数集合。`TRANSIENT_ATTACHMENT` 目前会被拒绝，因为 Snapshot 1.2 无法编码此用法；它与 ZenFG 瞬态资源的生命周期策略不是同一概念。

零尺寸复制在所属节点被保留时仍会作为原生空操作命令保留，但不会影响图内容，也不会生成输出值。

<a id="common-tasks"></a>

## 常见任务

| 任务 | 公共 API |
| --- | --- |
| 创建纯 CPU 编译器 | `FrameGraph::new()` |
| 创建由设备驱动的运行时 | `FrameGraph::with_device()` |
| 标注诊断分组 | `push_debug_group()`, `pop_debug_group()`, `with_debug_group()` |
| 开始录制 | `begin_frame()` |
| 创建瞬态存储 | `create_texture()`, `create_buffer()` |
| 注册导入存储 | `import_texture()`, `import_surface_texture()`, `import_buffer()` |
| 绑定导入的原生对象 | `bind_imported_texture()`, `bind_imported_buffer()` |
| 选择纹理子资源 | `create_texture_view()` |
| 录制渲染或计算工作 | `render_pass()` / `finish_render()`, `compute_pass()` / `finish_compute()` |
| 录制复制或清除操作 | `copy_pass()` 及类型化复制方法, `clear_buffer()`, `clear_buffers()` |
| 编码由图拥有的自定义命令 | `command_pass()` / `finish_command()` |
| 调用自行提交的渲染器 | `external_submission()` / `finish_external()` |
| 保留可观察值 | `mark_present()`, `mark_buffer_root()`, `mark_texture_root()`, `mark_readback()` |
| 编译精简版或完整诊断 | `compile(CompileOptions::default())`, `compile(CompileOptions::full_report())` |
| 执行保留的工作 | `execute()`, `execute_with_options()` |
| 请求 CPU/GPU 计时 | `execute_with_timing()` |
| 检查或管理保留的分配 | `resource_pool_stats()`, `create_resource_pool_scope()`, `clear_resource_pool_scope()`, `clear_resource_pool()`, `evict_resource_pool()` |
| 导出 Snapshot 1.2 | `snapshot::create_frame_graph_snapshot()`，须启用功能标志 `snapshot` |

准确签名、字段、默认值和结构化 `FGxxxx` 错误见 [docs.rs](https://docs.rs/zenfg).

<a id="key-pattern-bind-and-resolve-typed-access"></a>

## 关键模式：绑定并解析类型化访问

先以逻辑方式声明导入存储，再将它绑定到调用方拥有的原生对象。瞬态和导入存储都通过相同的类型化通道令牌解析：

```rust,no_run
use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, ImportBufferOptions,
    InitialContents,
};

# fn record(device: &wgpu::Device, queue: &wgpu::Queue, native: &wgpu::Buffer)
# -> Result<(), zenfg::FrameGraphError> {
let mut graph = FrameGraph::with_device(device);
let mut frame = graph.begin_frame();
let buffer = frame.import_buffer(
    BufferDesc::new("input", native.size()),
    ImportBufferOptions::new(InitialContents::Defined),
)?;
frame.bind_imported_buffer(buffer, native)?;

let mut pass = frame.compute_pass("consume");
let input = pass.storage_buffer_read(buffer, BufferRange::whole())?;
pass.finish_compute(move |ctx| {
    let _native = ctx.resources.buffer(input)?;
    // Set a compute pipeline and dispatch through ctx.pass.
    Ok(())
})?;

frame.compile(CompileOptions::default())?.execute(queue)?;
# Ok(())
# }
```

解析出的瞬态对象只在其执行回调期间有效。导入对象仍由调用方拥有，但每项图可见访问仍须有对应声明。
来自其他图或录制的令牌会先返回 `ForeignHandle`，随后才检查本地通道/访问 ID。同一录制中来自其他通道的令牌仍会返回 `WrongPassToken`。

<a id="resource-and-integration-choices"></a>

## 资源与集成方式

分配所有权和图可见性是两个独立选择：导入存储后，图可以跟踪调用方拥有的原生对象，但不会转移其所有权。

| 需求 | 常见选择 |
| --- | --- |
| 帧内分配与资源池管理 | 声明瞬态 Bloom 中间资源、G-buffer 附件或由图管理的计算临时工作区。 |
| 跨节点数据流、持久状态、输出或回读 | 注册资源并声明所需范围/访问。导入并绑定调用方拥有的历史数据、场景存储或 staging 缓冲区，并添加适当的根。 |
| 无需图依赖跟踪或管理的私有存储 | 缓存的只读顶点/索引缓冲区、材质纹理、权重或工作负载内部临时区可继续由模块拥有并在内部绑定。调用方负责初始化、生命周期和内部执行安全。 |
| CPU 状态或原生绑定状态 | 场景/相机对象、管线、绑定组和采样器仍由应用拥有；它们不是图纹理或缓冲区。 |

长生命周期存储并不自动意味着它应在图外。某个通道写入持久缓冲区、另一个通道读取时，需声明相应的可见访问，适用时包括 `vertex_buffer()`/`index_buffer()`。每次录制只注册一次共享导入资源，绑定其原生对象，再把逻辑句柄传给使用方。私有原生绑定不会被扫描以推导依赖。命令/外部通道的图可见边界应使用类型化访问声明；外部提交只会对共享队列上的工作排序，不代表 GPU 已完成。详情见 [资源声明粒度][zenfg-resource-granularity].

资源声明粒度可以灵活选择：复杂工作负载可在内部绑定私有权重、参数和临时工作区；教学或诊断场景则可以公开更多资源。图可见依赖和访问正确性要求仍然适用。详情见 [选择资源声明粒度][zenfg-resource-granularity].

将资源公开给图时：

- 仅在一次编译后执行期间需要的存储应使用瞬态资源；由调用方拥有或必须在执行结束后继续保留的存储则应导入。
- 导入资源必须明确选择 `InitialContents::Defined` 或 `InitialContents::Undefined`。瞬态范围的首次写入必须完整覆盖该范围。
- 纹理到缓冲区复制存在实际行或层间距、导致部分字节未写入时，会保留跟踪范围内缓冲区原有内容。此类复制前应先初始化未定义的目标内容；单行或单层情况下未使用的步幅不要求保留内容。清空整个缓冲区时使用逻辑描述符中的大小。
- 尽可能使用结构化渲染、计算、复制和清除节点。需要在图拥有的编码器上执行自定义工作时使用命令通道。
- 渲染器自行拥有并提交编码器时使用外部提交。该边界会排列队列提交，但不是 GPU 完成栅栏。
- ZenFG 不会分析跨帧依赖，也不会替应用获取或呈现表面。

每个保留的渲染/计算通道使用两个 GPU 计时查询。计时通道超过 2048 个时，会在创建计时资源前返回 `GpuTimingUnavailableReason::TooManyTimedNodes`。执行仍会继续，`TimingMode::Both` 也会保留 CPU 结果。

详见 [核心概念][zenfg-concepts]
，了解共同的所有权、内容、依赖、生命周期和集成模型。

<a id="common-mistakes"></a>

## 常见错误

| 现象 | 解决方法 |
| --- | --- |
| 通道未出现在编译计划中 | 使用相应的根保留其最终值；只有真实副作用才声明为副作用。 |
| 读取或保留式写入报告内容未定义 | 先完整覆盖该范围，或为导入资源选择正确的初始内容状态。 |
| 导入资源无法执行 | 绑定对应的原生对象，并确保描述符与使用元数据一致。 |
| 类型化令牌无法解析 | 只能在声明该令牌的通道中、且仅在该通道回调内解析。 |
| 瞬态对象被延后使用 | 不要跨回调或帧克隆或保留已解析的瞬态 wgpu 句柄。 |
| 外部工作顺序不正确 | 在外部回调返回前，将所有已声明的工作提交到共享队列。 |
| 计时不可用 | 将 unsupported、busy、回读失败和溢出视为非致命计时结果。 |

<a id="complete-examples"></a>

## 完整示例

以下 Cargo 示例随 crate 发布，并在工作区之外通过编译检查：

| 工作流 | 示例 |
| --- | --- |
| 最简呈现生命周期 | [`minimal_frame.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/minimal_frame.rs) |
| 将瞬态渲染目标用于呈现 | [`transient_to_present.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/transient_to_present.rs) |
| 导入调用方拥有的资源 | [`imported_resource.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/imported_resource.rs) |
| 跨帧持久状态 | [`persistent_state.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/persistent_state.rs) |
| 不透明的第三方提交 | [`external_submission.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/external_submission.rs) |
| 可移植 Snapshot 导出 | [`snapshot_export.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/snapshot_export.rs) |
| 异步 GPU 计时 | [`gpu_timing.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/gpu_timing.rs) |
| 计算存储输出 | [`compute_output.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg/examples/compute_output.rs) |
| 按作用域清理尺寸调整后的资源并驱逐空闲实例 | [resource_pool_control.rs][zenfg-pool-recipe] |

仓库还包含纯 CPU 编译和资源池基准测试。导出 Snapshot 需要启用 `snapshot` feature。

<a id="resource-pool-maintenance"></a>

## 资源池维护

在借用帧之前创建一个 `ResourcePoolScope`，并使用 `frame.create_texture_in(scope, desc)` 或 `frame.create_buffer_in(scope, desc)`。这个可复制的标识本身不拥有资源，也不借用图的生命周期。`clear_resource_pool_scope(scope)?` 会清除此分区中保留的缓存，但不会使该标识失效。即使资源池为空，来自其他运行时的作用域仍会返回 `ForeignResourcePoolScope`。`clear_resource_pool()` 仍会清空所有区域。

`evict_resource_pool` 接受不会被存储的 `FnMut` 谓词和借用的物理描述符视图。使用 `info.scope.is_none()` 可只选择默认区域，使用 `info.unused_executions > 60` 可实现应用的空闲策略。每个物理实例只访问一次，顺序未作保证。谓词 panic 会向上传播；在栈展开时，资源池保持不变。闭包产生的外部副作用不会回滚。API 不会公开 GPU 句柄、内部键或持久实例 ID。管理操作要求先结束对帧/编译帧的借用，也不会等待 GPU 完成。

运行 `cargo run --locked -p zenfg --example resource-pool-control` 可查看只执行空操作的尺寸调整/驱逐示例。 [核心概念][zenfg-lifetime]
，了解所有权、空闲计数和失败边界。

<a id="further-reading"></a>

## 延伸阅读

- [ZenFG 文档索引](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/docs/README.md)
- [核心概念][zenfg-concepts]
- [`zenfg-snapshot`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/crates/zenfg-snapshot/README.md)
- [兼容性](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.2.0/docs/compatibility.md)

<a id="execution-timing"></a>

## 执行计时

使用 `execute_with_timing(&queue, options, TimingMode::Cpu)`、`TimingMode::Gpu` 或 `TimingMode::Both`。结果包含可选的同步 CPU 报告和可选的 GPU 回读。使用 `try_take()` 查询 GPU 回读；纯 CPU 执行不会等待 GPU 结果。普通执行不收集计时。CPU 数值表示所有已执行节点的同步经过时间，不是线程 CPU 使用量。执行总耗时包括准备、提交和瞬态资源释放。

<a id="usage-references"></a>

## 使用参考

- [运行时概念][zenfg-concepts]
- [升级说明][zenfg-migration]
- [完整示例][zenfg-examples]

[zenfg-composition]: CONCEPTS.zh-CN.md#integration-levels
[zenfg-resource-granularity]: CONCEPTS.zh-CN.md#choosing-resource-declaration-granularity
[zenfg-concepts]: CONCEPTS.zh-CN.md
[zenfg-pool-recipe]: ../examples/resource_pool_control.rs
[zenfg-lifetime]: CONCEPTS.zh-CN.md#lifetime-and-allocation
[zenfg-migration]: MIGRATION.zh-CN.md
[zenfg-examples]: ../examples/
