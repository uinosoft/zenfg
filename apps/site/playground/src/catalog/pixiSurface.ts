import type { ExamplesExampleDefinition } from '../types.ts';

export const pixiSurfaceExample: ExamplesExampleDefinition = {
    id: 'pixi-surface', title: 'PixiJS · Tinted Screen', group: 'Showcases',
    tags: ['webgpu', 'pixijs', 'interop', 'shared-resources'], readyState: 'live', hasControls: true,
    entrySourceId: 'surface-entry',
    description: [
        'Twenty tinted PixiJS sprites become the texture of a curved 3D screen. ',
        'An orbiting sphere passes in front and behind with real depth testing. ',
        'Drag to orbit · Scroll to zoom · Pause freezes animation while the camera stays interactive.',
    ],
    references: [{ label: 'PixiJS 8.21.0', href: 'https://github.com/pixijs/pixijs/releases/tag/v8.21.0', relation: 'Reference' }],
    sourceFiles: [
        { id: 'surface-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/main.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/main.ts?raw')).default },
        { id: 'surface-graph', label: 'graph.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/graph.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/graph.ts?raw')).default },
        { id: 'surface-bridge', label: 'pixi.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/pixi.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/pixi.ts?raw')).default },
        { id: 'surface-art', label: 'screen.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/screen.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/screen.ts?raw')).default },
        { id: 'surface-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/scene.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/scene.ts?raw')).default },
        { id: 'surface-view', label: 'view.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/view.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/view.ts?raw')).default },
        { id: 'surface-host', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/host.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/host.ts?raw')).default },
        { id: 'surface-motion', label: 'motion.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/motion.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/motion.ts?raw')).default },
        { id: 'surface-present', label: 'present.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/present.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/present.ts?raw')).default },
        { id: 'surface-controls', label: 'controls.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/pixi-surface/src/controls.ts',
            loadSource: async () => (await import('../../../examples/pixi-surface/src/controls.ts?raw')).default },
        { id: 'surface-adapter', label: 'pixiSurface.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/pixiSurface.ts',
            loadSource: async () => (await import('./pixiSurface.ts?raw')).default },
    ],
    async mount(context) {
        const { startPixiSurface } = await import('../../../examples/pixi-surface/src/main.ts');
        context.signal?.throwIfAborted();
        return startPixiSurface(context.canvas, context);
    },
};