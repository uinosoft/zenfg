import type { PlaygroundExampleDefinition } from '../types.ts';

export const babylonLiteInteropExample: PlaygroundExampleDefinition = {
    id: 'babylon-lite-interop',
    title: 'Babylon Lite Co-rendering',
    group: 'Showcases',
    summary: 'Babylon Lite + Reference Renderer · shared color and depth',
    readyMessage: 'Live · Babylon Lite + Reference Renderer',
    footerHint: 'Drag to orbit · Scroll to zoom',
    hasControls: true,
    sourceFiles: [
        {
            id: 'babylon-lite-interop-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-lite-interop/src/graph.ts',
            loadSource: async () => (await import('../../../../examples/babylon-lite-interop/src/graph.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-bridge', label: 'bridge.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-lite-interop/src/bridge.ts',
            loadSource: async () => (await import('../../../../examples/babylon-lite-interop/src/bridge.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-resolve', label: 'resolve.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-lite-interop/src/resolve.ts',
            loadSource: async () => (await import('../../../../examples/babylon-lite-interop/src/resolve.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'examples/babylon-lite-interop/src/scene.ts',
            loadSource: async () => (await import('../../../../examples/babylon-lite-interop/src/scene.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-start', label: 'start.ts', role: 'host', language: 'typescript',
            path: 'examples/babylon-lite-interop/src/start.ts',
            loadSource: async () => (await import('../../../../examples/babylon-lite-interop/src/start.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-present', label: 'present.ts', role: 'host', language: 'typescript',
            path: 'examples/babylon-lite-interop/src/present.ts',
            loadSource: async () => (await import('../../../../examples/babylon-lite-interop/src/present.ts?raw')).default,
        },
        {
            id: 'babylon-lite-interop-adapter', label: 'babylonLiteInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/playground/src/catalog/babylonLiteInterop.ts',
            loadSource: async () => (await import('./babylonLiteInterop.ts?raw')).default,
        },
    ],
    async mount(context) {
        const { startBabylonLiteInterop } = await import('@zenfg-example/babylon-lite-interop');
        context.signal?.throwIfAborted();
        let disposed = false;
        const controller = await startBabylonLiteInterop(context.canvas, {
            signal: context.signal,
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
        try {
            context.signal?.addEventListener('abort', cleanup, { once: true });
            const depthNote = document.createElement('p');
            depthNote.textContent = 'Reverse Z · Always enabled (Babylon Lite native depth)';
            depthNote.style.cssText = 'font-size:12px;line-height:1.6;padding:8px';
            context.controlsHost.append(depthNote);
            const legend = document.createElement('p');
            legend.setAttribute('aria-label', 'Renderer legend');
            legend.style.cssText = 'font-size:12px;line-height:1.6;padding:8px;display:flex;flex-direction:column;gap:4px';
            for (const { label, colors } of [
                { label: 'Babylon Lite', colors: ['#22d3ee'] },
                { label: 'Reference Renderer (incl. base)', colors: ['#fb923c', '#a3a3a3'] },
            ]) {
                const item = document.createElement('span');
                item.style.cssText = 'display:flex;align-items:center;gap:8px';
                const swatches = document.createElement('span');
                swatches.setAttribute('aria-hidden', 'true');
                swatches.style.cssText = 'display:flex;gap:3px;min-width:22px';
                for (const color of colors) {
                    const swatch = document.createElement('span');
                    swatch.style.color = color;
                    swatch.textContent = '●';
                    swatches.append(swatch);
                }
                item.append(swatches, document.createTextNode(label));
                legend.append(item);
            }
            context.controlsHost.append(legend);
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
