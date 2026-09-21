import type { ExamplesExampleDefinition } from '../types.ts';

export const playCanvasGsplatInteropExample: ExamplesExampleDefinition = {
    id: 'playcanvas-gsplat-interop', title: 'PlayCanvas · GSplat Co-rendering',
    group: 'Showcases', tags: ['playcanvas', 'gaussian-splatting', 'interop', 'shared-resources'],
    readyState: 'live', hasControls: false,
    loadingNote: 'Loads external Toy Cat data. WebGPU and an internet connection are required.',
    description: 'Combine PlayCanvas Toy Cat splats with orange Reference Renderer primitives and a gray base. Inspect native drawing, an external submission and final composition. Mesh depth rejects background splats; foreground splats blend over it. Forward Z is always enabled. Drag to orbit · Scroll to zoom.',
    references: [
        { label: 'PlayCanvas GSplat tutorial', relation: 'Reference', href: 'https://developer.playcanvas.com/user-manual/gaussian-splatting/building/your-first-app/engine/' },
        { label: 'Source and resource notices', relation: 'Reference', href: 'https://github.com/uinosoft/zenfg/blob/main/apps/site/examples/playcanvas-gsplat-interop/THIRD_PARTY_NOTICES.md' },
    ],
    entrySourceId: 'playcanvas-gsplat-interop-entry',
    sourceFiles: [
        { id: 'playcanvas-gsplat-interop-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-interop/src/main.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-interop/src/main.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-interop/src/scene.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-interop/src/scene.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/graph.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/graph.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-bridge', label: 'bridge.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/bridge.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/bridge.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-composite', label: 'composite.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/composite.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/composite.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-camera', label: 'camera.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/camera.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/camera.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-loading', label: 'loading.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/loading.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/loading.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-host', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/host.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/host.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-adapter', label: 'playCanvasGsplatInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/playCanvasGsplatInterop.ts',
            loadSource: async () => (await import('./playCanvasGsplatInterop.ts?raw')).default },
        { id: 'playcanvas-gsplat-interop-controls', label: 'playCanvasGsplatHost.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/playCanvasGsplatHost.ts',
            loadSource: async () => (await import('./playCanvasGsplatHost.ts?raw')).default },
    ],
    async mount(context) {
        const [{ startPlayCanvasGsplatInterop }, { mountSplat }] = await Promise.all([
            import('../../../examples/playcanvas-gsplat-interop/src/index.ts'), import('./playCanvasGsplatHost.ts'),
        ]);
        context.signal?.throwIfAborted();
        return mountSplat(context, false, startPlayCanvasGsplatInterop);
    },
};
