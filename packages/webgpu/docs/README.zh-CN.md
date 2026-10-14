<!-- translation: {"version":1,"source":"packages/webgpu/docs/README.md","sourceHash":"1533fb1c8493355062b25479b936c7f1c2056e43a22092694694d9798ec308ad","state":"ready"} -->

<a id="zenfgwebgpu-usage"></a>

# @zenfg/webgpu 使用指南

<!-- generated:language:start -->
[English][documentation-en] | **简体中文**

[documentation-en]: ./README.md
[documentation-zh]: ./README.zh-CN.md
<!-- generated:language:end -->



`@zenfg/webgpu` 是一个轻量级 WebGPU FrameGraph，用于声明并执行逐帧 GPU 工作。它会排列图节点、校验资源访问、裁剪未使用的工作、推导 WebGPU 使用标志、跟踪资源生命周期，并复用瞬态纹理和缓冲区。

直接使用 WebGPU 或兼容库构建渲染功能，并通过显式的图集成将其与现有渲染器组合。详情见
[组合模型](CONCEPTS.zh-CN.md#integration-levels).

ZenFG 不是渲染器抽象层。它负责图可见的依赖、执行顺序、保留、瞬态资源分配和可选诊断；场景、管线、绑定组、采样器、长生命周期资源、表面呈现、设备丢失策略，以及具体绘制或分派工作均由调用方负责。

1.0 发布前公开 API 仍可能变化。请固定精确的包版本，并在升级前查看迁移说明。
请从包根入口导入运行时 API；唯一受支持的诊断子路径是 `@zenfg/webgpu/snapshot`.

<!-- skill:description:start -->
使用 @zenfg/webgpu 集成 WebGPU 渲染或计算、声明资源访问、组织诊断分组、保留输出、管理瞬态资源池，或导出帧诊断。
<!-- skill:description:end -->

<!-- skill:quick-start:start -->
<a id="quick-start"></a>

## 快速入门

请在通过 HTTPS 或 localhost 提供服务、且已启用原生 WebGPU 的浏览器模块中运行以下示例。宿主需提供 `GPUDevice` 和配置好的 canvas `GPUCanvasContext`。在宿主动画循环中调用 `renderFrame()`，画布会清为深蓝色。可直接运行的 canvas 宿主见 [Examples 中的最简帧示例](https://uinosoft.github.io/zenfg/playground/?example=minimal-frame).

保留一个 `FrameGraph`，在对应 `GPUDevice` 的整个生命周期内复用。每个呈现帧都创建一次新的录制，并导入一张新的当前表面纹理。下面的完整示例只清除表面附件，因此不需要渲染管线：

```ts
import { FrameGraph } from '@zenfg/webgpu';

// `device` and the configured `context` are caller-owned.
const graph = new FrameGraph(device);
let frameIndex = 0;

function renderFrame(): void {
	const recorder = graph.beginFrame();
	const backbuffer = recorder.importSwapchainTexture(
		context.getCurrentTexture(),
		{ label: 'backbuffer' },
	);

	recorder.render({
		label: 'clear-backbuffer',
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 },
		}],
	});

	recorder.markPresent(backbuffer);
	recorder.compile().execute({ frameIndex: frameIndex++ });
}

// When the device-bound renderer stack is released:
// graph.destroy();
```

导入的 GPU 对象必须属于同一 `GPUDevice`，即传给 `FrameGraph` 的设备。ZenFG 会检查图依赖、逻辑范围、内容流、访问声明、使用约定、有界资源规划和格式类别。原生资源描述符、渲染通道、纹理视图、复制命令、设备限制和命令校验仍由 WebGPU 负责，包括原生复制的对齐、格式、aspect 及同一资源重叠规则。非空的缓冲区与纹理复制还需要已知的格式占用信息，以便 ZenFG 跟踪复制所用的缓冲区字节范围。零尺寸复制是原生空操作，不会定义或消耗图内容；如果该节点被保留，仍会编码它以校验原生参数。原生 WebGPU 校验错误可能通过 error scope 或 `uncapturederror` 异步报告；普通执行不会等待这些结果，也不会将它们转换为 ZenFG 错误代码。创建原生资源前，ZenFG 还会检查与设备无关的纹理形状规则，以及保留瞬态分配的结构化使用要求。格式能力和设备限制仍由原生校验负责。WebGPU 的 `TRANSIENT_ATTACHMENT` 目前会被拒绝，因为 Snapshot 1.2 无法编码此用法；它与 ZenFG 瞬态资源不是同一概念。

`markPresent()` 会使最终表面值变为可观察结果。没有资源根或副作用节点时，不产生任何结果的工作会被裁剪。普通执行会同步录制并提交；只有可选的 GPU 计时会返回异步回读结果。
<!-- skill:quick-start:end -->

<!-- skill:lifecycle:start -->
<a id="lifecycle"></a>

## 生命周期

```text
FrameGraph runtime -> FrameGraphRecorder -> CompiledFrame
device lifetime       one recording        retained executable plan
```

- `FrameGraph` 永久绑定到一个由调用方拥有的 `GPUDevice`，并负责管理瞬态资源池和按需创建的 profiler 资源。
- `beginFrame()` 会创建独立且只能使用一次的录制对象。无论 `compile()` 成功还是失败，该次录制都会被消耗。
- 句柄、视图和访问令牌只在所属录制中有效。
- 只有所有捕获的回调和导入的 GPU 对象仍然有效时，编译帧才能再次执行。通常不应重复执行用于呈现的录制。
- `destroy()` 会释放运行时拥有的资源，但绝不会销毁设备或导入资源。
<!-- skill:lifecycle:end -->

<!-- skill:grouping:start -->
<a id="diagnostic-grouping"></a>

## 诊断分组

调试组会在报告和 Inspector 中为已录制的资源及通道添加标注。录制通道的路径还可以生成可选的原生 GPU 标记。分组不会创建依赖、保留工作、拥有资源或划分分配范围。应单独使用 `ResourcePoolScope` 管理资源池复用和驱逐。

- 使用简洁且有意义的名称组织相关功能和阶段。例如，Atmosphere 可包含 sky、clouds、haze 和 lens flare；无关的 Water 工作应保留自己的归属。
- 在原有录制位置，将功能内的图可见声明及其处理通道放入适当的组。共享资源应在每次录制的组合边界导入，并跨组复用其句柄。
- 保持正确的录制和提交顺序。某项功能与其他工作交错时，应使用 `atmosphere.environment`、`atmosphere.sky`、`atmosphere.air-haze` 和 `atmosphere.lens-flare` 这样的语义阶段，不要移动无关工作。这些只是标签示例，不是强制分类体系。
- Bloom 多次执行的 downsample/upsample 通道适合用分组组织：使用外层 `bloom`，并可按需增加 `downsample`/`upsample` 阶段。通道应标注实际 mip 或迭代编号；不要为每个 mip 都建新组，也不要嵌套过深。真实迭代编号有用，随意编造的片段编号则没有。
- 优先使用同步的 `withDebugGroup()`。手动调用 push/pop 时应成对使用，并在编译前关闭所有组。每次 push/with 都会创建独立的录制内分组；重复标签不会重新打开已有 ID，点号也不会建立层级关系。
- 即使其他组也使用某项资源，它仍保留声明或导入时捕获的组。组归属不会转移原生资源所有权，也不会让瞬态对象可以安全保留。

受支持的 API 用法见 [Bloom 分组适配器](#bloom-grouping-adapter)。
<!-- skill:grouping:end -->

<a id="bloom-grouping-adapter"></a>

### Bloom 分组适配器

此适配器会录制调用方准备好的有效通道描述符，不改变其顺序、标签、附件或访问方式。只在现有计划中 downsample 和 upsample 工作连续时使用。为每个描述符指定具体标签，例如 `bloom.downsample.mip-2` 或 `bloom.upsample.mip-1`。管线、着色器和资源声明由调用方提供；该适配器只负责分组，不实现 Bloom 滤镜。已声明的资源继续保留其声明时所属的组。

~~~ts
import type { FrameGraphRecording, RenderPassNodeDesc } from '@zenfg/webgpu';

export function recordBloomGroups(
  recorder: FrameGraphRecording,
  downsample: readonly RenderPassNodeDesc[],
  upsample: readonly RenderPassNodeDesc[],
): void {
  recorder.withDebugGroup('bloom', () => {
    recorder.withDebugGroup('downsample', () => {
      for (const pass of downsample) recorder.render(pass);
    });
    recorder.withDebugGroup('upsample', () => {
      for (const pass of upsample) recorder.render(pass);
    });
  });
}
~~~

对于交错的工作，请在原调用位置录制不同阶段的组。recorder 不提供进入已有组 ID 的 API。Snapshot 可以表达非连续的组引用；原生 GPU 标记也可以在提交片段周围重新打开已录制的路径，但这两者都不会增加 recorder 重新进入组的 API。只有需要原生标记时，才在执行时启用 `gpuDebugGroups`。

<a id="common-tasks"></a>

## 常见任务

| 任务 | 公共 API |
| --- | --- |
| 创建绑定到设备的运行时 | `new FrameGraph(device)` |
| 标注诊断分组 | `pushDebugGroup()`, `popDebugGroup()`, `withDebugGroup()` |
| 开始录制 | `beginFrame()` |
| 创建瞬态存储 | `createTexture()`, `createBuffer()` |
| 导入调用方拥有的存储 | `importTexture()`, `importBuffer()` |
| 导入当前呈现目标 | `importSwapchainTexture()` |
| 选择纹理子资源 | `createTextureView()` |
| 声明类型化资源访问 | `use()`，使用 `TextureAccess` 或 `BufferAccess` |
| 录制结构化工作 | `render()`, `compute()`, `copy()`, `clearBuffer()` |
| 添加原生渲染通道字段 | `render({ webgpuDescriptor })`，使用 `WebGpuRenderPassDescriptorExtras` |
| 编码由图拥有的自定义命令 | `command()` |
| 调用自行提交的渲染器 | `externalSubmission()` |
| 保留可观察值 | `markPresent()`, `markOutput()`, `markReadback()`, `markDebugCapture()`, `markPersistentState()` |
| 编译精简的可执行计划 | `compile()` |
| 请求完整编译诊断 | `compile({ report: true })` |
| 执行，并可选择请求计时/调试分组 | `compiled.execute()` |
| 检查或管理保留的分配 | `getResourcePoolStats()`, `createResourcePoolScope()`, `clearResourcePool(scope?)`, `evictResourcePool(predicate)` |
| 导出可移植诊断数据 | `createFrameGraphSnapshot()`，来自 `@zenfg/webgpu/snapshot` |
| 释放运行时拥有的资源 | `destroy()` |

准确字段、重载、默认值、返回类型和失败条件见随包源代码及声明中保留的 TSDoc。

<a id="key-pattern-declare-list-and-unwrap-access"></a>

## 关键模式：声明、列出并解析访问令牌

`use()` 会创建一个不透明的类型化令牌。节点必须先在 `uses` 中列出该令牌，其同步回调才能通过 `unwrap()` 解析对应资源：

```ts
const sampledSceneColor = recorder.use(
	sceneColor,
	TextureAccess.Sampled,
);

recorder.render({
	label: 'present',
	uses: [sampledSceneColor],
	colorAttachments: [{
		target: backbuffer,
		loadOp: 'clear',
		storeOp: 'store',
	}],
	encode({ pass, unwrap }) {
		const sceneColorView = unwrap(sampledSceneColor);
		pass.setPipeline(presentPipeline);
		pass.setBindGroup(0, createPresentBindGroup(sceneColorView));
		pass.draw(3);
	},
});
```

解析出的瞬态对象只在回调期间有效，不要跨回调或帧缓存它们。完整示例 [`transient-to-present.ts`](../examples/transient-to-present.ts) 展示了管线和绑定组的设置，不依赖占位辅助函数。

<a id="native-render-pass-descriptor-extras"></a>

## 原生渲染通道描述符扩展

`render({ webgpuDescriptor })` 透传额外的原生 WebGPU 描述符字段，同时保留正常附件校验、load/store/resolve 内容跟踪、显式 `uses` 和可选 GPU 计时。省略此选项时保留现有描述符。`label`、`colorAttachments`、`depthStencilAttachment` 和 `timestampWrites` 由 ZenFG 管理；公开类型禁止扩展包含这些字段，录制时也会以 `FG2013` 拒绝。

使用 `WebGpuRenderPassDescriptorExtras` 处理 `occlusionQuerySet` 和 `maxDrawCount` 等标准字段；实验字段则可由应用添加本地类型。例如，
[GPUWeb bindless 草案](https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md#encoder-state-and-pipeline-compatibility)
会在原生渲染通道描述符中增加 `resourceTable`。实际的原生表由应用提供；ZenFG 不定义实验性的资源表 API：

```ts
import type {
	FrameGraphRecording,
	RenderPassNodeDesc,
	WebGpuRenderPassDescriptorExtras,
} from '@zenfg/webgpu';

type ResourceTableDescriptorExtras = WebGpuRenderPassDescriptorExtras & {
	readonly resourceTable: object;
};

function recordWithResourceTable(
	recorder: FrameGraphRecording,
	draw: Omit<RenderPassNodeDesc, 'webgpuDescriptor'>,
	resourceTable: object,
): void {
	const webgpuDescriptor: ResourceTableDescriptorExtras = { resourceTable };
	recorder.render({ ...draw, webgpuDescriptor });
}
```

只接受自有、可枚举、键为字符串的数据属性。symbol 键、getter、不可枚举的自有属性，以及 `__proto__`、`constructor` 或 `prototype` 字段都会以 `FG2013` 拒绝。录制时会浅拷贝这些字段：之后修改描述符对象不会改变编译帧，所引用的 GPU 对象则保留其身份。每次执行保留的编译帧时，这些对象都必须有效；ZenFG 不会创建、更新、导入或销毁以此方式提供的资源表。

原生功能检测、启用设备功能、管线布局兼容性（包括草案中的 `usesResourceTable`）和原生校验均由应用负责。描述符扩展不会推导图依赖：即使着色器不通过绑定组访问资源，经由表访问的图纹理或缓冲区仍需在节点的 `uses` 中显式列出访问令牌。解析出的瞬态对象仍只在回调期间有效。原生扩展仅适用于 TypeScript WebGPU 运行时，不会写入可移植 Snapshot。

经过编译检查的 [`imported-resource.ts`](../examples/imported-resource.ts) 示例接受可选的 `webgpuDescriptor` 和调用方拥有的 MSAA 目标。其标准附件会解析到呈现纹理，只丢弃后续不再读取的多采样源。后续节点仍需读取内容的 MSAA 附件应保留 `storeOp: 'store'`。

<!-- skill:resource-decisions:start -->
<a id="resource-and-integration-choices"></a>

## 资源与集成方式

分配所有权和图可见性是两个独立选择。导入调用方拥有的存储可以启用图跟踪，但不会转移原生资源所有权。

| 需求 | 常见选择 |
| --- | --- |
| 帧内分配与资源池管理 | 声明瞬态 Bloom 中间资源、G-buffer 附件或由图管理的计算临时工作区。 |
| 图节点间的数据流、持久状态、输出或回读 | 声明相关资源、范围和访问。导入调用方拥有的历史数据、场景存储或 staging 缓冲区，并使用适当的根保留可观察结果。 |
| 无需图依赖跟踪或管理的私有存储 | 缓存的只读网格顶点/索引缓冲区、材质纹理、权重或工作负载内部临时区可继续由模块拥有并在内部绑定。调用方负责初始化、生命周期和内部执行安全。 |
| CPU 状态或原生绑定状态 | 场景/相机对象、管线、绑定组和采样器仍由应用拥有。原生资源表本身不是图纹理或缓冲区；应单独评估其底层资源。 |

资源存在时间长短本身并不能决定它是否应对图可见。如果图节点写入持久顶点/索引缓冲区或材质纹理，其他节点再读取，就应公开所需的数据流，而不要将其隐藏为缓存资产。图可见资源每次录制只导入一次，并通过结构化附件或`use()` 令牌（列在节点的 `uses` 中）声明全部访问。私有原生绑定不会被自动扫描。自定义或不透明工作应使用 `command()` 或 `externalSubmission()` 并声明边界访问；外部节点只对共享队列提交排序，不代表 GPU 已完成。

原生 `resourceTable` 描述符扩展只透传调用方拥有的状态。其条目不会自动导入、跟踪依赖或同步。经由表访问的图可见纹理/缓冲区仍需声明资源和 `uses`；功能、管线兼容性和原生生命周期均由应用负责。参见[原生扩展](#native-render-pass-descriptor-extras)和[资源声明粒度](CONCEPTS.zh-CN.md#choosing-resource-declaration-granularity)。
<!-- skill:resource-decisions:end -->

资源声明粒度可以灵活选择：复杂工作负载可在内部绑定私有权重、参数和临时工作区；教学或诊断场景则可以公开更多资源。图可见依赖和访问正确性要求仍然适用。详情见 [选择资源声明粒度](CONCEPTS.zh-CN.md#choosing-resource-declaration-granularity).

将资源公开给图时：

- 原生存储仅在当前编译帧中需要时，声明瞬态资源；存储由调用方拥有或须在执行结束后继续保留时，导入资源。
- 瞬态和表面内容初始未定义。首次写入瞬态范围必须完整覆盖该范围；部分、条件、稀疏或原子写入应使用保留式写入。
- `clearBuffer()` 省略 `size` 时，从 `offset`（默认零）清除到逻辑缓冲区边界，即使导入时缩小了原生大小也是如此。带行或层填充的纹理到缓冲区复制会保留所跟踪字节范围内的原有内容；若该范围内容未定义，请先初始化再复制。连续复制可以初始化自身范围。
- 尽可能使用结构化渲染、计算、复制和清除节点。在 FrameGraph 拥有的编码器上执行自定义工作时，使用 `command()`。
- 第三方渲染器自行拥有并提交编码器时，使用 `externalSubmission()`。该节点排列队列提交顺序，但不是 GPU 完成栅栏。
- 每个呈现帧都应获取一张新的表面纹理，并重新导入、编译、执行和呈现。

参见[核心概念](CONCEPTS.zh-CN.md)
，了解完整的所有权、内容、依赖、生命周期和集成模型。

<a id="error-handling"></a>

## 错误处理

录制、编译和执行期间由 ZenFG 检测到的失败（包括无效描述符、访问声明、复制操作、范围、根和执行选项）会抛出 `FrameGraphError`。请根据稳定的 `code` 和 `phase` 分支处理；只有能识别出失败节点或资源时，才会提供 `nodeId` 和 `resourceId`。错误消息面向用户，可能发生变化。

应用回调或 WebGPU 实现抛出的异常会原样传递。Snapshot 投影和序列化使用另一种错误 `FrameGraphSnapshotValidationError`，并带有结构化的 `issues`；请与 Snapshot 函数一起从 `@zenfg/webgpu/snapshot` 导入。过去会抛出普通 `Error` 或 `TypeError` 的校验失败，现在改为抛出 `FrameGraphError`（它仍继承自 `Error`）。

<a id="diagnostics-and-snapshot"></a>

## 诊断与 Snapshot

编译报告、CPU/GPU 计时和资源池统计均需显式启用，且彼此独立。请求这些信息不会改变执行计划。通过 `@zenfg/webgpu/snapshot` 将同一次执行的报告转换为可移植协议；普通编译和执行流程不会创建 Snapshot 数据。

Snapshot 导出只会生成内存中的值。捕获命名、文件系统存储、传输和保留策略仍由调用方负责。与语言无关的线协议约定见
[`@zenfg/snapshot` 规范](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/packages/snapshot/SPEC.md).

使用 `compiled.executeWithTiming({ frameIndex, timing: 'cpu' })`，并选择 `'cpu'`、`'gpu'` 或 `'both'`。返回的 `cpu` 报告会立即可用；只有请求 GPU 计时时才需等待 `gpu` Promise。普通 `execute()` 仍是同步操作，不收集计时。CPU 时长是经过时间，不是线程 CPU 使用量，且涵盖所有已执行的节点类型。导出时，编译报告、帧标识和资源池计数应来自同一次执行。

每个保留的渲染/计算节点使用两个 GPU 计时查询。计时节点超过 2048 个时，运行时会在创建计时资源前返回`unavailable` 结果，原因为 `too-many-timed-nodes`。执行仍会继续，`both` 模式也会保留 CPU 结果。展示或导出时都应将计时视为可选数据。

<a id="download-a-snapshot-for-inspector"></a>

### 下载 Snapshot 并在 Inspector 中查看

`@zenfg/webgpu/snapshot` 同时提供 WebGPU 投影和规范序列化器。已经依赖 `@zenfg/webgpu` 的应用无需依赖 `@zenfg/inspector` 也能导出文件：

```ts
import type { FrameGraph, FrameGraphRecording } from '@zenfg/webgpu';
import {
  createFrameGraphSnapshot,
  stringifyFrameGraphSnapshot,
} from '@zenfg/webgpu/snapshot';

async function downloadRecordedFrame(
  recorder: FrameGraphRecording,
  graph: FrameGraph,
  frameIndex: number,
): Promise<void> {
  const compiled = recorder.compile({ report: true });
  const timing = compiled.executeWithTiming({ frameIndex, timing: 'both' });
  const resourcePool = graph.getResourcePoolStats();
  const gpuTiming = await timing.gpu;
  const snapshot = createFrameGraphSnapshot({
    frameIndex: timing.frameIndex,
    compilation: compiled.compilationReport,
    cpuTiming: timing.cpu,
    gpuTiming,
    resourcePool,
  });
  const json = stringifyFrameGraphSnapshot(snapshot, { pretty: true });
  const url = URL.createObjectURL(new Blob([json], {
    type: 'application/json;charset=utf-8',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `frame-graph-${snapshot.capture.frameIndex}.fgsnapshot.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

用户请求捕获后，在下一个正常录制的应用帧中使用此流程；其他帧仍用普通的 `compile().execute()`。等待 GPU 时间戳回读前，立即保存资源池统计。GPU 计时不可用会记录在 Snapshot 中，不会阻止导出。将下载的 `.fgsnapshot.json` 文件拖入[在线 Inspector](https://uinosoft.github.io/zenfg/inspector/)；导入的文件只在本地浏览器中处理，不会上传。

<a id="common-mistakes"></a>

## 常见错误

| 现象 | 解决方法 |
| --- | --- |
| 节点没有参与执行 | 使用正确的根保留其最终值；只有真实副作用才标记为副作用。 |
| 读取或保留式写入报告内容未定义 | 先清除或完整覆盖选定范围，或正确声明导入资源的初始内容。 |
| 瞬态资源的首次写入被拒绝 | 只有完整写入整个声明范围时才使用 `overwrite`。 |
| `unwrap()` 拒绝访问令牌 | 在当前节点的 `uses` 中列出同一个令牌；不要跨录制边界使用。 |
| 同一原生对象被重复导入 | 在组合边界导入一次，并共享逻辑句柄。 |
| 后续呈现帧失败 | 不要复用旧的当前纹理或已编译的呈现帧。 |
| 外部节点之后的工作过早开始 | 在回调返回前，将所有已声明的外部工作提交到共享设备队列。 |
| 计时不可用 | 将 `unsupported`、`busy`、`readback-failed` 和 `no-timed-nodes` 视为非致命结果。 |

<a id="complete-recipes"></a>

## 完整示例

以下文件随包发布，并按使用受支持公共入口的消费者进行类型检查：

| 工作流 | 示例 |
| --- | --- |
| 最简呈现生命周期 | [`minimal-frame.ts`](../examples/minimal-frame.ts) |
| 将瞬态渲染目标用于呈现 | [`transient-to-present.ts`](../examples/transient-to-present.ts) |
| 导入调用方拥有的资源 | [`imported-resource.ts`](../examples/imported-resource.ts) |
| 跨帧持久状态 | [`persistent-state.ts`](../examples/persistent-state.ts) |
| 不透明的第三方提交 | [`external-submission.ts`](../examples/external-submission.ts) |
| 生成可供浏览器下载或由调用方另行存储的 Snapshot JSON | [`snapshot-export.ts`](../examples/snapshot-export.ts) |
| 异步 GPU 计时 | [`gpu-timing.ts`](../examples/gpu-timing.ts) |
| 计算存储输出 | [`compute-output.ts`](../examples/compute-output.ts) |
| 按作用域清理尺寸调整后的资源并驱逐空闲实例 | [`resource-pool-control.ts`](../examples/resource-pool-control.ts) |

依赖 GPU 的示例会通过编译检查。纯 CPU 工作流也会在 CI 中执行。示例输入约定见 [示例索引](../examples/README.zh-CN.md) 。

<!-- skill:pool:start -->
<a id="resource-pool-maintenance"></a>

## 资源池维护

创建一次作用域，并通过瞬态声明选项传入：`recorder.createTexture(desc, { scope })` 或 `recorder.createBuffer(desc, { scope })`。清理作用域只影响保留的缓存条目，会保留历史计数器，且作用域仍可继续使用。停止旧尺寸计划后，在两次执行之间清理；重新执行旧计划可能再次创建其分配。`clearResourcePool()` 和 `clearResourcePool(undefined)` 会清理所有分区。

使用 `evictResourcePool(info => info.unusedExecutions > 60)` 实现应用的空闲策略，或使用 `info.scope === undefined` 只选择默认分区。谓词接收冻结的物理规格，其中包含向上取整后的缓冲区容量，不包含 GPU 句柄或持久实例 ID。谓词必须同步返回布尔值。选择阶段抛出异常时资源池保持不变；遍历顺序未作保证，也不保证严格 LRU。选择阶段禁止运行时执行和资源池变更。这些 API 不会等待 GPU 完成。

完整的尺寸调整和驱逐示例见[资源池控制](../examples/resource-pool-control.ts)；所有权、空闲计数和失败边界由[核心概念](CONCEPTS.zh-CN.md#lifetime-and-allocation)定义。
<!-- skill:pool:end -->

<a id="further-reading"></a>

## 延伸阅读

- [ZenFG 文档索引](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/docs/README.md)
- [核心概念](CONCEPTS.zh-CN.md)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/packages/snapshot/README.md)
- [`@zenfg/inspector`](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/packages/inspector/README.md)
- [兼容性](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/docs/compatibility.md)


<!-- skill:reading:start -->
<a id="usage-references"></a>

## 使用参考

- [运行时概念](CONCEPTS.zh-CN.md)
- [升级说明](MIGRATION.zh-CN.md)
- [完整示例](../examples/)
<!-- skill:reading:end -->
