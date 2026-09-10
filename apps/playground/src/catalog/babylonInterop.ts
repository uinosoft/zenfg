import type { PlaygroundExampleDefinition } from '../types.ts';

type Control = {
    disabled: boolean;
    on(event: 'change', handler: () => void): void;
};
type ControlPane = {
    addBinding(object: object, key: string, options?: object): Control;
    refresh(): void;
    dispose(): void;
};

export const babylonInteropExample: PlaygroundExampleDefinition = {
    id: 'babylon-interop',
    title: 'Babylon.js Co-rendering',
    group: 'Showcases',
    tags: ['babylonjs', 'interop', 'shared-resources'],
    readyState: 'live',
    description: 'Cyan objects: Babylon.js. Orange objects and gray base: Reference Renderer. Drag to orbit · Scroll to zoom',
    hasControls: true,
    entrySourceId: 'babylon-interop-entry',
    sourceFiles: [
        {
            id: 'babylon-interop-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-interop/src/main.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/main.ts?raw')).default,
        },
        {
            id: 'babylon-interop-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-interop/src/graph.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/graph.ts?raw')).default,
        },
        {
            id: 'babylon-interop-bridge', label: 'bridge.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-interop/src/bridge.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/bridge.ts?raw')).default,
        },
        {
            id: 'babylon-interop-resolve', label: 'resolve.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-interop/src/resolve.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/resolve.ts?raw')).default,
        },
        {
            id: 'babylon-interop-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-interop/src/scene.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/scene.ts?raw')).default,
        },
        {
            id: 'babylon-interop-present', label: 'present.ts', role: 'host', language: 'typescript',
            path: 'examples/babylon-interop/src/present.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/present.ts?raw')).default,
        },
        {
            id: 'babylon-interop-start', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'examples/babylon-interop/src/host.ts',
            loadSource: async () => (await import('../../../../examples/babylon-interop/src/host.ts?raw')).default,
        },
        {
            id: 'babylon-interop-adapter', label: 'babylonInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/playground/src/catalog/babylonInterop.ts',
            loadSource: async () => (await import('./babylonInterop.ts?raw')).default,
        },
    ],
    async mount(context) {
        const [{ startBabylonInterop }, { Pane }] = await Promise.all([
            import('@zenfg-example/babylon-interop'), import('tweakpane'),
        ]);
        context.signal?.throwIfAborted();
        let disposed = false;
        const controller = await startBabylonInterop(context.canvas, {
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
        let pane: ControlPane | undefined;
        const cleanup = () => {
            if (disposed) return;
            disposed = true;
            context.signal?.removeEventListener('abort', cleanup);
            pane?.dispose();
            pane = undefined;
            controller.dispose();
            context.controlsHost.replaceChildren();
        };
        try {
            context.signal?.addEventListener('abort', cleanup, { once: true });
            pane = new Pane({ container: context.controlsHost }) as unknown as ControlPane;
            const settings = { reverseZ: true };
            Object.assign(settings, controller.getSettings());
            let changing = false;
            const control = pane.addBinding(settings, 'reverseZ', { label: 'Reverse Z' });
            control.on('change', async () => {
                if (disposed || context.signal?.aborted || changing) return;
                changing = true;
                control.disabled = true;
                try {
                    await controller.setSettings({ reverseZ: settings.reverseZ });
                } catch {
                    // The demo host already reports setting-change errors through onError.
                } finally {
                    if (!disposed && !context.signal?.aborted) {
                        Object.assign(settings, controller.getSettings());
                        pane?.refresh();
                        control.disabled = false;
                    }
                    changing = false;
                }
            });

        } catch (error) {
            cleanup();
            throw error;
        }
        return {
            captureSnapshot: () => controller.captureSnapshot(),
            dispose: cleanup,
        };
    },
};
