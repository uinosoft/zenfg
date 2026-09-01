# @zenfg/webgpu

[![npm](https://img.shields.io/npm/v/%40zenfg%2Fwebgpu?include_prereleases&label=npm)](https://www.npmjs.com/package/@zenfg/webgpu)
[![状态：beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md)
[![CI](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg)](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/main/LICENSE)

[English](./README.md) | 简体中文

`@zenfg/webgpu` 是一个轻量的 WebGPU FrameGraph，用于声明和执行逐帧
GPU 工作。它负责排列图节点、校验资源访问、剔除无用工作、推导 WebGPU usage、
跟踪生命周期，以及复用 transient texture 和 buffer。

它有意不成为 renderer abstraction。FrameGraph 拥有图可见资源、依赖关系、执行顺序、
retention root、transient allocation 和可选诊断；调用方仍然拥有场景数据、pipeline、
bind group、sampler、长生命周期 GPU 资源、setup/resize 策略，以及具体 draw 或
dispatch 行为。

```txt
调用方状态 -> 图节点声明 -> FrameGraph -> 有序 GPU commands
```

当前包是公开 beta 包，1.0 前公共 API 仍可能变化；集成期间请锁定精确版本。
只从包根入口导入受支持的 API：

```ts
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
```

`src/index.ts` 是唯一公共入口。`src/` 下的源码模块和 `dist/` 下的生成文件都不是受支持的
package subpath。

## 安装

```sh
npm install @zenfg/webgpu@0.1.0-beta.1
```

## 快速开始

### 最小帧

在一个 `GPUDevice` 的生命周期内持续持有同一个 `FrameGraph` runtime。每个显示帧都创建
新的 recorder，并导入新的当前 swapchain texture。下面是一个完整帧；render pass 只清除
attachment，因此不需要 render pipeline：

```ts
import { FrameGraph } from '@zenfg/webgpu';

// `device` 和已配置的 `context` 由调用方拥有。
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

// 释放 device-bound renderer stack 时：
// graph.destroy();
```

`markPresent()` 将 backbuffer 的最终值设为 retention root。没有 root 或 side-effect
node 时，不参与任何可观察结果的工作会被剔除。普通执行会同步记录并提交 commands；只有
显式请求 GPU timing 时才需要 `await`。

### 典型的 Transient 到显示流程

下一个示例展示 transient scene target、access token 和 presentation pass 之间的常见关系。
它假设调用方已经创建：

- `scenePipeline`：把 fullscreen triangle 渲染到 `rgba16float`；
- `presentPipeline`：通过 binding `0` 的 sampler 采样 binding `1` 的 texture，并渲染到
  已配置的 canvas format；
- 与 presentation pipeline 兼容的调用方自有 `sampler`。

```ts
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';

const graph = new FrameGraph(device);

function renderFrame(width: number, height: number, frameIndex: number): void {
	const recorder = graph.beginFrame();

	const sceneColor = recorder.createTexture({
		label: 'scene-color',
		format: 'rgba16float',
		size: [width, height],
	});
	const backbuffer = recorder.importSwapchainTexture(
		context.getCurrentTexture(),
		{ label: 'backbuffer' },
	);

	recorder.render({
		label: 'scene',
		colorAttachments: [{
			target: sceneColor,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		encode({ pass }) {
			pass.setPipeline(scenePipeline);
			pass.draw(3);
		},
	});

	const sampledSceneColor = recorder.use(sceneColor, TextureAccess.Sampled);
	recorder.render({
		label: 'present',
		uses: [sampledSceneColor],
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		encode({ device, pass, unwrap }) {
			const presentBindGroup = device.createBindGroup({
				layout: presentPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: sampler },
					{ binding: 1, resource: unwrap(sampledSceneColor) },
				],
			});
			pass.setPipeline(presentPipeline);
			pass.setBindGroup(0, presentBindGroup);
			pass.draw(3);
		},
	});

	recorder.markPresent(backbuffer);
	recorder.compile().execute({ frameIndex });
}
```

scene target 没有显式给出 WebGPU `usage`：编译会从保留的访问推导
`RENDER_ATTACHMENT | TEXTURE_BINDING`。sampled token 必须出现在 presentation
node 的 `uses` 列表中，该节点才能调用 `unwrap()`。

## 生命周期与核心模型

FrameGraph 使用三种生命周期不同的对象：

```txt
FrameGraph runtime -> FrameGraphRecorder -> CompiledFrame
                       record + compile      execute / conditional re-execute
```

- `FrameGraph` 是长期存在、永久绑定一个 `GPUDevice` 的 runtime。它拥有 transient
  resource pool 和延迟创建的 GPU profiler 资源。
- `beginFrame()` 返回独立、单次使用的 recorder。无论成功还是失败，`compile()` 都会
  消耗它。
- `CompiledFrame` 只包含保留的执行数据。执行时解析逻辑资源、记录并提交已编译 segment，
  随后把 transient 资源归还 runtime pool。

只有在所有捕获的 callback 和借用的 GPU 资源仍然有效时，compiled frame 才可以再次执行。
声明式可变容器会在记录时与调用方对象分离，但 callback、导入的 GPU 对象、handle 和
use-token identity 仍是固定引用。再次执行不会刷新这些引用，也不会校验其调用方自有生命周期。

尤其是，包含当前 swapchain texture 的 compiled frame 通常只在当前帧有效。下一帧应重新
获取并导入 texture，而不是再次执行旧的 presentation recording。

同一个 runtime 的执行是串行的；递归或重叠的 `execute()` 会被拒绝。执行期间仍可记录和
编译独立 recorder，但 FrameGraph 不分析跨帧依赖，compiled frame 依靠 `GPUQueue` 的提交顺序。

## 核心 API 概览

| 领域 | 公共 API | 用途 |
| --- | --- | --- |
| Runtime | `new FrameGraph(device)` | 创建 device-bound runtime。 |
| Recording | `beginFrame()` | 开始一次独立、单次使用的 recording。 |
| Transient 资源 | `createTexture()`, `createBuffer()` | 声明只属于当前 compiled frame 的图自有资源。 |
| 导入资源 | `importTexture()`, `importSwapchainTexture()`, `importBuffer()` | 将调用方自有 GPU 资源注册到图可见数据流。 |
| 资源元数据 | `getTextureDesc()`, `getBufferDesc()` | 读取注册时保存的独立 descriptor snapshot；修改返回值不会改变图声明。 |
| 逻辑 view | `createTextureView()`, `getTextureViewDesc()` | 选择 texture subresource，并读取规范化 view descriptor。 |
| Access 类型 | `TextureAccess`, `BufferAccess` | 列出支持的 texture 和 buffer access role。 |
| 访问声明 | `use()` | 为资源或 view 创建带类型的 read/write token。 |
| 结构化节点 | `render()`, `compute()`, `copy()`, `clearBuffer()` | 声明带图可见访问的常见 WebGPU 工作。 |
| Escape hatch | `command()`, `externalSubmission()` | 记录自定义 command 或不透明的调用方自有 queue submission。 |
| Retention root | `markPresent()`, `markOutput()`, `markReadback()`, `markDebugCapture()` | 按具体意图保留最终可见 producer。 |
| 编译 | `compile()`, `compile({ report: true })` | 消耗 recorder，并可选附加诊断 snapshot。 |
| 执行 | `compiled.execute()` | 编码并提交保留的 execution segment。 |
| Pool 控制 | `getResourcePoolStats()`, `clearResourcePool()` | 观察或清除保留的 transient allocation。 |
| 销毁 | `destroy()` | 释放 runtime 自有资源并使未完成工作失效。 |

精确字段、overload、默认值和 callback 类型见 `dist/index.d.ts` 中保留的 TSDoc。

## 资源与逻辑值

### 选择所有权

根据生命周期和图可见数据流选择资源所有权：

- 物理资源只在当前 compiled frame 执行期间需要时，使用 `createTexture()` 或
  `createBuffer()`；FrameGraph 负责分配、复用和释放。
- 资源生命周期长于当前图，但节点必须声明涉及它的读取、写入、复制、保留或显示时，导入
  调用方自有资源。
- 调用方实现状态不参与图可见数据流时，把它留在 FrameGraph 之外。

因此，相机数据、pipeline、bind group、sampler 和局部 cache 通常留在图外。只有 camera
buffer 产生或消费的数据必须参与图排序或保留时，才导入它。

`getTextureDesc()`、`getBufferDesc()` 和 `getTextureViewDesc()` 提供只读的注册
snapshot，供 recording 阶段选择兼容 pipeline variant 或 binding range；它们不转移所有权。
省略 `usage` 的 transient descriptor 仍会报告 `usage: undefined`；推导 usage 是编译结果。

每个原生 `GPUTexture` 或 `GPUBuffer` 在一次 recording 中只有一个逻辑身份，只能导入一次。
`importTexture()` 与 `importSwapchainTexture()` 共享原生 texture identity 检查。共享
storage 应在其所有权边界或应用装配边界导入一次，再把所得 handle 传给所有 consumer。

导入元数据会从原生 WebGPU 对象保存为 snapshot。`exposedSize` 可以把 buffer 限制为一个
逻辑前缀，`exposedUsage` 可以把任一资源类型限制为 usage subset。这些选项约束图校验和
依赖分析，但不是安全边界：`unwrap()` 仍然返回完整的原生 buffer。

Transient descriptor 可以省略 `usage`；编译只从保留的访问推导 flags。显式提供 `usage`
时，它就是 allocation contract，必须覆盖所有保留需求。被剔除的访问仍会出现在 report 中，
但不贡献物理 usage。

编译后生命周期不重叠的兼容 transient 资源可以复用同一 pool allocation。FrameGraph 永远
不会拥有、销毁或池化导入资源。

### 有序逻辑资源

Handle 是 recording-local 的稳定逻辑 storage identity，不是物理 GPU 对象，也不是不可变
value version。节点可见的值由三项共同确定：

1. 逻辑 texture 或 buffer；
2. 选中的 texture subresource 或 buffer byte range；
3. 节点在记录顺序中的位置。

保留节点按照记录顺序的稳定子序列执行。编译选择所需 producer，并添加 RAW、WAR、WAW
依赖；它不会重排节点。同一节点内的 `uses` 列表顺序没有语义：read 消费节点前的值，write
产生或使节点后的值失效。

| 声明 | 节点前的值 | 节点后的值 |
| --- | --- | --- |
| read | 被消费 | 不变 |
| overwrite write | 不消费 | 产生 |
| preserve write | 被消费 | 产生 |
| discard write | 除非操作同时 load，否则不消费 | 不产生 |
| resource root | 选择 recording 结尾最终可见的 producer | 无 |

每个通过 `use()` 创建的显式 write 都要声明
`contents: 'overwrite' | 'preserve'`：

- `overwrite` 保证声明范围在每条执行路径上都被完整定义，不需要旧值。
- `preserve` 是 partial、conditional、sparse 或 atomic write 的保守选择。它会保留覆盖该
  范围的既有 producer，但不会在 diagnostics 中虚构物理 read access。

Transient range 的第一次 write 必须 overwrite。导入资源从调用方自有 external value
开始，因此可以在图内 writer 之前 read 或 preserve。使用 `storeOp: 'discard'` 的
attachment 会使选中范围失效；在另一次 overwrite 恢复之前，后续 read 或 preserve 非法。

Attachment、copy operation 和 buffer clear 会推导 access 和 content semantics。
`loadOp: 'load'` 表示 preserve，`loadOp: 'clear'` 表示 overwrite，
`storeOp: 'store'` 产生值，`storeOp: 'discard'` 不产生值。Buffer copy 和 clear 跟踪
精确 byte range。Texture history 跟踪 mip、array layer、3D depth slice 和 aspect；
partial XY texture copy 会在该 subresource 粒度上保守地采用 preserve。

Buffer access 可以声明 `{ range: { offset, size } }`，省略时表示整个 buffer。GPU 工作
能完整定义的范围应使用最小精确 overwrite range；动态或稀疏覆盖无法用静态范围表达时使用
preserve。

### Use Token 与 Texture View

`use(handle, access, options?)` 创建不透明、带类型的 access token。创建 token 本身不会
产生依赖；消费它的每个节点都必须把它列入 `uses`。同一个 token 可以被多个节点复用，并在
每个节点位置独立解析，但同一节点不能重复使用它。

在同步节点 callback 内，`unwrap(token)` 返回：

- sampled、storage、color 或 depth texture access 对应 `GPUTextureView`；
- texture copy access 对应 `GPUTexture`；
- buffer access 对应 `GPUBuffer`。

只能 unwrap 当前节点列出的 token。解析出的资源和 encoder 只在当前 callback 中有效，不能
逃逸。Handle 和 token 也不能跨 recording 使用。

`TextureViewHandle` 选择 format、dimension、aspect、mip level 和 array layer，但不创建
物理 allocation，也不捕获值。直接传入 texture handle 时使用特定 role 的默认 view：
sampled access 选择普通完整 view，storage 和 attachment access 选择所需的 single-mip
形式。

```ts
const bloomMip = recorder.createTextureView(bloom, {
	baseMipLevel: mip,
	mipLevelCount: 1,
});
const bloomMipDesc = recorder.getTextureViewDesc(bloomMip);
const sampledBloomMip = recorder.use(bloomMip, TextureAccess.Sampled);

recorder.render({
	uses: [sampledBloomMip],
	colorAttachments: [{
		target: output,
		loadOp: 'clear',
		storeOp: 'store',
	}],
	encode({ pass, unwrap }) {
		void bloomMipDesc;
		pipeline.encode(pass, unwrap(sampledBloomMip));
	},
});
```

`TextureDesc.viewFormats` 是兼容 alternate format 的 creation-time allowlist，常见用途是
linear/sRGB 组合。对于导入 texture，调用方必须保证声明的每个 alternate format 在创建
原生 texture 时已获允许，因为 WebGPU 不暴露原始列表。

## 节点与 Root

### 结构化节点

优先使用最具体的节点类型：

- `render()` 对应 `beginRenderPass()`。Attachment 自行声明访问；sampled、storage 和
  buffer dependency 放在 `uses` 中。
- `compute()` 对应 `beginComputePass()`，通过 `uses` 声明访问资源。
- `copy()` 记录声明式 buffer/texture copy，并推导访问。
- `clearBuffer()` 记录声明式 `clearBuffer()` operation，并推导精确 `CopyDst`
  overwrite range。Offset 和 size 必须 4-byte aligned。
- `command()` 是不适合结构化节点时的 fallback。默认是 side effect，必须声明所有被
  unwrap 的 token，并且不能 finish 或 submit FrameGraph 自有 encoder。

Depth clear 与 comparison convention 由调用方拥有。被 clear 的 depth attachment 必须
给出 `depthClearValue`；reverse-z scene depth 通常清为 `0`，owned shadow map 等
conventional depth 通常清为 `1`。Stencil format 不在当前 contract 内，会被拒绝。

### Root 与剔除

FrameGraph 会剔除不参与任何 root 的节点。Side-effect node 本身是 root；resource root
保留其覆盖范围的最终可见 producer：

```ts
recorder.markPresent(backbuffer);
recorder.markOutput(sceneColor);
recorder.markReadback(readbackBuffer);
recorder.markDebugCapture(debugTexture);
```

`markOutput()` 保留逻辑值；它不会 unwrap 或转移 transient 物理 allocation 的所有权，也
不会延长其生命周期。执行后仍需访问的结果必须使用调用方自有的导入 storage。

Readback buffer 必须是导入的调用方自有 buffer，并且只暴露
`GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ`。等待 GPU 完成、map、消费字节以及
销毁 staging storage，仍然属于调用方的 post-submit 工作。

## 生产与互操作边界

FrameGraph 在以下边界内提供确定性的记录、编译、同步 command encoding 和 queue
submission：

- 每个 runtime 永久绑定构造函数传入的 `GPUDevice`。Device loss/recreation、error scope
  和 uncaptured error 由调用方处理。
- 导入资源和 callback 使用的 GPU 状态必须属于该 device；WebGPU 没有可移植的 device
  identity 检查。
- 节点 callback、external `submit`、`beforeSubmit` 和 `afterSubmit` 都是同步的；返回类型
  必须是 `undefined`。async 函数、Promise-like 返回值和其他返回值都会被拒绝。运行时也会
  保护 JavaScript 调用方以及被擦除或强制转换的 TypeScript 代码。
- `execute({ frameIndex })` 要求传入非负安全整数。非法值会在资源申请、GPU timing 初始化和
  callback 执行之前被拒绝。
- Queue submission 不是事务。已经成功提交的 segment 无法在后续 encoding、callback 或
  submission 失败时回滚。
- Transient pool 没有自动显存预算或淘汰策略。资源会一直保留到复用、
  `clearResourcePool()` 或 `destroy()`。
- CPU 校验保护图的 dependency、format、range、usage 和 allocation 计算，但不能替代完整
  WebGPU validation、device limit 或内存可用性处理。

生产调用方应在每个显示帧获取新的 current texture，捕获同步 `execute()` failure；当已有
工作可能提交时丢弃失败的 swapchain frame；监控 `device.lost`，并在替换 device 上重建
整套调用方自有 runtime stack。

Resize 或高度动态 descriptor 阶段结束后，如果旧 allocation 已无复用价值，可调用
`clearResourcePool()`。`destroy()` 会释放 pool/profiling 资源并使未完成 recorder 和
compiled frame 失效，但不会销毁 device 或导入资源。

### External Submission

当第三方 renderer 拥有 command encoder，并通过同一个 device queue 提交工作时，使用
`externalSubmission()`。保留的 external node 构成硬性、不透明的 execution-segment
边界：FrameGraph 先提交它之前的 graph segment，调用它，再为后续节点开始新 segment。
这会排序 queue submission，但不是 GPU-completion fence。

```ts
const sharedDepthRead = recorder.use(sharedDepth, TextureAccess.DepthRead);
const externalColorWrite = recorder.use(
	externalColor,
	TextureAccess.ColorAttachmentWrite,
	{ contents: 'overwrite' },
);

recorder.externalSubmission({
	label: 'third-party.render',
	uses: [sharedDepthRead, externalColorWrite],
	submit({ device, unwrap }) {
		thirdParty.renderAndSubmit({
			device,
			depth: unwrap(sharedDepthRead),
			color: unwrap(externalColorWrite),
		});
	},
});
```

External contract 很严格：

- `uses` 必须声明对图跟踪资源的每一次访问。从未导入的 private resource 无需声明。
- 导入资源可以通过 external owner 已有的原生引用访问，但仍必须声明匹配的图访问。
- Transient 资源必须通过当前 `unwrap()` 获取，不能逃逸同步 callback，也不能被稍后入队的
  工作使用。
- 所有图可见工作都必须在 callback 返回前入队到传入的 `device.queue`。
- 返回 Promise-like 值违反同步契约。FrameGraph 会拒绝它且不会 await；callback 返回前已经
  执行的工作无法回滚。
- FrameGraph 无法检查不透明 command，也无法确认实际访问与声明一致。

Opacity 与 retention 是两件事。External node 默认是 side effect；不可达的
`sideEffect: false` external node 会被剔除，因此不会创建 segment boundary。

### 执行 Hook 与再次执行

`beforeSubmit` 在 graph node 之后、FrameGraph-owned command segment 完成之前，把调用方
command 记录到每个这类 segment 中。它接收 `segmentIndex`/`segmentCount`；external
segment 不触发它。

`afterSubmit` 在所有保留 segment 成功之后、transient 资源归还 pool 之前执行一次。此时
queue submission 已发生，但不代表 GPU 已完成。它适合 post-submit bookkeeping 或启动
调用方自有 readback polling，并且必须同步返回 `undefined`。

多次执行会复用完全相同的已记录 callback 和导入对象。FrameGraph 不验证它们是否持续有效，
因此 conditional re-execution 由调用方决策，通常不适用于 swapchain recording。

## 诊断与 Resource Pool

Compilation diagnostics、GPU timing 和 pool statistics 相互独立：

```ts
const recorder = graph.beginFrame();
// Record resources and nodes.
const compiled = recorder.compile({ report: true });
const compilation = compiled.compilationReport;
const timingPromise = compiled.execute({ frameIndex, gpuTiming: true });
const pool = graph.getResourcePoolStats();
const timing = await timingPromise;
```

普通 `compile()` 返回不带 report 的紧凑 `CompiledFrame`。
`compile({ report: true })` 返回 `CompiledFrameWithReport`，其不含 callback 的 snapshot
包括：

- 保留的 `nodes` 和扁平 `culledNodes`；
- `resources`、lifetime、effective usage 和 physical allocation id；
- 覆盖保留与被剔除节点的一张规范化 `accesses` 表；
- `dependencies`、`roots`、`allocations` 和 `executionSegments`。

Report 不改变 execution plan。Read/write 会暴露规范化 texture region 或 buffer range；
discarded write 仍然可见，但不会被报告为 value producer。

`execute({ gpuTiming: true })` 仍然同步编码并提交，随后返回 timestamp readback promise。
同步错误会直接抛出，而不是通过该 promise 表示。Available report 包含 `frameIndex`、总帧
时长和自描述 render/compute node timing；unavailable report 的原因是 `unsupported`、
`busy` 或 `readback-failed`。每个 runtime 同时只能有一个 pending timing readback。

`getResourcePoolStats()` 同步报告 acquisition、reuse、creation、保留 allocation 数量和
估算保留字节，并有意不暴露 allocator-private bucket key。

要导出 portable Snapshot，应只在三个 report 对应同一已执行 frame 时调用
`createFrameGraphSnapshot()`。它会把数值 runtime id、WebGPU usage mask、surface origin、
timing availability 和 physical allocation 规范化为独立的 canonical Snapshot V1，并拒绝
非法数值、悬空 timing reference 和不匹配 compilation node 的 timing kind。未知 usage bit
不会被静默丢弃。三个独立 report 不携带共同的 compiled-frame identity，因此 compilation 与
timing 是否来自同一 `CompiledFrame` 仍是调用方约定；pool counter 是 runtime 的累计统计，
不是单 frame 度量。

## 校验与当前限制

注册和编译会在无效数据影响 dependency 或 allocation 计算之前，拒绝无效资源尺寸、unsafe
或 fractional range、usage 不兼容、无效 subresource 和不支持的 format role。

Texture extent 必须是正 uint32，mip count 受声明 extent 限制，sample count 当前是 `1`
或 `4`，buffer size 是非负 safe integer。Texture copy 校验会考虑 format block dimension；
同一 render pass 的 attachment 必须具有相同 extent 和 sample count。

Format capability 检查是保守的。Stencil format 会被拒绝。BC/ETC/EAC/ASTC compressed
format 已用于 copy block layout 校验，但尚未建模 compressed sampling、rendering 或
storage 的 device feature gate。在支持 device feature modeling 之前，tiered storage
format、`bgra8unorm-storage`、`rg11b10ufloat-renderable` 等 feature-gated plain color
capability 也处于禁用状态。

这些检查保护 FrameGraph 自身模型；它们不会复刻完整的 WebGPU descriptor validation matrix，
也不保证 allocation 一定成功。

## 开发

Package-local build 和检查：

```sh
npm run build --workspace @zenfg/webgpu
npm run typecheck --workspace @zenfg/webgpu
npm run test --workspace @zenfg/webgpu
npm run pack:dry-run --workspace @zenfg/webgpu
```

本地 CPU-only compile benchmark：

```sh
npm run benchmark:compile --workspace @zenfg/webgpu
```

Profile、scenario 和 CLI filter 见
[benchmark 指南](https://github.com/uinosoft/zenfg/blob/main/packages/webgpu/benchmarks/README.md)。
Benchmark result 只用于诊断，不是 CI gate。

Workspace baseline：

```sh
npm run build
npm run test
```

公共 TSDoc 会保留在生成的 declaration 中，是精确 API reference。本 README 聚焦所有权、
集成、常用工作流，以及最可能影响正确图构建的 contract。
