import type { ReferenceRendererSettings } from '@zenfg-example/reference-renderer-demo';
import type { PlaygroundExampleDefinition } from '../types.ts';

export const referenceRendererExample: PlaygroundExampleDefinition = {
    id: 'reference-renderer',
    title: 'Reference Renderer',
    group: 'Showcases',
    tags: ['webgpu', 'gpu-culling', 'indirect-draw'],
    readyState: 'live',
    description: "Render an instanced 3D scene with culling and selectable depth conventions. Explore how the reference renderer records scene rendering and presentation into a FrameGraph.",
    instructions: 'Drag to orbit · Scroll to zoom',
    hasControls: true,
    entrySourceId: 'reference-renderer-entry',
    sourceFiles: [
        {
            id: 'reference-renderer-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'examples/reference-renderer-demo/src/main.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer-demo/src/main.ts?raw')).default,
        },
        {
            id: 'reference-renderer', label: 'renderer.ts', role: 'example', language: 'typescript',
            path: 'examples/reference-renderer/src/renderer.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer/src/renderer.ts?raw')).default,
        },
        {
            id: 'reference-renderer-types', label: 'types.ts', role: 'example', language: 'typescript',
            path: 'examples/reference-renderer/src/types.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer/src/types.ts?raw')).default,
        },
        {
            id: 'reference-renderer-primitives', label: 'primitives.ts', role: 'example', language: 'typescript',
            path: 'examples/reference-renderer/src/primitives.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer/src/primitives.ts?raw')).default,
        },
        {
            id: 'reference-renderer-demo', label: 'scene.ts', role: 'host', language: 'typescript',
            path: 'examples/reference-renderer-demo/src/scene.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer-demo/src/scene.ts?raw')).default,
        },
        {
            id: 'reference-renderer-camera', label: 'camera.ts', role: 'host', language: 'typescript',
            path: 'examples/reference-renderer-demo/src/camera.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer-demo/src/camera.ts?raw')).default,
        },
        {
            id: 'reference-renderer-present', label: 'present.ts', role: 'host', language: 'typescript',
            path: 'examples/reference-renderer-demo/src/present.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer-demo/src/present.ts?raw')).default,
        },
        {
            id: 'reference-renderer-shaders', label: 'shaders.ts', role: 'shader', language: 'typescript',
            path: 'examples/reference-renderer/src/shaders.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer/src/shaders.ts?raw')).default,
        },
        {
            id: 'reference-renderer-host', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'examples/reference-renderer-demo/src/host.ts',
            loadSource: async () => (await import('../../../../examples/reference-renderer-demo/src/host.ts?raw')).default,
        },
        {
            id: 'reference-renderer-adapter', label: 'referenceRenderer.ts', role: 'host', language: 'typescript',
            path: 'apps/playground/src/catalog/referenceRenderer.ts',
            loadSource: async () => (await import('./referenceRenderer.ts?raw')).default,
        },
    ],
    async mount(context) {
        const [{ startReferenceRenderer }, { Pane }] = await Promise.all([
            import('@zenfg-example/reference-renderer-demo'), import('tweakpane'),
        ]);
        context.signal?.throwIfAborted();
        const controller = await startReferenceRenderer(context.canvas, {
            onFrame: context.onFrame, signal: context.signal, onReady: context.onReady, onError: context.onError,
        });
        if (!controller) return undefined;
        if (context.signal?.aborted) {
            controller.dispose();
            return undefined;
        }
        let pane: InstanceType<typeof Pane> | undefined;
        try {
            pane = new Pane({ container: context.controlsHost });
            const settings: ReferenceRendererSettings = { ...controller.getSettings() };
            const controls = pane as unknown as {
                addBinding(object: object, key: string, options?: object): {
                    on(event: 'change', handler: () => void): void;
                };
            };
            controls.addBinding(settings, 'instanceCount', { label: 'Instances', min: 0, max: 10_000, step: 1 })
                .on('change', () => controller.setSettings({ instanceCount: settings.instanceCount }));
            controls.addBinding(settings, 'culling', { label: 'Frustum Culling' })
                .on('change', () => controller.setSettings({ culling: settings.culling }));
            controls.addBinding(settings, 'depthConvention', {
                label: 'Depth', options: { 'Reverse Z': 'reverse-z', 'Forward Z': 'forward-z' },
            }).on('change', () => controller.setSettings({ depthConvention: settings.depthConvention }));
        } catch (error) {
            pane?.dispose();
            controller.dispose();
            context.controlsHost.replaceChildren();
            throw error;
        }
        return {
            captureSnapshot: () => controller.captureSnapshot(),
            dispose() {
                pane?.dispose();
                pane = undefined;
                controller.dispose();
                context.controlsHost.replaceChildren();
            },
        };
    },
};
