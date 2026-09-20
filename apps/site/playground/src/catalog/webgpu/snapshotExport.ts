import type { FrameGraphCaptureRequest } from '@zenfg/inspector';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import type { ExamplesExampleDefinition } from '../../types.ts';
import { createIcon } from '../../icons.ts';
import { recipeHostSourceFile } from './sources.ts';

export const snapshotExportExample: ExamplesExampleDefinition = {
	id: 'snapshot-export',
	title: 'Snapshot Export',
	group: '@zenfg/webgpu basics',
	tags: ['webgpu', 'snapshot', 'diagnostics'],
	readyState: 'ready',
	description: "Export a portable FrameGraph Snapshot as JSON. The downloaded capture includes graph structure, timing, and memory diagnostics for offline inspection.",
	references: [{ relation: 'Reference', label: 'Hosted Inspector', href: 'https://uinosoft.github.io/zenfg/inspector/' }],
	entrySourceId: 'snapshot-export-recipe',
	sourceFiles: [
		{
			id: 'snapshot-export-recipe',
			label: 'Recipe · snapshot-export.ts',
			path: 'packages/webgpu/examples/snapshot-export.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../../packages/webgpu/examples/snapshot-export.ts?raw')).default,
		},
		{
			id: 'snapshot-export-adapter',
			label: 'Host · snapshotExport.ts',
			path: 'apps/site/playground/src/catalog/webgpu/snapshotExport.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./snapshotExport.ts?raw')).default,
		},
		recipeHostSourceFile,
	],
	async mount(context) {
		const [recipe, { createWebGpuRecipeHost }, { parseFrameGraphSnapshot }] = await Promise.all([
			import('../../../../../../packages/webgpu/examples/snapshot-export.ts'),
			import('./recipeHost.ts'),
			import('@zenfg/snapshot'),
		]);
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		let captureTail: Promise<void> = Promise.resolve();
		let disposed = false;
		let downloading = false;
		const captureJson = (request: FrameGraphCaptureRequest = { timing: 'both' }): Promise<string> => {
			const timing = request.timing;
			const result = captureTail.then(() => {
				if (disposed) throw new Error('Snapshot Export has been disposed.');
				return recipe.captureSnapshotJson({
					graph: host.graph,
					timing,
					context: host.context,
					frameIndex: host.nextFrameIndex(),
				});
			});
			captureTail = result.then(() => undefined, () => undefined);
			return result;
		};
		const parseSnapshot = (json: string): FrameGraphSnapshot => {
			const parsed = parseFrameGraphSnapshot(json);
			if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
			return parsed.snapshot;
		};
		const capture = async (request: FrameGraphCaptureRequest = { timing: 'both' }): Promise<FrameGraphSnapshot> => {
			return parseSnapshot(await captureJson(request));
		};
		const download = document.createElement('button');
		download.type = 'button';
		download.className = 'shell-button snapshot-download-action';
		setDownloadButtonState(download, false);
		context.actionsHost?.append(download);
		download.addEventListener('click', () => {
			if (disposed || downloading) return;
			downloading = true;
			download.disabled = true;
			setDownloadButtonState(download, true);
			void captureJson().then((json) => {
				if (disposed) return;
				const snapshot = parseSnapshot(json);
				const filename = `frame-graph-${snapshot.capture.frameIndex}.fgsnapshot.json`;
				downloadSnapshotJson(json, filename);
				context.onReady(`Downloaded ${filename}`);
			}).catch((error) => {
				if (!disposed) context.onError(toError(error));
			}).finally(() => {
				downloading = false;
				if (!disposed) {
					download.disabled = false;
					setDownloadButtonState(download, false);
				}
			});
		});
		const stopResize = host.renderOnResize(async () => {
			try {
				await capture();
				if (!disposed) context.onReady();
			}
			catch (error) {
				if (!disposed) throw error;
			}
		});
		return {
			captureSnapshot: capture,
			dispose() {
				if (disposed) return;
				disposed = true;
				stopResize();
				download.remove();
				host.dispose();
			},
		};
	},
};

function setDownloadButtonState(button: HTMLButtonElement, capturing: boolean): void {
	const label = capturing ? 'Capturing...' : 'Download Snapshot';
	const text = document.createElement('span');
	text.textContent = label;
	button.title = label;
	button.replaceChildren(createIcon(document, capturing ? 'loading' : 'download'), text);
}

export function downloadSnapshotJson(json: string, filename: string): void {
	const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
