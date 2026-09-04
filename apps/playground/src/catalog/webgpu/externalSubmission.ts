import type { ExternalRenderer } from '../../../../../packages/webgpu/examples/external-submission.ts';
import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile, recipeShaderSourceFile } from './sources.ts';

export const externalSubmissionExample: PlaygroundExampleDefinition = {
	id: 'external-submission',
	title: 'External Submission',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · External queue submission · 2 segments',
	readyMessage: 'Ready · external submission ordered before present',
	footerHint: 'Inspector shows the caller-owned submission boundary',
	sourceFiles: [
		{
			id: 'external-submission-recipe',
			label: 'Recipe · external-submission.ts',
			path: 'packages/webgpu/examples/external-submission.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/external-submission.ts?raw')).default,
		},
		{
			id: 'external-submission-adapter',
			label: 'Host · externalSubmission.ts',
			path: 'apps/playground/src/catalog/webgpu/externalSubmission.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./externalSubmission.ts?raw')).default,
		},
		recipeHostSourceFile,
		recipeShaderSourceFile,
	],
	async mount(context) {
		const [recipe, hostTools, shaders] = await Promise.all([
			import('../../../../../packages/webgpu/examples/external-submission.ts'),
			import('./recipeHost.ts'),
			import('./recipeShaders.ts'),
		]);
		const { createRenderPipeline, createWebGpuRecipeHost } = hostTools;
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const externalPipeline = createRenderPipeline(host.device, 'rgba8unorm', shaders.colorShader, 'externalFragment');
		const presentPipeline = createRenderPipeline(host.device, host.format, shaders.presentShader, 'fragmentMain');
		const sampler = host.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const renderAndSubmit: ExternalRenderer = ({ device, color }) => {
			const encoder = device.createCommandEncoder({ label: 'playground-external-renderer' });
			const pass = encoder.beginRenderPass({
				colorAttachments: [{
					view: color,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0.08, g: 0.03, b: 0.01, a: 1 },
				}],
			});
			pass.setPipeline(externalPipeline);
			pass.draw(3);
			pass.end();
			device.queue.submit([encoder.finish()]);
			return undefined;
		};
		const stopResize = host.renderOnResize((size) => {
			recipe.renderExternalSubmission({
				graph: host.graph,
				context: host.context,
				presentPipeline,
				sampler,
				...size,
				frameIndex: host.nextFrameIndex(),
				renderAndSubmit,
			});
			context.onReady();
		});
		return {
			captureSnapshot: () => host.capture((recorder) => {
				const size = host.size();
				recipe.recordExternalSubmission({
					recorder,
					backbufferTexture: host.context.getCurrentTexture(),
					presentPipeline,
					sampler,
					...size,
					renderAndSubmit,
				});
			}),
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
