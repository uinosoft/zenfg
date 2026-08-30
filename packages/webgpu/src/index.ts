/**
 * Declares, compiles, and executes per-frame WebGPU work while leaving scene
 * data, pipelines, bind groups, and long-lived GPU resources caller-owned.
 *
 * All exports are currently beta. The package has one supported entrypoint;
 * implementation modules under `src` and `dist` are not public subpaths.
 *
 * @packageDocumentation
 */

export { FrameGraph } from './frameGraph.ts';
export {
	BufferAccess,
	TextureAccess,
} from './types.ts';
export type {
	BufferDesc,
	BufferHandle,
	BufferRange,
	BufferUse,
	BufferUseOptions,
	BufferWriteUseOptions,
	ClearBufferNodeDesc,
	ClearBufferOperation,
	CommandEncodeContext,
	CommandNodeDesc,
	CompiledFrame,
	CompiledFrameAfterSubmitContext,
	CompiledFrameExecuteOptions,
	CompiledFrameSubmitContext,
	CompiledFrameWithReport,
	ComputeEncodeContext,
	ComputePassNodeDesc,
	CompiledTextureRegion,
	CopyNodeDesc,
	CopyOperation,
	CulledNodeReason,
	ExternalSubmissionContext,
	ExternalSubmissionNodeDesc,
	FrameGraphCompilationReport,
	FrameGraphCompilationAccess,
	FrameGraphExecutionSegmentKind,
	FrameGraphGpuTimingReport,
	FrameGraphResourcePoolStats,
	GraphRootReason,
	ImportBufferOptions,
	ImportTextureOptions,
	NodeKind,
	RenderColorAttachmentDesc,
	RenderDepthStencilAttachmentDesc,
	RenderEncodeContext,
	RenderPassNodeDesc,
	ResourceUse,
	ResourceAccessMode,
	ResourceHandle,
	ResourceKind,
	ResourceOrigin,
	TextureDesc,
	TextureHandle,
	TextureSize,
	TextureUse,
	TextureViewAccess,
	TextureViewDesc,
	TextureViewHandle,
	TextureViewUse,
	UnwrappedResource,
	WriteContents,
	WriteUseOptions,
	NormalizedTextureViewDesc,
	FrameGraphRecorder,
	FrameGraphRecording,
} from './types.ts';
