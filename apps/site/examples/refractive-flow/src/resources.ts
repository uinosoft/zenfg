import { FrameGraph } from '@zenfg/webgpu';
import { createRestCurves, curveCount, curveSamples, stateBytes } from './curves.ts';
import { updateShader, ribbonShader, bloomShader, compositeShader } from './shaders.ts';

export const frameParamsFloatCount = 36;
export type SurfaceResources = {
	device: GPUDevice; context: GPUCanvasContext; format: GPUTextureFormat; graph: FrameGraph;
	uniformBuffer: GPUBuffer; restBuffer: GPUBuffer; motionBuffer: GPUBuffer; linearSampler: GPUSampler;
	pipelines: {
		update: GPUComputePipeline; ribbon: GPURenderPipeline; filament: GPURenderPipeline;
		extract: GPURenderPipeline; down: GPURenderPipeline; up: GPURenderPipeline; composite: GPURenderPipeline
	};
};

export async function createSurfaceResources(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat): Promise<SurfaceResources> {
	const module = (label: string, code: string) => device.createShaderModule({ label, code });
	const updateModule = module('refractive flow · spring and curl', updateShader);
	const ribbonModule = module('refractive flow · optical ribbons', ribbonShader);
	const bloomModule = module('refractive flow · multiscale bloom', bloomShader);
	const compositeModule = module('refractive flow · final composite', compositeShader);
	const additive: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
	const reveal: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' } };
	const geometry = (entry: string) => device.createRenderPipelineAsync({
		label: `refractive flow · ${entry}`, layout: 'auto',
		vertex: { module: ribbonModule, entryPoint: entry },
		fragment: {
			module: ribbonModule, entryPoint: 'material_fragment', targets: [
				{ format: 'rgba16float', blend: additive }, { format: 'rgba16float', blend: reveal }, { format: 'rgba16float', blend: additive },
			]
		}, primitive: { topology: 'triangle-list', cullMode: 'none' },
	});
	const post = (shader: GPUShaderModule, entry: string, target: GPUTextureFormat = 'rgba16float') => device.createRenderPipelineAsync({
		label: `refractive flow · ${entry}`, layout: 'auto', vertex: { module: shader, entryPoint: 'fullscreen_vertex' },
		fragment: { module: shader, entryPoint: entry, targets: [{ format: target }] }, primitive: { topology: 'triangle-list' },
	});
	const [update, ribbon, filament, extract, down, up, composite] = await Promise.all([
		device.createComputePipelineAsync({ label: 'refractive flow · update curves', layout: 'auto', compute: { module: updateModule, entryPoint: 'update_curves' } }),
		geometry('ribbon_vertex'), geometry('filament_vertex'), post(bloomModule, 'bloom_extract'), post(bloomModule, 'bloom_down'), post(bloomModule, 'bloom_up'), post(compositeModule, 'composite_fragment', format),
	]);
	const uniformBuffer = device.createBuffer({ label: 'refractive frame params', size: frameParamsFloatCount * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const data = createRestCurves();
	const restBuffer = device.createBuffer({ label: 'authored curve frames', size: data.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
	new Float32Array(restBuffer.getMappedRange()).set(data); restBuffer.unmap();
	const motionBuffer = device.createBuffer({ label: 'persistent ribbon springs', size: curveSamples * curveCount * stateBytes, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
	new Uint8Array(motionBuffer.getMappedRange()).fill(0); motionBuffer.unmap();
	const linearSampler = device.createSampler({ label: 'refractive linear clamp', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' });
	return {
		device, context, format, graph: new FrameGraph(device), uniformBuffer, restBuffer, motionBuffer, linearSampler,
		pipelines: { update, ribbon, filament, extract, down, up, composite }
	};
}
