import type { Particles4AllController, Particles4AllPreset, Particles4AllSettings } from '@zenfg-example/particles4all-framegraph';
import type { PlaygroundExampleDefinition, PlaygroundSourceFile } from '../types.ts';

type Control = { on(event: 'change' | 'click', callback: () => void): Control };
type ControlPane = {
    addBinding(object: object, key: string, options?: Record<string, unknown>): Control;
    addButton(options: { title: string }): Control;
    addFolder(options: { title: string; expanded: boolean }): ControlPane;
    refresh(): void;
    dispose(): void;
};
type PaneConstructor = new (options: { container: HTMLElement; title: string }) => ControlPane;
const sources = {
    'Particles4AllFeature.ts': () => import('../../../../examples/particles4all-framegraph/src/Particles4AllFeature.ts?raw'),
    'startParticles4All.ts': () => import('../../../../examples/particles4all-framegraph/src/startParticles4All.ts?raw'),
    'settings.ts': () => import('../../../../examples/particles4all-framegraph/src/settings.ts?raw'),
    'upstream/wgsl.js': () => import('../../../../examples/particles4all-framegraph/src/upstream/wgsl.js?raw'),
    'upstream/mesh_wgsl.js': () => import('../../../../examples/particles4all-framegraph/src/upstream/mesh_wgsl.js?raw'),
    'upstream/ray_wgsl.js': () => import('../../../../examples/particles4all-framegraph/src/upstream/ray_wgsl.js?raw'),
    'upstream/ssfr_wgsl.js': () => import('../../../../examples/particles4all-framegraph/src/upstream/ssfr_wgsl.js?raw'),
    'upstream/ssfr_composite_wgsl.js': () => import('../../../../examples/particles4all-framegraph/src/upstream/ssfr_composite_wgsl.js?raw'),
};
const sourceFiles: PlaygroundSourceFile[] = Object.entries(sources).map(([name, load]) => ({
    id: `particles4all-${name}`, label: name,
    path: `examples/particles4all-framegraph/src/${name}`,
    role: name.endsWith('.js') ? 'shader' : name.startsWith('start') ? 'host' : 'example',
    language: name.endsWith('.js') ? 'javascript' : 'typescript',
    loadSource: async () => (await load()).default,
}));

export const particles4AllExample: PlaygroundExampleDefinition = {
    id: 'particles4all-framegraph', title: 'Particles4All · Fluid Simulation', group: 'Showcases',
    summary: 'Advanced · Fluid + rigid bodies · Four rendering modes',
    readyMessage: 'Live · Particles4All simulation + ZenFG',
    footerHint: 'Hover to push · Drag to orbit or carry solids · Right-drag to pan · Scroll to zoom · Space to pause',
    hasControls: true,
    sourceFiles: [...sourceFiles, {
        id: 'particles4all-adapter', label: 'particles4All.ts',
        path: 'apps/playground/src/catalog/particles4All.ts', role: 'host', language: 'typescript',
        loadSource: async () => (await import('./particles4All.ts?raw')).default,
    }],
    async mount(context) {
        const [{ startParticles4All }, { Pane }] = await Promise.all([
            import('@zenfg-example/particles4all-framegraph'), import('tweakpane'),
        ]);
        context.signal?.throwIfAborted();
        const abort = new AbortController();
        let disposed = false;
        let controller: Particles4AllController | undefined;
        let controls: ReturnType<typeof createParticles4AllControls> | undefined;
        let timer: ReturnType<typeof setInterval> | undefined;
        let iniRevision = 0;
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.style.cssText = 'font-size:12px;line-height:1.5;padding:8px;overflow-wrap:anywhere';
        const stats = document.createElement('pre');
        stats.style.cssText = 'font-size:11px;line-height:1.6;padding:8px;white-space:pre-wrap';
        const environmentInput = document.createElement('input');
        environmentInput.type = 'file'; environmentInput.accept = 'image/*,.hdr'; environmentInput.hidden = true;
        const iniInput = document.createElement('input');
        iniInput.type = 'file'; iniInput.accept = '.ini,text/plain'; iniInput.hidden = true;
        const warning = (messages: readonly string[]) => { if (!disposed) status.textContent = messages.join(' · '); };
        const cleanup = () => {
            if (disposed) return;
            disposed = true; ++iniRevision;
            abort.abort();
            context.signal?.removeEventListener('abort', cleanup);
            clearInterval(timer);
            controller?.dispose();
            controls?.pane.dispose();
            context.controlsHost.replaceChildren();
        };
        try {
            controller = await startParticles4All(context.canvas, {
                signal: context.signal, onLoading: context.onLoading, onReady: context.onReady,
                onError: (error) => { cleanup(); context.onError(error); },
                onWarning: (message) => warning([message]),
                onStateChange: (state) => {
                    if (disposed) return;
                    status.textContent = state.status;
                    controls?.refreshFromFeature();
                },
            });
            context.signal?.throwIfAborted();
            context.signal?.addEventListener('abort', cleanup, { once: true });
            const active = controller;
            controls = createParticles4AllControls(context.controlsHost, active, warning, Pane as unknown as PaneConstructor,
                (kind) => (kind === 'environment' ? environmentInput : iniInput).click());
            context.controlsHost.append(status, stats, environmentInput, iniInput);
            status.textContent = active.getState().status;
            environmentInput.addEventListener('change', () => {
                const file = environmentInput.files?.[0]; environmentInput.value = '';
                if (file) void active.loadEnvironment(file);
            }, { signal: abort.signal });
            iniInput.addEventListener('change', () => {
                const file = iniInput.files?.[0]; iniInput.value = '';
                if (!file) return;
                const revision = ++iniRevision;
                void file.text().then((text) => {
                    if (disposed || revision !== iniRevision) return;
                    active.importSettings(text);
                    controls?.refreshFromFeature();
                }).catch((error: unknown) => {
                    if (!disposed && revision === iniRevision) warning([`INI import failed: ${error instanceof Error ? error.message : String(error)}`]);
                });
            }, { signal: abort.signal });
            const updateStats = () => {
                if (disposed) return;
                const s = active.getStats();
                stats.textContent = [
                    `Particles: ${s.particleCount.toLocaleString()}`,
                    `Fluid / rigid: ${s.fluidParticleCount.toLocaleString()} / ${s.rigidParticleCount.toLocaleString()}`,
                    `Boundary samples: ${s.boundaryParticleCount.toLocaleString()} · Bodies: ${s.bodyCount}`,
                    `Substeps: ${s.lastSubsteps} · Mesh triangles: ${s.meshTriangles.toLocaleString()}`,
                    `Density avg / max: ${s.averageDensity.toFixed(1)} / ${s.maximumDensity.toFixed(1)}`,
                    `Maximum speed: ${s.maximumSpeed.toFixed(2)} · Pour remaining: ${s.pourRemaining.toLocaleString()}`,
                ].join('\n');
            };
            updateStats(); timer = setInterval(updateStats, 250);
            return { captureSnapshot: () => active.captureSnapshot(), dispose: cleanup };
        } catch (error) { cleanup(); throw error; }
    },
};
export function createParticles4AllControls(
    controlsHost: HTMLElement,
    feature: Particles4AllController,
    setWarnings: (warnings: readonly string[]) => void,
    Pane: PaneConstructor,
    openFile: (kind: 'environment' | 'ini') => void,
): { pane: ControlPane; refreshFromFeature: () => void } {
    const params = feature.getSettings() as Particles4AllSettings;
    const transmission = { r: params.transmission[0], g: params.transmission[1], b: params.transmission[2] };
    const pane = new Pane({ container: controlsHost, title: 'Particles4All' });
    let refreshing = false;
    const attempt = (action: () => void) => {
        if (refreshing) return;
        try { action(); } catch (error) { setWarnings([error instanceof Error ? error.message : String(error)]); }
        refreshFromFeature();
    };
    const sync = () => attempt(() => feature.setSettings(params));
    const refreshFromFeature = () => {
        Object.assign(params, feature.getSettings());
        Object.assign(transmission, { r: params.transmission[0], g: params.transmission[1], b: params.transmission[2] });
        refreshing = true;
        try { pane.refresh(); } finally { refreshing = false; }
    };
    let qualityTouched = false;
    const bind = (
        folder: ControlPane,
        key: keyof Particles4AllSettings,
        options: Record<string, unknown> = {},
    ) => folder.addBinding(params, key, options).on('change', sync);

    const scene = pane.addFolder({ title: 'Scene', expanded: true });
    scene.addBinding(params, 'preset', { options: { Small: 'small', Medium: 'medium', Large: 'large' } }).on('change', () => attempt(() => {
        const preservedQuality = params.ssfrScale;
        feature.setSettings({ preset: params.preset as Particles4AllPreset,
            ...(qualityTouched ? { ssfrScale: preservedQuality } : {}) });
        refreshFromFeature();
    }));
    scene.addBinding(params, 'displayMode', {
        label: 'Display',
        options: { Particles: 'particles', 'Surface mesh': 'surface-mesh', 'Ray march': 'ray-march', SSFR: 'ssfr' },
    }).on('change', sync);
    bind(scene, 'paused', { label: 'Paused' });
    bind(scene, 'timeScale', { label: 'Time scale', min: 0.05, max: 1, step: 0.01 });
    bind(scene, 'boxScaleX', { label: 'Box size', min: 0.5, max: 2, step: 0.05 });
    bind(scene, 'rigidBodiesEnabled', { label: 'Solids' });
    scene.addButton({ title: 'Reset scene' }).on('click', () => attempt(() => feature.reset()));
    scene.addButton({ title: 'Pour water' }).on('click', () => attempt(() => feature.togglePour()));
    scene.addButton({ title: 'Reset camera' }).on('click', () => attempt(() => feature.resetCamera()));

    const simulation = pane.addFolder({ title: 'Simulation', expanded: false });
    bind(simulation, 'substeps', { min: 1, max: 8, step: 1 });
    bind(simulation, 'iterations', { min: 1, max: 10, step: 1 });
    bind(simulation, 'cfm', { label: 'CFM', min: 0.0001, max: 0.1, step: 0.0001 });
    bind(simulation, 'omega', { label: 'SOR ω', min: 0.5, max: 2, step: 0.05 });
    bind(simulation, 'sorAverage', { label: 'SOR average' });
    bind(simulation, 'xsph', { label: 'XSPH c', min: 0, max: 0.3, step: 0.005 });
    bind(simulation, 'scorr', { label: 'sCorr k', min: 0, max: 0.4, step: 0.005 });
    bind(simulation, 'scorrDq', { label: 'sCorr dq', min: 0.05, max: 1, step: 0.01 });
    bind(simulation, 'tension', { min: 0, max: 3, step: 0.05 });
    bind(simulation, 'gravity', { min: 0, max: 30, step: 0.1 });
    bind(simulation, 'particleRadius', { label: 'Particle radius', min: 0.2, max: 1, step: 0.05 });
    bind(simulation, 'speedMax', { label: 'Color speed max', min: 0.1, max: 10, step: 0.1 });
    bind(simulation, 'forceEnabled', { label: 'Pointer force' });
    bind(simulation, 'forceRadius', { label: 'Force radius', min: 0.02, max: 0.4, step: 0.01 });
    bind(simulation, 'forceStrength', { label: 'Force', min: 0, max: 120, step: 1 });
    bind(simulation, 'forceLimit', { label: 'Force limit', min: 0.5, max: 12, step: 0.5 });
    bind(simulation, 'cameraSpeed', { label: 'Camera speed', min: 0.25, max: 6, step: 0.25 });
    bind(simulation, 'grabEnabled', { label: 'Carry solids' });
    bind(simulation, 'grabStrength', { label: 'Grab strength', min: 1, max: 40, step: 1 });

    const pour = pane.addFolder({ title: 'Pour', expanded: false });
    bind(pour, 'pourSpeed', { label: 'Jet speed', min: 0.5, max: 8, step: 0.05 });
    bind(pour, 'pourWidth', { label: 'Nozzle width', min: 0.04, max: 0.4, step: 0.005 });
    bind(pour, 'pourHeight', { label: 'Nozzle height', min: 0.15, max: 0.95, step: 0.01 });
    bind(pour, 'pourTilt', { label: 'Nozzle tilt', min: 0, max: 60, step: 1 });

    const surface = pane.addFolder({ title: 'Surface', expanded: false });
    bind(surface, 'meshResolution', { label: 'Field res', min: 48, max: 512, step: 8 });
    bind(surface, 'normalSmooth', { label: 'Normal smooth', min: 0, max: 8, step: 1 });
    bind(surface, 'fieldSmooth', { label: 'Field smooth', min: 0, max: 8, step: 1 });
    bind(surface, 'meshIso', { label: 'Iso', min: 0.05, max: 0.8, step: 0.01 });
    bind(surface, 'anisotropyRatio', { label: 'Flattening', min: 1, max: 8, step: 0.05 });
    bind(surface, 'anisotropyLambda', { label: 'Aniso λ', min: 0, max: 1, step: 0.01 });
    bind(surface, 'anisotropyNeighbours', { label: 'Aniso neighbours', min: 1, max: 64, step: 1 });
    bind(surface, 'anisotropyLonely', { label: 'Lonely scale', min: 0, max: 2, step: 0.01 });
    bind(surface, 'anisotropyRadius', { label: 'Aniso radius', min: 1, max: 4, step: 0.05 });
    bind(surface, 'anisotropyStretch', { label: 'Aniso stretch', min: 1, max: 8, step: 0.05 });
    bind(surface, 'anisotropyKs', { label: 'Aniso ks', min: 0.1, max: 4, step: 0.05 });

    const ssfr = pane.addFolder({ title: 'SSFR', expanded: false });
    ssfr.addBinding(params, 'ssfrScale', { label: 'Quality', min: 0.25, max: 1, step: 0.05 }).on('change', () => {
        if (refreshing) return;
        qualityTouched = true;
        sync();
    });
    ssfr.addBinding(params, 'ssfrDebug', {
        label: 'Debug view',
        options: { Shaded: 0, Normal: 1, 'Smoothed depth': 2, Thickness: 3, 'Raw depth': 4, 'Solid distance': 5 },
    }).on('change', sync);
    bind(ssfr, 'ssfrRadius', { label: 'Splat radius', min: 0.25, max: 2.5, step: 0.01 });
    ssfr.addBinding(params, 'ssfrFilter', { options: { Gaussian: 0, Bilateral: 1, 'Narrow range': 2 } }).on('change', sync);
    bind(ssfr, 'ssfrIterations', { label: 'Filter iters', min: 0, max: 6, step: 1 });
    bind(ssfr, 'ssfrSigma', { label: 'Filter size', min: 0.1, max: 3, step: 0.02 });
    bind(ssfr, 'ssfrDelta', { label: 'Delta', min: 1, max: 30, step: 0.1 });
    bind(ssfr, 'ssfrMu', { label: 'Mu', min: 0.1, max: 4, step: 0.05 });
    bind(ssfr, 'ssfrBilateralRange', { label: 'Bilateral range', min: 0.1, max: 8, step: 0.05 });
    bind(ssfr, 'ssfrCleanupPass', { label: 'Cleanup pass' });
    bind(ssfr, 'ssfrThicknessRadius', { label: 'Thick radius', min: 0.2, max: 2, step: 0.01 });
    bind(ssfr, 'ssfrThicknessScale', { label: 'Thick scale', min: 0.1, max: 8, step: 0.05 });
    bind(ssfr, 'ssfrThicknessBlur', { label: 'Thick blur', min: 0, max: 24, step: 1 });
    bind(ssfr, 'ssfrDepthCull', { label: 'Depth cull', min: 0, max: 1, step: 0.01 });

    const optics = pane.addFolder({ title: 'Ray Optics', expanded: false });
    optics.addBinding(params, 'raySurface', { options: { Mesh: 'mesh', Field: 'field' } }).on('change', sync);
    optics.addBinding(params, 'rayDebug', {
        label: 'Debug view',
        options: {
            Shaded: 0,
            Normal: 1,
            'Hit distance': 2,
            'Path length': 3,
            'Reflection below horizon': 4,
            'Normal tilt': 5,
            'Reflection only': 6,
        },
    }).on('change', sync);
    bind(optics, 'rayThicknessSteps', { label: 'Thickness steps', min: 8, max: 192, step: 4 });
    bind(optics, 'ior', { label: 'IOR', min: 1, max: 2, step: 0.001 });
    bind(optics, 'absorption', { min: 0, max: 8, step: 0.05 });
    optics.addBinding(transmission, 'r', { label: 'Transmit R', min: 0, max: 1, step: 0.01 }).on('change', () => {
        if (refreshing) return;
        params.transmission = [transmission.r, params.transmission[1], params.transmission[2]]; sync();
    });
    optics.addBinding(transmission, 'g', { label: 'Transmit G', min: 0, max: 1, step: 0.01 }).on('change', () => {
        if (refreshing) return;
        params.transmission = [params.transmission[0], transmission.g, params.transmission[2]]; sync();
    });
    optics.addBinding(transmission, 'b', { label: 'Transmit B', min: 0, max: 1, step: 0.01 }).on('change', () => {
        if (refreshing) return;
        params.transmission = [params.transmission[0], params.transmission[1], transmission.b]; sync();
    });
    bind(optics, 'groundReflection', { label: 'Ground refl', min: 0, max: 1, step: 0.01 });
    bind(optics, 'roughness', { min: 0.005, max: 0.3, step: 0.005 });
    bind(optics, 'sunIntensity', { label: 'Sun power', min: 0, max: 10, step: 0.1 });
    bind(optics, 'sunElevation', { label: 'Sun elev', min: 2, max: 88, step: 1 });
    bind(optics, 'sunAzimuth', { label: 'Sun azim', min: -180, max: 180, step: 1 });
    bind(optics, 'exposure', { min: 0.2, max: 3, step: 0.05 });

    const environment = pane.addFolder({ title: 'Environment', expanded: false });
    bind(environment, 'environmentIntensity', { label: 'Env power', min: 0, max: 4, step: 0.05 });
    bind(environment, 'environmentYawDegrees', { label: 'Env yaw', min: -180, max: 180, step: 1 });
    bind(environment, 'floorPlane', { label: 'Grid floor' });
    environment.addButton({ title: 'Load panorama' }).on('click', () => openFile('environment'));
    environment.addButton({ title: 'Clear panorama' }).on('click', () => attempt(() => feature.clearEnvironment()));
    environment.addButton({ title: 'Load pbf_settings.ini' }).on('click', () => openFile('ini'));
    return { pane, refreshFromFeature };
}
