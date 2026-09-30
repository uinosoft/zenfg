import { FrameGraph } from '@zenfg/webgpu';

interface GpuAcceptanceResult {
	readonly ok: boolean;
	readonly passed: readonly string[];
	readonly error?: string;
}

declare global {
	var __zenfgRuntimeGpuResult: GpuAcceptanceResult | undefined;
}

function check(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function readBytes(buffer: GPUBuffer): Promise<Uint8Array> {
	await buffer.mapAsync(GPUMapMode.READ);
	const bytes = new Uint8Array(buffer.getMappedRange().slice(0));
	buffer.unmap();
	return bytes;
}

async function run(): Promise<GpuAcceptanceResult> {
	const passed: string[] = [];
	const buffers: GPUBuffer[] = [];
	let device: GPUDevice | undefined;
	let graph: FrameGraph | undefined;
	let texture: GPUTexture | undefined;
	try {
		const adapter = await navigator.gpu?.requestAdapter();
		check(!!adapter, 'A WebGPU adapter is required.');
		check(adapter.features.has('timestamp-query'), 'timestamp-query is required to verify timing overflow.');
		device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
		const errors: string[] = [];
		device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
		graph = new FrameGraph(device);
		const staging = (size: number): GPUBuffer => {
			const buffer = device!.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			buffers.push(buffer);
			device!.queue.writeBuffer(buffer, 0, new Uint8Array(size).fill(127));
			return buffer;
		};
		const finishCase = async (label: string): Promise<void> => {
			const error = await device!.popErrorScope();
			check(!error, `${label}: ${error?.message}`);
			check(errors.length === 0, errors.join('\n'));
			passed.push(label);
		};

		device.pushErrorScope('validation');
		const nativeClear = staging(128);
		const clearFrame = graph.beginFrame();
		const clearTarget = clearFrame.importBuffer(nativeClear, { exposedSize: 64 });
		clearFrame.clearBuffer({ label: 'clear-logical-range', operations: [{ target: clearTarget }] });
		clearFrame.markReadback(clearTarget);
		clearFrame.compile().execute();
		const clearBytes = await readBytes(nativeClear);
		check(clearBytes.slice(0, 64).every((byte) => byte === 0), 'Logical range was not cleared.');
		check(clearBytes.slice(64).every((byte) => byte === 127), 'Clear changed bytes outside the logical range.');
		await finishCase('clear logical boundary');

		device.pushErrorScope('validation');
		texture = device.createTexture({ size: [1, 2], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { bytesPerRow: 4 }, [1, 2]);
		const nativePadding = staging(260);
		const paddingFrame = graph.beginFrame();
		const source = paddingFrame.importTexture(texture);
		const destination = paddingFrame.importBuffer(nativePadding, { initialContents: 'undefined' });
		paddingFrame.clearBuffer({ label: 'initialize-padding', operations: [{ target: destination }] });
		paddingFrame.copy({ label: 'read-texture', operations: [{ type: 'texture-to-buffer', source, destination, destinationLayout: { bytesPerRow: 256 }, copySize: [1, 2] }] });
		paddingFrame.markReadback(destination);
		const paddingCompiled = paddingFrame.compile({ report: true });
		check(paddingCompiled.compilationReport.nodes.some((node) => node.label === 'initialize-padding'), 'Padding initialization was culled.');
		paddingCompiled.execute();
		const paddingBytes = await readBytes(nativePadding);
		check(paddingBytes.slice(0, 4).every((byte, index) => byte === index + 1), 'First row differs.');
		check(paddingBytes.slice(256).every((byte, index) => byte === index + 5), 'Second row differs.');
		check(paddingBytes.slice(4, 256).every((byte) => byte === 0), 'Copy padding was not initialized.');
		await finishCase('texture copy preserves initialized padding');

		device.pushErrorScope('validation');
		const nativeTiming = staging(4);
		const timingFrame = graph.beginFrame();
		const timingTarget = timingFrame.importBuffer(nativeTiming);
		timingFrame.clearBuffer({ operations: [{ target: timingTarget }] });
		for (let index = 0; index < 2049; index++) timingFrame.compute({ label: `timed-${index}`, sideEffect: true });
		timingFrame.markReadback(timingTarget);
		const timing = timingFrame.compile().executeWithTiming({ timing: 'both' });
		const gpu = await timing.gpu!;
		check(gpu.status === 'unavailable' && gpu.reason === 'too-many-timed-nodes', 'Timing overflow did not return its unavailable reason.');
		check(timing.cpu?.nodes.length === 2050, 'Overflow lost CPU timing samples.');
		check((await readBytes(nativeTiming)).every((byte) => byte === 0), 'Overflow prevented graph submission.');
		const small = graph.beginFrame();
		small.compute({ label: 'small', sideEffect: true });
		check((await small.compile().executeWithTiming({ timing: 'gpu' }).gpu!).status === 'available', 'Small graph timing failed after overflow.');
		await finishCase('timing overflow executes and permits subsequent timing');
		return { ok: true, passed };
	} catch (error) {
		return { ok: false, passed, error: error instanceof Error ? error.stack ?? error.message : String(error) };
	} finally {
		graph?.destroy();
		for (const buffer of buffers) buffer.destroy();
		texture?.destroy();
		device?.destroy();
	}
}

globalThis.__zenfgRuntimeGpuResult = await run();
document.querySelector('#result')!.textContent = JSON.stringify(globalThis.__zenfgRuntimeGpuResult, null, 2);
