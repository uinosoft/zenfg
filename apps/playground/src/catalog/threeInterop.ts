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

export const threeInteropExample: PlaygroundExampleDefinition = {
    id: 'three-interop',
    title: 'Three.js Co-rendering',
    group: 'Showcases',
    summary: 'Three.js + Reference Renderer · shared color and depth',
    readyMessage: 'Live · Three.js + Reference Renderer',
    footerHint: 'Drag to orbit · Scroll to zoom',
    hasControls: true,
    sourceFiles: [
        {
            id: 'three-interop-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'examples/three-interop/src/graph.ts',
            loadSource: async () => (await import('../../../../examples/three-interop/src/graph.ts?raw')).default,
        },
        {
            id: 'three-interop-bridge', label: 'bridge.ts', role: 'example', language: 'typescript',
            path: 'examples/three-interop/src/bridge.ts',
            loadSource: async () => (await import('../../../../examples/three-interop/src/bridge.ts?raw')).default,
        },
        {
            id: 'three-interop-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'examples/three-interop/src/scene.ts',
            loadSource: async () => (await import('../../../../examples/three-interop/src/scene.ts?raw')).default,
        },
        {
            id: 'three-interop-start', label: 'start.ts', role: 'host', language: 'typescript',
            path: 'examples/three-interop/src/start.ts',
            loadSource: async () => (await import('../../../../examples/three-interop/src/start.ts?raw')).default,
        },
        {
            id: 'three-interop-present', label: 'present.ts', role: 'host', language: 'typescript',
            path: 'examples/three-interop/src/present.ts',
            loadSource: async () => (await import('../../../../examples/three-interop/src/present.ts?raw')).default,
        },
        {
            id: 'three-interop-adapter', label: 'threeInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/playground/src/catalog/threeInterop.ts',
            loadSource: async () => (await import('./threeInterop.ts?raw')).default,
        },
    ],
    async mount(context) {
        const [{ startThreeInterop }, { Pane }] = await Promise.all([
            import('@zenfg-example/three-interop'), import('tweakpane'),
        ]);
        context.signal?.throwIfAborted();
        let disposed = false;
        const controller = await startThreeInterop(context.canvas, {
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
            pane = new Pane({ container: context.controlsHost, title: 'Three.js Co-rendering' }) as unknown as ControlPane;
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
            const legend = document.createElement('p');
            legend.setAttribute('aria-label', 'Renderer legend');
            legend.style.cssText = 'font-size:12px;line-height:1.6;padding:8px;display:flex;flex-direction:column;gap:4px';
            for (const { label, colors } of [
                { label: 'Three.js', colors: ['#22d3ee'] },
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
