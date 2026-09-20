import type { ExamplesExampleDefinition } from '../types.ts';

export const pixiInteropExample: ExamplesExampleDefinition = {
    id: 'pixi-interop', title: 'Portal Lens · PixiJS', group: 'Showcases',
    tags: ['webgpu', 'interop', 'shared-resources'], readyState: 'live', hasControls: false,
    entrySourceId: 'pixi-entry',
    description: [
        'A live 3D city becomes a texture in a ', { text: 'PixiJS', href: 'https://pixijs.com/' },
        ' star chart. Drag the golden lens across the portal edge: the same built-in filter bends 3D pixels and 2D artwork together. ',
        'Drag inside the portal to orbit · Scroll to zoom. Inspect Reference Draw → shared texture → Pixi external submission.',
    ],
    references: [{ label: 'PixiJS 8.21.0', href: 'https://github.com/pixijs/pixijs/releases/tag/v8.21.0', relation: 'Reference' }],
    sourceFiles: [
        { id: 'pixi-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/main.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/main.ts?raw')).default },
        { id: 'pixi-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/graph.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/graph.ts?raw')).default },
        { id: 'pixi-bridge', label: 'pixi.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/pixi.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/pixi.ts?raw')).default },
        { id: 'pixi-art', label: 'artwork.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/artwork.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/artwork.ts?raw')).default },
        { id: 'pixi-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/scene.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/scene.ts?raw')).default },
        { id: 'pixi-view', label: 'view.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/view.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/view.ts?raw')).default },
        { id: 'pixi-host', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/pixi-interop/src/host.ts',
            loadSource: async () => (await import('../../../examples/pixi-interop/src/host.ts?raw')).default },
        { id: 'pixi-adapter', label: 'pixiInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/pixiInterop.ts',
            loadSource: async () => (await import('./pixiInterop.ts?raw')).default },
    ],
    async mount(context) {
        const { startPixiInterop } = await import('../../../examples/pixi-interop/src/main.ts');
        context.signal?.throwIfAborted();
        return startPixiInterop(context.canvas, context);
    },
};