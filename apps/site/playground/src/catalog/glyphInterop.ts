import type { ExamplesExampleDefinition } from '../types.ts';
import type { GlyphSettings } from '../../../examples/glyph-interop/src/settings.ts';

export const glyphInteropExample: ExamplesExampleDefinition = {
    id: 'glyph-interop', title: 'Glyph · Mesh', group: 'Showcases',
    tags: ['webgpu', 'typegpu', 'interop', 'shared-resources'],
    readyState: 'live', hasControls: true, entrySourceId: 'glyph-entry',
    description: [
        '3D text rendered with the ',
        { text: 'Glyph', href: 'https://github.com/pmndrs/glyph' },
        ' and ',
        { text: 'TypeGPU', href: 'https://typegpu.com/' },
        ' libraries, sharing color and depth with meshes. Switch Bitmap, MSDF and Slug on the same 3D text plane. Orange cube: in front; teal sphere: behind. Drag to orbit · Scroll to zoom. Bitmap Auto selects a baked strike by font size and pixel ratio, not camera distance. Slug uses analytic curves; MSDF adds outline and hard shadow. Inspect the shared color and depth attachments.',
    ],
    references: [{ label: 'Glyph 0.1.0 TypeGPU integration', href: 'https://github.com/pmndrs/glyph/blob/2d543ee/apps/typegpu-hello-world/README.md', relation: 'Reference' }],
    sourceFiles: [
        { id: 'glyph-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/main.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/main.ts?raw')).default },
        { id: 'glyph-glyph', label: 'glyph.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/glyph.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/glyph.ts?raw')).default },
        { id: 'glyph-settings', label: 'settings.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/settings.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/settings.ts?raw')).default },
        { id: 'glyph-scene', label: 'scene.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/scene.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/scene.ts?raw')).default },
        { id: 'glyph-camera', label: 'camera.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/camera.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/camera.ts?raw')).default },
        { id: 'glyph-present', label: 'present.ts', role: 'example', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/present.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/present.ts?raw')).default },
        { id: 'glyph-host', label: 'host.ts', role: 'host', language: 'typescript',
            path: 'apps/site/examples/glyph-interop/src/host.ts',
            loadSource: async () => (await import('../../../examples/glyph-interop/src/host.ts?raw')).default },
        { id: 'glyph-adapter', label: 'glyphInterop.ts', role: 'host', language: 'typescript',
            path: 'apps/site/playground/src/catalog/glyphInterop.ts',
            loadSource: async () => (await import('./glyphInterop.ts?raw')).default },
    ],
    async mount(context) {
        const [{ startGlyphInterop }, { Pane }] = await Promise.all([
            import('../../../examples/glyph-interop/src/main.ts'), import('tweakpane'),
        ]);
        context.signal?.throwIfAborted();
        let disposed = false;
        // Tweakpane's standalone package omits its core API declarations.
        type Folder = { hidden: boolean; addBinding(object: object, key: string, options?: object): Binding;
            addFolder(options: object): Folder; addButton(options: object): { on(event: string, callback: () => void): void };
            refresh(): void; dispose(): void };
        type Binding = { on(event: string, callback: () => void): void };
        let pane: Folder | undefined;
        const statistics = { glyphs: 0, lines: 0 };
        const controller = await startGlyphInterop(context.canvas, {
            signal: context.signal, onFrame: context.onFrame, onPaused: context.onPaused,
            onLoading: context.onLoading, onWarning: context.onWarning,
            onReady: () => { if (!disposed) context.onReady(); },
            onError: error => { if (!disposed) context.onError(error); },
            onStatistics: value => { Object.assign(statistics, value); pane?.refresh(); },
        });
        if (!controller) return undefined;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            context.signal?.removeEventListener('abort', dispose);
            pane?.dispose(); controller.dispose();
            context.controlsHost.replaceChildren();
        };
        if (context.signal?.aborted) { dispose(); return undefined; }
        context.signal?.addEventListener('abort', dispose, { once: true });
        try {
            pane = new Pane({ container: context.controlsHost }) as unknown as Folder;
            const settings = controller.getSettings();
            // A single-line input accepts explicit newlines without adding a custom editor.
            const content = { text: settings.text.replaceAll('\n', '\\n') };
            pane.addBinding(content, 'text', { label: 'Text (\\n = line)' }).on('change', () => {
                controller.setSettings({ text: content.text.replaceAll('\\n', '\n') });
            });
            const bind = (folder: Folder, key: keyof GlyphSettings, options: object) =>
                folder.addBinding(settings, key, options).on('change', () => {
                    controller.setSettings({ [key]: settings[key] });
                    bitmap.hidden = settings.mode !== 'bitmap';
                    msdf.hidden = settings.mode !== 'msdf';
                });
            bind(pane, 'mode', { label: 'Raster', options: { Bitmap: 'bitmap', MSDF: 'msdf', Slug: 'slug' } });
            bind(pane, 'fontSize', { label: 'Font size', min: 12, max: 160, step: 1 });
            bind(pane, 'color', { label: 'Color' });
            bind(pane, 'opacity', { label: 'Opacity', min: 0, max: 1 });
            const layout = pane.addFolder({ title: 'Layout', expanded: false });
            bind(layout, 'width', { label: 'Width', min: 160, max: 960, step: 1 });
            bind(layout, 'wrap', { label: 'Wrap', options: { Word: 'word', Character: 'character', None: 'none' } });
            bind(layout, 'align', { label: 'Align', options: { Left: 'start', Center: 'center', Right: 'end' } });
            bind(layout, 'lineHeight', { label: 'Line height', min: 0.8, max: 2, step: 0.05 });
            bind(layout, 'letterSpacing', { label: 'Letter spacing', min: -2, max: 12, step: 0.25 });
            const bitmap = pane.addFolder({ title: 'Bitmap', expanded: true });
            bind(bitmap, 'strike', { label: 'Strike', options: { Auto: 'auto', '32 px': '32', '64 px': '64', '128 px': '128' } });
            const msdf = pane.addFolder({ title: 'MSDF effects', expanded: false });
            bind(msdf, 'outline', { label: 'Outline (em)', min: 0, max: 0.03, step: 0.001 });
            bind(msdf, 'outlineColor', { label: 'Outline color' });
            bind(msdf, 'shadow', { label: 'Hard shadow' });
            bind(msdf, 'shadowColor', { label: 'Shadow color' });
            bind(msdf, 'shadowX', { label: 'Shadow X (em)', min: -0.03, max: 0.03, step: 0.001 });
            bind(msdf, 'shadowY', { label: 'Shadow Y (em)', min: -0.03, max: 0.03, step: 0.001 });
            bitmap.hidden = settings.mode !== 'bitmap'; msdf.hidden = settings.mode !== 'msdf';
            const scene = pane.addFolder({ title: 'Scene', expanded: true });
            bind(scene, 'scale', { label: 'Text scale', min: 0.25, max: 4 });
            bind(scene, 'tilt', { label: 'Text tilt', min: -75, max: 75, step: 1 });
            scene.addButton({ title: 'Reset view' }).on('click', () => {
                controller.resetView(); Object.assign(settings, controller.getSettings()); pane?.refresh();
            });
            const stats = pane.addFolder({ title: 'Statistics', expanded: false });
            stats.addBinding(statistics, 'glyphs', { label: 'Glyphs', readonly: true });
            stats.addBinding(statistics, 'lines', { label: 'Lines', readonly: true });
        } catch (error) { dispose(); throw error; }
        return { captureSnapshot: request => controller.captureSnapshot(request), dispose };
    },
};
