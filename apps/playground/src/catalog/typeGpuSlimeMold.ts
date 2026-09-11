import type { SlimeMoldSettings } from '@zenfg-example/typegpu-slime-mold';
import type { PlaygroundExampleDefinition } from '../types.ts';

type TweakpaneControl = {
	addBinding(
		object: object,
		key: string,
		options: { readonly label: string; readonly min: number; readonly max: number; readonly step: number },
	): { on(event: 'change', handler: (event: { readonly value: number }) => void): void };
	dispose(): void;
};

export const typeGpuSlimeMoldExample: PlaygroundExampleDefinition = {
	id: 'typegpu-slime-mold',
	title: 'TypeGPU · Slime Mold',
	group: 'Showcases',
	tags: ['typegpu', 'compute', 'simulation'],
	readyState: 'live',
	references: [{ relation: 'Adapted from', label: "TypeGPU · Slime Mold", href: "https://github.com/software-mansion/TypeGPU/blob/8d923c9f7a170a2bfad15c2de7e3df3914d36f30/apps/typegpu-docs/src/examples/simulation/slime-mold/index.ts" }],
    description: "Simulate agents that form evolving trails using TypeGPU compute and render pipelines. Inspect how persistent agent and trail resources connect work across frames. Tune the five simulation parameters.",
	hasControls: true,
	entrySourceId: 'typegpu-slime-mold-entry',
	sourceFiles: [
		{
			id: 'typegpu-slime-mold-entry', label: 'main.ts', role: 'example', language: 'typescript',
			path: 'examples/typegpu-slime-mold/src/main.ts',
			loadSource: async () => (await import('../../../../examples/typegpu-slime-mold/src/main.ts?raw')).default,
		},
		{
			id: 'typegpu-slime-mold',
			label: 'slimeMold.ts',
			path: 'examples/typegpu-slime-mold/src/slimeMold.ts',
			role: 'example',
			language: 'typescript',
			loadSource: async () => (await import('../../../../examples/typegpu-slime-mold/src/slimeMold.ts?raw')).default,
		},
		{
			id: 'typegpu-slime-mold-types', label: 'types.ts', role: 'example', language: 'typescript',
			path: 'examples/typegpu-slime-mold/src/types.ts',
			loadSource: async () => (await import('../../../../examples/typegpu-slime-mold/src/types.ts?raw')).default,
		},
		{
			id: 'typegpu-slime-mold-host',
			label: 'host.ts',
			path: 'examples/typegpu-slime-mold/src/host.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('../../../../examples/typegpu-slime-mold/src/host.ts?raw')).default,
		},
		{
			id: 'typegpu-slime-mold-adapter',
			label: 'typeGpuSlimeMold.ts',
			path: 'apps/playground/src/catalog/typeGpuSlimeMold.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./typeGpuSlimeMold.ts?raw')).default,
		},
	],
	async mount(context) {
		const [{ startTypeGpuSlimeMold }, { Pane }] = await Promise.all([
			import('@zenfg-example/typegpu-slime-mold'),
			import('tweakpane'),
		]);
		const controller = await startTypeGpuSlimeMold(context.canvas, {
			onFrame: context.onFrame,
			onReady: context.onReady,
			onError: (error) => context.onError(toError(error)),
		});
		if (!controller) return undefined;

		const settings: SlimeMoldSettings = { ...controller.getSettings() };
		let pane: TweakpaneControl | undefined;
		try {
			pane = new Pane({
				container: context.controlsHost,
			}) as unknown as TweakpaneControl;
			bindSetting(pane, settings, controller.setSettings.bind(controller), 'moveSpeed', {
				label: 'Move Speed', min: 0, max: 100, step: 1,
			});
			bindSetting(pane, settings, controller.setSettings.bind(controller), 'sensorAngle', {
				label: 'Sensor Angle', min: 0, max: 3.14, step: 0.01,
			});
			bindSetting(pane, settings, controller.setSettings.bind(controller), 'sensorDistance', {
				label: 'Sensor Distance', min: 1, max: 50, step: 0.5,
			});
			bindSetting(pane, settings, controller.setSettings.bind(controller), 'turnSpeed', {
				label: 'Turn Speed', min: 0, max: 10, step: 0.1,
			});
			bindSetting(pane, settings, controller.setSettings.bind(controller), 'evaporationRate', {
				label: 'Evaporation Rate', min: 0, max: 0.5, step: 0.01,
			});
		} catch (error) {
			pane?.dispose();
			context.controlsHost.replaceChildren();
			controller.dispose();
			throw error;
		}

		let disposed = false;
		return {
			captureSnapshot: () => controller.captureSnapshot(),
			dispose() {
				if (disposed) return;
				disposed = true;
				pane?.dispose();
				context.controlsHost.replaceChildren();
				controller.dispose();
			},
		};
	},
};

function bindSetting(
	pane: TweakpaneControl,
	settings: SlimeMoldSettings,
	setSettings: (settings: Partial<SlimeMoldSettings>) => void,
	key: keyof SlimeMoldSettings,
	options: { readonly label: string; readonly min: number; readonly max: number; readonly step: number },
): void {
	pane.addBinding(settings, key, options).on('change', (event) => {
		setSettings({ [key]: event.value });
	});
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
