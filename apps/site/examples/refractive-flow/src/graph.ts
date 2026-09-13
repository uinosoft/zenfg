import { BufferAccess, TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import { curveCount, curveSamples, curveSegments, sampleBytes, filamentsPerCurve, sheetLayers, sheetSegments } from './curves.ts';
import type { SurfaceResources } from './resources.ts';

/** Spring state -> optical MRT -> bloom pyramid -> reconstruction -> presentation. */
export function recordSurface(recorder: FrameGraphRecording, resources: SurfaceResources, size: { width: number; height: number }) {
	const { pipelines, uniformBuffer, linearSampler, context } = resources;
	const rest = recorder.importBuffer(resources.restBuffer, { label: 'authored curve frames', initialContents: 'defined' });
	const springs = recorder.importBuffer(resources.motionBuffer, { label: 'persistent ribbon springs', initialContents: 'defined' });
	const vertices = recorder.createBuffer({ label: 'deformed curve frames', size: curveCount * curveSamples * sampleBytes });
	const restRead = recorder.use(rest, BufferAccess.StorageRead);
	const stateRead = recorder.use(springs, BufferAccess.StorageRead);
	const stateUpdate = recorder.use(springs, BufferAccess.StorageWrite, { contents: 'overwrite' });
	const vertexWrite = recorder.use(vertices, BufferAccess.StorageWrite, { contents: 'overwrite' });
	recorder.compute({
		label: '01 · curl & damped springs', uses: [restRead, stateRead, stateUpdate, vertexWrite], encode({ device, pass, unwrap }) {
			pass.setPipeline(pipelines.update);
			pass.setBindGroup(0, device.createBindGroup({
				layout: pipelines.update.getBindGroupLayout(0), entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: unwrap(restRead) } },
					{ binding: 2, resource: { buffer: unwrap(stateUpdate) } }, { binding: 3, resource: { buffer: unwrap(vertexWrite) } },
				]
			}));
			pass.dispatchWorkgroups(Math.ceil(curveCount * curveSamples / 64));
		}
	});
	recorder.markPersistentState(springs);
	const texture = (label: string, divisor = 1) => recorder.createTexture({ label, format: 'rgba16float', size: [Math.max(1, Math.ceil(size.width / divisor)), Math.max(1, Math.ceil(size.height / divisor))] });
	const accumulation = texture('weighted optical color');
	const revealage = texture('optical transmittance');
	const emission = texture('HDR optical highlights');
	const vertexRead = recorder.use(vertices, BufferAccess.StorageRead);
	recorder.render({
		label: '02 · refractive ribbons & filaments', uses: [vertexRead], colorAttachments: [
			{ target: accumulation, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
			{ target: revealage, loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 1, b: 1, a: 1 } },
			{ target: emission, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
		], encode({ device, pass, unwrap }) {
			for (const [pipeline, vertexCount, instances] of [
				[pipelines.ribbon, curveSegments * sheetSegments * 6, curveCount * sheetLayers], [pipelines.filament, curveSegments * 6, curveCount * filamentsPerCurve],
			] as const) {
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0), entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: unwrap(vertexRead) } },
					]
				}));
				pass.draw(vertexCount, instances);
			}
		}
	});
	const pyramid = [texture('bloom · 1/2', 2), texture('bloom · 1/4', 4), texture('bloom · 1/8', 8)];
	for (let level = 0; level < 3; level++) {
		const input = recorder.use(level ? pyramid[level - 1]! : emission, TextureAccess.Sampled);
		const pipeline = level ? pipelines.down : pipelines.extract;
		recorder.render({
			label: `${level + 3} · ${level ? 'downsample bloom' : 'extract highlights'} 1/${2 ** (level + 1)}`, uses: [input],
			colorAttachments: [{ target: pyramid[level]!, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
			encode({ device, pass, unwrap }) {
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, device.createBindGroup({
layout: pipeline.getBindGroupLayout(0), entries: [
						{ binding: 0, resource: linearSampler }, { binding: 1, resource: unwrap(input) },
					]
})); pass.draw(3);
			},
		});
	}
	let reconstructed = pyramid[2]!;
	for (let level = 1; level >= 0; level--) {
		const low = recorder.use(reconstructed, TextureAccess.Sampled);
		const high = recorder.use(pyramid[level]!, TextureAccess.Sampled);
		const target = texture(`bloom reconstruction · 1/${2 ** (level + 1)}`, 2 ** (level + 1));
		recorder.render({
label: `${7 - level} · reconstruct bloom 1/${2 ** (level + 1)}`, uses: [low, high],
			colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }], encode({ device, pass, unwrap }) {
				pass.setPipeline(pipelines.up);
				pass.setBindGroup(0, device.createBindGroup({
layout: pipelines.up.getBindGroupLayout(0), entries: [
						{ binding: 0, resource: linearSampler }, { binding: 1, resource: unwrap(low) }, { binding: 2, resource: unwrap(high) },
					]
})); pass.draw(3);
			},
		});
		reconstructed = target;
	}
	const inputs = [accumulation, revealage, emission, reconstructed].map(t => recorder.use(t, TextureAccess.Sampled));
	const backbuffer = recorder.importSwapchainTexture(context.getCurrentTexture(), { label: 'refractive cover backbuffer' });
	recorder.render({
label: '08 · tone & bounded cover composite', uses: inputs,
		colorAttachments: [{ target: backbuffer, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }], encode({ device, pass, unwrap }) {
			pass.setPipeline(pipelines.composite);
			pass.setBindGroup(0, device.createBindGroup({
layout: pipelines.composite.getBindGroupLayout(0), entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } }, ...inputs.map((input, i) => ({ binding: i + 1, resource: unwrap(input) })), { binding: 5, resource: linearSampler },
				]
})); pass.draw(3);
		},
	});
	return backbuffer;
}
