import type { PlaygroundExampleDefinition } from '../types.ts';

export const babylonLiteInteropExample: PlaygroundExampleDefinition = {
    id: 'babylon-lite-interop',
    title: 'Babylon Lite Co-rendering',
    group: 'Showcases',
    tags: ['babylon-lite', 'interop', 'shared-resources'],
    readyState: 'live',
    description: "Combine Babylon Lite and the reference renderer using shared color and reverse-Z depth. Inspect the boundary between engine-owned rendering and graph-managed work. Cyan objects: Babylon Lite. Orange objects and gray base: Reference Renderer. Reverse Z is always enabled (Babylon Lite native depth). Drag to orbit · Scroll to zoom.",
    hasControls: false,
    entrySourceId: 'babylon-lite-interop-entry',
    sourceFiles: [
        {
            id: 'babylon-lite-interop-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/main.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/main.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/graph.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/graph.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-bridge', label: 'bridge.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/bridge.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/bridge.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-resolve', label: 'resolve.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/resolve.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/resolve.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/scene.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/scene.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-present', label: 'present.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/present.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/present.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-start', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/babylon-lite-interop/src/host.ts',
            loadSource: async () => (await import('../../../examples/babylon-lite-interop/src/host.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-adapter', label: 'babylonLiteInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/babylonLiteInterop.ts',
            loadSource: async () => (await import('./babylonLiteInterop.ts?raw')).default,
        },
    ],
    async mount(context) {
        const { startBabylonLiteInterop } = await import('../../../examples/babylon-lite-interop/src/index.ts');
        context.signal?.throwIfAborted();
        let disposed = false;
        const controller = await startBabylonLiteInterop(context.canvas, {
            signal: context.signal,
            onFrame: context.onFrame,
            onReady: () => {
                if (!disposed && !context.signal?.aborted) context.onReady();
            },
            onError: (error) => {
                if (!disposed && !context.signal?.aborted) context.onError(error);
            },
        });
        if (!controller) return undefined;
        if (context.signal?.aborted) {
            disposed = true;
            controller.dispose();
            return undefined;
        }
        const cleanup = () => {
            if (disposed) return;
            disposed = true;
            context.signal?.removeEventListener('abort', cleanup);
            controller.dispose();
            context.controlsHost.replaceChildren();
        };
        context.signal?.addEventListener('abort', cleanup, { once: true });
        return {
            captureSnapshot: () => controller.captureSnapshot(),
            dispose: cleanup,
        };
    },
};
