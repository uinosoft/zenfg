import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile } from './sources.ts';

export const snapshotExportExample: PlaygroundExampleDefinition = {
	id: 'snapshot-export',
	title: 'Snapshot Export',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Diagnostics · Snapshot 1.0',
	readyMessage: 'Ready · Snapshot 1.0 captured',
	footerHint: 'Inspector parses the JSON produced by the package recipe',
	sourceFiles: [
		{
			id: 'snapshot-export-recipe',
			label: 'Recipe · snapshot-export.ts',
			path: 'packages/webgpu/examples/snapshot-export.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/snapshot-export.ts?raw')).default,
		},
		{
			id: 'snapshot-export-adapter',
			label: 'Host · snapshotExport.ts',
			path: 'apps/playground/src/catalog/webgpu/snapshotExport.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./snapshotExport.ts?raw')).default,
		},
		recipeHostSourceFile,
	],
	async mount(context) {
		const [recipe, { createWebGpuRecipeHost }, { parseFrameGraphSnapshot }] = await Promise.all([
			import('../../../../../packages/webgpu/examples/snapshot-export.ts'),
			import('./recipeHost.ts'),
			import('@zenfg/snapshot'),
		]);
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		let captureTail: Promise<void> = Promise.resolve();
		const capture = (): Promise<FrameGraphSnapshot> => {
			const result = captureTail.then(async () => {
				const json = await recipe.captureSnapshotJson({
					graph: host.graph,
					context: host.context,
					frameIndex: host.nextFrameIndex(),
					producerVersion: '0.1.0-beta.2',
				});
				const parsed = parseFrameGraphSnapshot(json);
				if (!parsed.ok) {
					throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
				}
				return parsed.snapshot;
			});
			captureTail = result.then(() => undefined, () => undefined);
			return result;
		};
		const stopResize = host.renderOnResize(async () => {
			await capture();
			context.onReady();
		});
		return {
			captureSnapshot: capture,
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
