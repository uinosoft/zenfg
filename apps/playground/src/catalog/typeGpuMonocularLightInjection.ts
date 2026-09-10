import type { MonocularController, MonocularLightInjectionSettings, MonocularState, ModelSize, SourceMode } from '@zenfg-example/typegpu-monocular-light-injection';
import type { PlaygroundExampleDefinition, PlaygroundSourceFile } from '../types.ts';

type Control = { disabled: boolean; on(event: 'change' | 'click', callback: () => void): Control };
type ControlPane = {
    addBinding(object: object, key: string, options?: Record<string, unknown>): Control;
    addButton(options: { title: string }): Control;
    refresh(): void;
    dispose(): void;
};
const sources = {
    'monocularLightInjection.ts': () => import('../../../../examples/typegpu-monocular-light-injection/src/monocularLightInjection.ts?raw'),
    'model-store.ts': () => import('../../../../examples/typegpu-monocular-light-injection/src/model-store.ts?raw'),
    'monocularLightInjectionShaders.ts': () => import('../../../../examples/typegpu-monocular-light-injection/src/monocularLightInjectionShaders.ts?raw'),
    'host.ts': () => import('../../../../examples/typegpu-monocular-light-injection/src/host.ts?raw'),
};
const sourceFiles: PlaygroundSourceFile[] = Object.entries(sources).map(([name, load]) => ({
    id: `monocular-${name}`, label: name,
    path: `examples/typegpu-monocular-light-injection/src/${name}`,
    role: name.includes('Shaders') ? 'shader' : name === 'host.ts' || name === 'model-store.ts' ? 'host' : 'example',
    language: 'typescript',
    loadSource: async () => (await load()).default,
}));

export const typeGpuMonocularLightInjectionExample: PlaygroundExampleDefinition = {
    id: 'typegpu-monocular-light-injection',
    title: 'TypeGPU · Monocular Light Injection',
    group: 'Showcases',
    tags: ['typegpu', 'inference', 'lighting'],
    readyState: 'live',
    description: 'Move or drag the light · Scroll to change distance',
    loadingNote: 'Initial model download: approximately 13–23 MB.',
    hasControls: true,
    entrySourceId: 'typegpu-monocular-light-injection-entry',
    sourceFiles: [
        {
            id: 'typegpu-monocular-light-injection-entry', label: 'main.ts', role: 'example', language: 'typescript',
            path: 'examples/typegpu-monocular-light-injection/src/main.ts',
            loadSource: async () => (await import('../../../../examples/typegpu-monocular-light-injection/src/main.ts?raw')).default,
        },
        ...sourceFiles, {
            id: 'monocular-adapter', label: 'typeGpuMonocularLightInjection.ts',
            path: 'apps/playground/src/catalog/typeGpuMonocularLightInjection.ts', role: 'host', language: 'typescript',
            loadSource: async () => (await import('./typeGpuMonocularLightInjection.ts?raw')).default,
        }],
    async mount(context) {
        const [example, { Pane }] = await Promise.all([import('@zenfg-example/typegpu-monocular-light-injection'), import('tweakpane')]);
        context.signal?.throwIfAborted();
        let pane: ControlPane | undefined;
        let controller: MonocularController | undefined;
        let disposed = false;
        let syncing = false;
        const abort = new AbortController();
        const controls: Control[] = [];
        const upload = document.createElement('input');
        upload.type = 'file'; upload.accept = 'image/*'; upload.hidden = true;
        const params = {
            model: 'small' as ModelSize, source: 'demo' as SourceMode, camera: 'user',
            cacheModels: true, cached: 'not cached',
            view: 'relit', intensity: 3, exposure: 0.5, relief: 0.85,
            specular: 0.22, shadow: 0.7, occlusion: 0.55, color: '#ffb876',
        };
        const sync = (state: MonocularState) => {
            if (disposed) return;
            Object.assign(params, {
                model: state.model, source: state.source, camera: state.camera,
                cacheModels: state.cacheModels, cached: state.cached ? 'cached' : 'not cached'
            });
            for (const control of controls) control.disabled = state.busy;
            syncing = true;
            try { pane?.refresh(); }
            finally { syncing = false; }
        };
        const cleanup = () => {
            if (disposed) return;
            disposed = true;
            abort.abort();
            context.signal?.removeEventListener('abort', cleanup);
            controller?.dispose();
            pane?.dispose();
            upload.remove();
            context.controlsHost.replaceChildren();
        };
        try {
            controller = await example.startMonocularLightInjection(context.canvas, {
                signal: context.signal, onStateChange: sync,
                onFrame: context.onFrame, onLoading: context.onLoading, onReady: context.onReady, onError: context.onError,
            });
            context.signal?.throwIfAborted();
            context.signal?.addEventListener('abort', cleanup, { once: true });
            context.controlsHost.append(upload);
            pane = new Pane({ container: context.controlsHost }) as unknown as ControlPane;
            const active = controller;
            const bind = (key: string, options: Record<string, unknown>, change: () => void) => {
                controls.push(pane!.addBinding(params, key, options).on('change', () => {
                    if (!syncing && !disposed) change();
                }));
            };
            const button = (title: string, click: () => void) => controls.push(pane!.addButton({ title }).on('click', click));
            const modelOptions = Object.fromEntries(example.MODEL_SIZES.flatMap((size) => {
                const variant = example.modelVariant(size, active.getState().shaderF16);
                return variant ? [[example.modelLabel(size, variant), size]] : [];
            }));
            bind('model', { label: 'Model', options: modelOptions }, () => { void active.selectModel(params.model); });
            button('Reload / retry model', () => { void active.selectModel(params.model); });
            bind('source', { label: 'Source', options: { 'Demo photo': 'demo', Camera: 'camera', Upload: 'upload' } }, () => { void active.selectSource(params.source); });
            button('Load / retry demo photo', () => { void active.selectSource('demo'); });
            button('Choose uploaded image', () => upload.click());
            bind('camera', { label: 'Camera', options: { Front: 'user', Back: 'environment' } }, () => { void active.selectCamera(params.camera as 'user' | 'environment'); });
            bind('view', { label: 'View', options: Object.fromEntries(example.MONOCULAR_LIGHT_INJECTION_MODES.map((mode) => [mode, mode])) }, () => {
                active.setSettings({ mode: params.view as MonocularLightInjectionSettings['mode'] });
            });
            for (const [key, max] of [['intensity', 3.5], ['exposure', 1.2], ['relief', 2.5], ['specular', 1], ['shadow', 1], ['occlusion', 1]] as const) {
                bind(key, { label: key === 'exposure' ? 'Ambient' : key, min: 0, max, step: 0.05 }, () => active.setSettings({ [key]: params[key] }));
            }
            bind('color', { label: 'Light color', view: 'color' }, () => {
                const hex = params.color.replace('#', '');
                if (/^[0-9a-f]{6}$/i.test(hex)) active.setSettings({ lightColor: [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number] });
            });
            bind('cacheModels', { label: 'Cache downloads' }, () => active.setCacheEnabled(params.cacheModels));
            pane.addBinding(params, 'cached', { label: 'Model cache', readonly: true });
            button('Clear model downloads', () => { void active.clearDownloads(); });
            upload.addEventListener('change', () => {
                const file = upload.files?.[0];
                if (file) void active.uploadImage(file);
                upload.value = '';
            }, { signal: abort.signal });
            sync(active.getState());
            return { captureSnapshot: () => active.captureSnapshot(), dispose: cleanup };
        } catch (error) { cleanup(); throw error; }
    },
};
