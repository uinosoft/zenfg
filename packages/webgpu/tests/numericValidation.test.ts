import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	FrameGraph,
	TextureAccess,
	type CopyOperation,
	type TextureSize,
} from '../src/index.ts';
import { bufferAllocationSize } from '../src/resourceDescriptors.ts';
import {
	buffer,
	bufferUsage,
	mockDevice,
	texture,
	textureUsage,
} from './testUtils.ts';

const invalidSafeIntegers = [
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	-1,
	1.5,
	Number.MAX_SAFE_INTEGER + 1,
] as const;

const invalidUint32Values = [
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	-1,
	1.5,
	0x1_0000_0000,
] as const;

test('resource registration rejects invalid buffer sizes and preserves zero-sized buffers', () => {
	for (const size of invalidSafeIntegers) {
		assert.throws(
			() => new FrameGraph(mockDevice()).beginFrame().createBuffer({ label: 'invalid', size }),
			/Buffer descriptor "invalid" size must be a non-negative safe integer/,
			String(size),
		);
		assert.throws(
			() => new FrameGraph(mockDevice()).beginFrame().importBuffer(buffer('invalid'), { label: 'invalid', exposedSize: size, exposedUsage: bufferUsage.STORAGE }),
			/Buffer descriptor "invalid" size must be a non-negative safe integer/,
			String(size),
		);
	}

	assert.doesNotThrow(() => new FrameGraph(mockDevice()).beginFrame().createBuffer({ label: 'empty', size: 0 }));
	assert.doesNotThrow(() => new FrameGraph(mockDevice()).beginFrame().importBuffer(buffer('empty'), { label: 'empty', exposedSize: 0, exposedUsage: bufferUsage.STORAGE }));
});

test('resource registration validates texture extent, mip count, and sample count', () => {
	for (const value of invalidUint32Values) {
		assert.throws(
			() => new FrameGraph(mockDevice()).beginFrame().createTexture({
				label: 'invalid-extent',
				format: 'rgba8unorm',
				size: [value, 1],
			}),
			/Texture descriptor "invalid-extent" size\.width must be a positive uint32 integer/,
			`extent ${value}`,
		);
	}
	for (const mipLevelCount of [0, ...invalidUint32Values.filter((value) => value !== -1)] as const) {
		assert.throws(
			() => new FrameGraph(mockDevice()).beginFrame().createTexture({
				label: 'invalid-mips',
				format: 'rgba8unorm',
				size: [8, 8],
				mipLevelCount,
			}),
			/Texture descriptor "invalid-mips" mipLevelCount must be a positive uint32 integer|must not exceed/,
			`mipLevelCount ${mipLevelCount}`,
		);
	}
	assert.throws(
		() => new FrameGraph(mockDevice()).beginFrame().createTexture({
			label: 'too-many-mips',
			format: 'rgba8unorm',
			size: [8, 8],
			mipLevelCount: 5,
		}),
		/mipLevelCount must not exceed 4/,
	);
	for (const sampleCount of [0, 2, ...invalidUint32Values] as const) {
		assert.throws(
			() => new FrameGraph(mockDevice()).beginFrame().createTexture({
				label: 'invalid-samples',
				format: 'rgba8unorm',
				size: [1, 1],
				sampleCount,
			}),
			/sampleCount must be either 1 or 4|sampleCount must be a positive uint32 integer/,
			`sampleCount ${sampleCount}`,
		);
	}
	assert.doesNotThrow(() => new FrameGraph(mockDevice()).beginFrame().createTexture({
		label: 'valid-boundaries',
		format: 'rgba8unorm',
		size: [8, 8],
		mipLevelCount: 4,
		sampleCount: 4,
	}));
	assert.doesNotThrow(() => new FrameGraph(mockDevice()).beginFrame().createTexture({
		label: 'valid-1d-mips',
		format: 'rgba8unorm',
		dimension: '1d',
		size: [8],
		mipLevelCount: 4,
	}));

	const invalidImportedTexture = texture('invalid-import', textureUsage.COPY_SRC, { width: Number.NaN });
	assert.throws(
		() => new FrameGraph(mockDevice()).beginFrame().importTexture(invalidImportedTexture),
		/Texture descriptor "invalid-import" size\.width must be a positive uint32 integer/,
	);
	assert.throws(
		() => new FrameGraph(mockDevice()).beginFrame().importSwapchainTexture(invalidImportedTexture),
		/Texture descriptor "invalid-import" size\.width must be a positive uint32 integer/,
	);
});

test('texture descriptors materialize one-shot extents once and apply WebGPU extent defaults', () => {
	let sizeIterations = 0;
	function* size(): Generator<number> {
		sizeIterations++;
		yield 4;
		yield 2;
	}
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({
		label: 'iterable-size',
		format: 'rgba8unorm',
		size: size(),
	});
	assert.equal(sizeIterations, 1);
	assert.deepEqual(Array.from(graph.getTextureDesc(color).size as Iterable<number>), [4, 2]);
	graph.render({
		label: 'write',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	const compiled = graph.compile();
	assert.doesNotThrow(() => compiled.execute());
	assert.equal(sizeIterations, 1);

	const typed = new FrameGraph(mockDevice()).beginFrame();
	const typedColor = typed.createTexture({
		label: 'typed-array-size',
		format: 'rgba8unorm',
		size: new Uint32Array([8, 4, 2]),
	});
	assert.deepEqual(Array.from(typed.getTextureDesc(typedColor).size as Iterable<number>), [8, 4, 2]);

	const defaulted = new FrameGraph(mockDevice()).beginFrame().createTexture({
		label: 'defaulted-size',
		format: 'rgba8unorm',
		size: { width: 4 },
	});
	assert.ok(defaulted);

	for (const values of [[], [1, 1, 1, 1]] as const) {
		assert.throws(
			() => new FrameGraph(mockDevice()).beginFrame().createTexture({
				label: 'invalid-shape',
				format: 'rgba8unorm',
				size: values as unknown as TextureSize,
			}),
			/size iterable must contain between 1 and 3 values/,
		);
	}
});

test('render snapshots exactly four iterable color components', () => {
	for (const length of [3, 5]) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({
			label: `invalid-color-${length}`,
			format: 'rgba8unorm',
			size: [1, 1],
		});
		assert.throws(
			() => graph.render({
				label: `invalid-clear-${length}`,
				colorAttachments: [{
					target: color,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: Array.from({ length }, (_, index) => index),
				}],
			}),
			new RegExp(`Render node "invalid-clear-${length}" color attachment 0 clearValue iterable must contain exactly 4 values\\. Received ${length}\\.`),
		);
	}

	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'valid-color', format: 'rgba8unorm', size: [1, 1] });
	function* clearValue(): Generator<number> {
		yield 0;
		yield 0.25;
		yield 0.5;
		yield 1;
	}
	assert.doesNotThrow(() => graph.render({
		label: 'valid-clear',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store', clearValue: clearValue() as unknown as GPUColor }],
	}));
	assert.doesNotThrow(() => graph.compile());
});

test('compile rejects invalid buffer access and clear ranges before dependency analysis', () => {
	for (const value of invalidSafeIntegers) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const target = graph.importBuffer(buffer('target', bufferUsage.STORAGE), { label: 'target', exposedSize: 64, exposedUsage: bufferUsage.STORAGE });
		graph.command({
			label: 'invalid-access',
			sideEffect: true,
			uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: value, size: 4 } })],
		});
		assert.throws(
			() => graph.compile(),
			/Buffer access range for "target" offset must be a non-negative safe integer/,
			String(value),
		);

		const sizeGraph = new FrameGraph(mockDevice()).beginFrame();
		const sizeTarget = sizeGraph.importBuffer(buffer('size-target', bufferUsage.STORAGE), { label: 'size-target', exposedSize: 64, exposedUsage: bufferUsage.STORAGE });
		sizeGraph.command({
			label: 'invalid-access-size',
			sideEffect: true,
			uses: [sizeGraph.use(sizeTarget, BufferAccess.StorageRead, { range: { offset: 0, size: value } })],
		});
		assert.throws(
			() => sizeGraph.compile(),
			/Buffer access range for "size-target" size must be a non-negative safe integer/,
			String(value),
		);
	}

	const clear = new FrameGraph(mockDevice()).beginFrame();
	const clearTarget = clear.importBuffer(buffer('clear-target', bufferUsage.COPY_DST), { label: 'clear-target', exposedSize: 64, exposedUsage: bufferUsage.COPY_DST });
	clear.clearBuffer({
		sideEffect: true,
		operations: [{ target: clearTarget, offset: 0, size: Number.NaN }],
	});
	assert.throws(() => clear.compile(), /Buffer clear range for "clear-target" size must be a non-negative safe integer/);
});

test('compile preserves zero-length buffer ranges, copies, and clears', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const usage = bufferUsage.STORAGE | bufferUsage.COPY_SRC | bufferUsage.COPY_DST;
	const source = graph.importBuffer(buffer('source', usage), { label: 'source', exposedSize: 64, exposedUsage: usage });
	const destination = graph.importBuffer(buffer('destination', usage), { label: 'destination', exposedSize: 64, exposedUsage: usage });
	graph.command({
		sideEffect: true,
		uses: [graph.use(source, BufferAccess.StorageRead, { range: { offset: 64, size: 0 } })],
	});
	graph.copy({
		sideEffect: true,
		operations: [{
			type: 'buffer-to-buffer',
			source,
			destination,
			sourceOffset: 64,
			destinationOffset: 64,
			size: 0,
		}],
	});
	graph.clearBuffer({
		sideEffect: true,
		operations: [{ target: destination, offset: 64, size: 0 }],
	});
	assert.doesNotThrow(() => graph.compile());
});

test('compile explicitly rejects invalid texture copy coordinates and layout values', () => {
	const invalidOperations: readonly CopyOperation[] = [
		{
			type: 'texture-to-texture',
			source: undefined as never,
			destination: undefined as never,
			sourceMipLevel: Number.NaN,
			copySize: [1, 1],
		},
		{
			type: 'texture-to-texture',
			source: undefined as never,
			destination: undefined as never,
			sourceOrigin: [Number.POSITIVE_INFINITY, 0, 0],
			copySize: [1, 1],
		},
		{
			type: 'texture-to-texture',
			source: undefined as never,
			destination: undefined as never,
			copySize: [1.5, 1],
		},
	];
	for (const template of invalidOperations) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [1, 1] }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
		const destination = graph.importTexture(texture('destination', textureUsage.COPY_DST, { format: 'rgba8unorm', size: [1, 1] }), { label: 'destination', exposedUsage: textureUsage.COPY_DST });
		graph.copy({
			sideEffect: true,
			operations: [{ ...template, source, destination } as CopyOperation],
		});
		assert.throws(
			() => graph.compile(),
			/must be a non-negative uint32 integer|must be a positive uint32 integer/,
		);
	}

	const layoutGraph = new FrameGraph(mockDevice()).beginFrame();
	const sourceBuffer = layoutGraph.importBuffer(buffer('upload', bufferUsage.COPY_SRC), { label: 'upload', exposedSize: 1024, exposedUsage: bufferUsage.COPY_SRC });
	const destinationTexture = layoutGraph.createTexture({
		label: 'array',
		format: 'rgba8unorm',
		size: [1, 1, 2],
	});
	layoutGraph.copy({
		sideEffect: true,
		operations: [{
			type: 'buffer-to-texture',
			source: sourceBuffer,
			destination: destinationTexture,
			sourceLayout: { bytesPerRow: 256, rowsPerImage: Number.NaN },
			copySize: [1, 1, 2],
		}],
	});
	assert.throws(() => layoutGraph.compile(), /rowsPerImage must be a non-negative uint32 integer/);

	const bufferCopyGraph = new FrameGraph(mockDevice()).beginFrame();
	const bufferCopySource = bufferCopyGraph.importBuffer(buffer('copy-source', bufferUsage.COPY_SRC), { label: 'copy-source', exposedSize: 1024, exposedUsage: bufferUsage.COPY_SRC });
	const bufferCopyDestination = bufferCopyGraph.importBuffer(buffer('copy-destination', bufferUsage.COPY_DST), { label: 'copy-destination', exposedSize: 1024, exposedUsage: bufferUsage.COPY_DST });
	bufferCopyGraph.copy({
		label: 'invalid-buffer-copy',
		sideEffect: true,
		operations: [{
			type: 'buffer-to-buffer',
			source: bufferCopySource,
			destination: bufferCopyDestination,
			size: Number.NaN,
		}],
	});
	assert.throws(
		() => bufferCopyGraph.compile(),
		/Copy node "invalid-buffer-copy" source buffer "copy-source" size must be a non-negative safe integer/,
	);

	const downloadGraph = new FrameGraph(mockDevice()).beginFrame();
	const downloadSource = downloadGraph.importTexture(texture('download-source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [1, 1] }), { label: 'download-source', exposedUsage: textureUsage.COPY_SRC });
	const downloadDestination = downloadGraph.importBuffer(buffer('download-destination', bufferUsage.COPY_DST), { label: 'download-destination', exposedSize: 1024, exposedUsage: bufferUsage.COPY_DST });
	downloadGraph.copy({
		label: 'invalid-texture-to-buffer',
		sideEffect: true,
		operations: [{
			type: 'texture-to-buffer',
			source: downloadSource,
			destination: downloadDestination,
			destinationLayout: { offset: Number.POSITIVE_INFINITY },
			copySize: [1, 1],
		}],
	});
	assert.throws(
		() => downloadGraph.compile(),
		/Copy node "invalid-texture-to-buffer" buffer-texture layout for buffer "download-destination" offset must be a non-negative safe integer/,
	);
});

test('copy operations materialize one-shot extents and origins before compilation', () => {
	let extentIterations = 0;
	let originIterations = 0;
	function* extent(): Generator<number> {
		extentIterations++;
		yield 1;
		yield 1;
	}
	function* origin(): Generator<number> {
		originIterations++;
		yield 0;
		yield 0;
	}
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [1, 1] }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
	const destination = graph.importTexture(texture('destination', textureUsage.COPY_DST, { format: 'rgba8unorm', size: [1, 1] }), { label: 'destination', exposedUsage: textureUsage.COPY_DST });
	graph.copy({
		sideEffect: true,
		operations: [{
			type: 'texture-to-texture',
			source,
			destination,
			sourceOrigin: origin(),
			destinationOrigin: origin(),
			copySize: extent(),
		}],
	});
	assert.equal(extentIterations, 1);
	assert.equal(originIterations, 2);
	assert.throws(
		() => graph.copy({
			operations: [{
				type: 'texture-to-texture',
				source,
				destination,
				sourceOrigin: [0, 0, 0, 0],
				copySize: [1, 1],
			}],
		}),
		/sourceOrigin iterable must contain between 1 and 3 values/,
	);
	assert.throws(
		() => graph.copy({
			operations: [{
				type: 'texture-to-texture',
				source,
				destination,
				sourceOrigin: [],
				copySize: [1, 1],
			}],
		}),
		/sourceOrigin iterable must contain between 1 and 3 values/,
	);
	for (const copySize of [[], [1, 1, 1, 1]] as const) {
		assert.throws(
			() => graph.copy({
				operations: [{
					type: 'texture-to-texture',
					source,
					destination,
					copySize,
				}],
			}),
			/copySize iterable must contain between 1 and 3 values/,
		);
	}
	const compiled = graph.compile();
	assert.doesNotThrow(() => compiled.execute());
	assert.equal(extentIterations, 1);
	assert.equal(originIterations, 2);
});

test('texture view ranges reject non-finite and fractional values during compile', () => {
	for (const baseMipLevel of [Number.NaN, Number.POSITIVE_INFINITY, 0.5] as const) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const textureHandle = graph.createTexture({
			label: 'mips',
			format: 'rgba8unorm',
			size: [4, 4],
			mipLevelCount: 3,
		});
		const view = graph.createTextureView(textureHandle, {
			baseMipLevel,
			mipLevelCount: 1,
		});
		graph.command({
			sideEffect: true,
			uses: [graph.use(view, TextureAccess.Sampled)],
		});
		assert.throws(
			() => graph.compile(),
			/Texture view range for "mips" baseMipLevel must be a non-negative uint32 integer/,
		);
	}
});

test('buffer allocation bucketing rejects invalid and unsafe results', () => {
	assert.equal(bufferAllocationSize(0), 1);
	assert.equal(bufferAllocationSize(3), 4);
	for (const size of invalidSafeIntegers) {
		assert.throws(() => bufferAllocationSize(size), /must be a non-negative safe integer/);
	}
	assert.throws(
		() => bufferAllocationSize(Number.MAX_SAFE_INTEGER),
		/rounds to an unsafe allocation bucket/,
	);
});
