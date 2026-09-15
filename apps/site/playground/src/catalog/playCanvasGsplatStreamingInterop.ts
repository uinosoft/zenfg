import type { ExamplesExampleDefinition } from '../types.ts';

export const playCanvasGsplatStreamingInteropExample: ExamplesExampleDefinition = {
    id: 'playcanvas-gsplat-streaming-interop', title: 'PlayCanvas Streaming GSplat Co-rendering',
    group: 'Showcases', tags: ['playcanvas', 'gaussian-splatting', 'interop', 'shared-resources', 'streaming'],
    readyState: 'live', hasControls: true,
    loadingNote: 'Loads external streamed scene data from PlayCanvas. WebGPU and an internet connection are required.',
    description: [
        'Explore Roman Parish while PlayCanvas streams LOD data. Orange objects: Reference Renderer. Mesh depth rejects splats behind geometry; foreground splats blend over it. Forward Z is always enabled. Focus the canvas · Drag to look · WASD move · Q down / E up · Shift accelerate. ',
        '3D scanning data created and provided by ',
        { text: 'Andrii Shramko', href: 'https://www.linkedin.com/in/andrii-shramko/' }, ', ',
        { text: 'Teleportour', href: 'https://www.linkedin.com/company/teleportour/' }, '. ',
        { text: 'teleportour.com', href: 'http://teleportour.com' }, ' · ',
        { text: 'Dataset license', href: 'https://drive.google.com/file/d/1Z5CLOUG6mKfx9b69fE7CBP7bPLBtY2u7/view' },
    ],
    references: [
        { label: 'PlayCanvas LOD streaming', relation: 'Reference', href: 'https://playcanvas.github.io/#/gaussian-splatting/lod-streaming' },
        { label: 'Source and resource notices', relation: 'Reference', href: 'https://github.com/uinosoft/zenfg/blob/main/apps/site/examples/playcanvas-gsplat-streaming-interop/THIRD_PARTY_NOTICES.md' },
    ],
    entrySourceId: 'playcanvas-gsplat-streaming-interop-entry',
    sourceFiles: [
        { id: 'playcanvas-gsplat-streaming-interop-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-streaming-interop/src/main.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-streaming-interop/src/main.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-streaming-interop/src/scene.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-streaming-interop/src/scene.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/graph.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/graph.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-bridge', label: 'bridge.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/bridge.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/bridge.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-composite', label: 'composite.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/composite.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/composite.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-camera', label: 'camera.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/camera.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/camera.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-loading', label: 'loading.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/loading.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/loading.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-host', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/playcanvas-gsplat-shared/src/host.ts',
            loadSource: async () => (await import('../../../examples/playcanvas-gsplat-shared/src/host.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-adapter', label: 'playCanvasGsplatStreamingInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/playCanvasGsplatStreamingInterop.ts',
            loadSource: async () => (await import('./playCanvasGsplatStreamingInterop.ts?raw')).default },
        { id: 'playcanvas-gsplat-streaming-interop-controls', label: 'playCanvasGsplatHost.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/playCanvasGsplatHost.ts',
            loadSource: async () => (await import('./playCanvasGsplatHost.ts?raw')).default },
    ],
    async mount(context) {
        const [{ startPlayCanvasGsplatStreamingInterop }, { mountSplat }] = await Promise.all([
            import('../../../examples/playcanvas-gsplat-streaming-interop/src/index.ts'), import('./playCanvasGsplatHost.ts'),
        ]);
        context.signal?.throwIfAborted();
        return mountSplat(context, true, startPlayCanvasGsplatStreamingInterop);
    },
};
