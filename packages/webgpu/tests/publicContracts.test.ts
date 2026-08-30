import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	type FrameGraph,
	type FrameGraphCompilationReport,
	type FrameGraphRecording,
	TextureAccess,
	type TextureUse,
} from '../src/index.ts';

test('public recording and compiled-frame types enforce lifecycle and typed-use contracts', () => {
	assert.ok(true);

	// This branch is type-checked but never executed. Each expected error protects
	// a public API boundary that runtime tests cannot express.
	if (false) {
		const runtime = null as unknown as FrameGraph;
		const featureRecording: FrameGraphRecording = runtime.beginFrame();
		const featureBuffer = featureRecording.createBuffer({ size: 4 });
		const bufferDesc = featureRecording.getBufferDesc(featureBuffer);
		const bufferSize: number = bufferDesc.size;
		// @ts-expect-error Registered buffer descriptors are read-only.
		bufferDesc.size = 8;
		// @ts-expect-error Feature-facing recordings cannot compile themselves.
		featureRecording.compile();

		const recorder = runtime.beginFrame();
		const texture = recorder.createTexture({ format: 'rgba8unorm', size: [1, 1] });
		const textureView = recorder.createTextureView(texture);
		const buffer = recorder.createBuffer({ size: 4 });
		recorder.markOutput(texture);
		recorder.use(texture, TextureAccess.StorageWrite, { contents: 'preserve' });
		recorder.use(textureView, TextureAccess.StorageWrite, { contents: 'overwrite' });
		recorder.use(buffer, BufferAccess.StorageWrite, {
			range: { offset: 0, size: 4 },
			contents: 'preserve',
		});
		recorder.use(buffer, BufferAccess.StorageRead, { range: { offset: 0, size: 4 } });
		// @ts-expect-error Explicit texture writes require logical-content behavior.
		recorder.use(texture, TextureAccess.StorageWrite);
		// @ts-expect-error Explicit texture-view writes require logical-content behavior.
		recorder.use(textureView, TextureAccess.StorageWrite);
		// @ts-expect-error Explicit buffer writes require logical-content behavior.
		recorder.use(buffer, BufferAccess.StorageWrite);
		// @ts-expect-error Every explicit write role, including copy destinations, requires contents.
		recorder.use(buffer, BufferAccess.CopyDst);
		const dynamicAccess = null as unknown as TextureAccess;
		// @ts-expect-error Dynamic read/write access unions must be narrowed before declaring a use.
		recorder.use(texture, dynamicAccess, { contents: 'overwrite' });
		// @ts-expect-error Read accesses cannot declare write-content behavior.
		recorder.use(texture, TextureAccess.Sampled, { contents: 'preserve' });
		// @ts-expect-error Texture-view reads cannot declare write-content behavior.
		recorder.use(textureView, TextureAccess.StorageRead, { contents: 'preserve' });
		// @ts-expect-error Buffer reads cannot declare write-content behavior.
		recorder.use(buffer, BufferAccess.StorageRead, { contents: 'preserve' });
		// @ts-expect-error Buffer ranges must be nested under the range option.
		recorder.use(buffer, BufferAccess.StorageWrite, { offset: 0, size: 4, contents: 'overwrite' });
		// @ts-expect-error Color attachment loads are represented by write-preserve, not a read access enum.
		TextureAccess.ColorAttachmentRead;

		// @ts-expect-error Texture handles reject buffer access roles.
		recorder.use(texture, BufferAccess.StorageRead);
		// @ts-expect-error Buffer handles reject texture access roles.
		recorder.use(buffer, TextureAccess.Sampled);
		// @ts-expect-error Texture-view handles reject raw texture copy roles.
		recorder.use(textureView, TextureAccess.CopySrc);

		const sampled = recorder.use(texture, TextureAccess.Sampled);
		const copied = recorder.use(texture, TextureAccess.CopySrc);
		const storage = recorder.use(buffer, BufferAccess.StorageRead);
		// @ts-expect-error Resource-use tokens expose no public runtime discriminator.
		sampled.kind;
		// @ts-expect-error Resource-use tokens expose no public access field.
		sampled.access;
		// @ts-expect-error Resource-use tokens expose no public structural brand.
		sampled.__brand;
		// @ts-expect-error Resource-use tokens cannot be constructed by callers.
		const forged: TextureUse<TextureAccess.Sampled> = {};
		recorder.render({
			uses: [sampled, storage],
			encode(ctx) {
				const view: GPUTextureView = ctx.unwrap(sampled);
				const nativeBuffer: GPUBuffer = ctx.unwrap(storage);
				// @ts-expect-error Render contexts do not expose command encoders.
				ctx.encoder;
				// @ts-expect-error Sampled texture uses unwrap to GPUTextureView.
				const wrongBuffer: GPUBuffer = ctx.unwrap(sampled);
				void [view, nativeBuffer, wrongBuffer, forged, bufferSize];
			},
		});
		recorder.compute({
			uses: [sampled],
			encode(ctx) {
				// @ts-expect-error Compute contexts do not expose command encoders.
				ctx.encoder;
			},
		});
		recorder.command({
			uses: [copied],
			encode(ctx) {
				const nativeTexture: GPUTexture = ctx.unwrap(copied);
				void [ctx.encoder, nativeTexture];
			},
		});
		const groupedValue: number = recorder.withDebugGroup('Typed Group', () => 1);
		// @ts-expect-error Debug group recording must be synchronous.
		recorder.withDebugGroup('Async Group', async () => {});
		// @ts-expect-error A possibly asynchronous debug group recording result is not allowed.
		recorder.withDebugGroup('Maybe Async Group', (): number | Promise<number> => 1);
		recorder.pushDebugGroup('Manual Group');
		recorder.popDebugGroup();
		void groupedValue;

		const plain = runtime.beginFrame().compile();
		plain.execute({ gpuDebugGroups: true });
		// @ts-expect-error Plain compiled frames do not expose a compilation report.
		plain.compilationReport;
		const reported = runtime.beginFrame().compile({ report: true });
		const report: FrameGraphCompilationReport = reported.compilationReport;
		void report;
	}
});
