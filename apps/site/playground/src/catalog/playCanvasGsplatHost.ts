import { Pane } from 'tweakpane';
import type { ExamplesMountContext, ExamplesRuntime } from '../types.ts';
import type { SplatController, StartSplatOptions } from '../../../examples/playcanvas-gsplat-shared/src/host.ts';

type Panel = {
    addBinding(state: object, key: string, options: object): { on(event: 'change', callback: () => void): void };
    addButton(options: { title: string }): { on(event: 'click', callback: () => void): void };
    dispose(): void;
};

/** Catalog-only controls. The GPU examples never import this module. */
export async function mountSplat(context: ExamplesMountContext, streaming: boolean,
    start: (canvas: HTMLCanvasElement, options: StartSplatOptions) => Promise<SplatController | undefined>): Promise<ExamplesRuntime> {
    let active: SplatController | undefined;
    let panel: Panel | undefined;
    let disposed = false, starting = false, failed = false;
    const clear = () => { panel?.dispose(); panel = undefined; context.controlsHost.replaceChildren(); };
    function retry(error: Error) {
        if (disposed) return;
        failed = true;
        context.onError(error);
        clear(); context.controlsHost.hidden = false;
        panel = new Pane({ container: context.controlsHost }) as unknown as Panel;
        panel.addButton({ title: 'Retry loading' }).on('click', () => { void launch(); });
    }
    async function launch() {
        if (disposed || starting) return;
        starting = true; failed = false;
        active?.dispose(); active = undefined; clear();
        context.controlsHost.hidden = !streaming;
        context.onWarning?.(undefined);
        try {
            active = await start(context.canvas, {
                signal: context.signal, onFrame: context.onFrame, onLoading: context.onLoading,
                onWarning: context.onWarning, onReady: context.onReady, onError: retry,
            });
            if (disposed || context.signal?.aborted) { active?.dispose(); active = undefined; return; }
            if (active && !failed && streaming) {
                panel = new Pane({ container: context.controlsHost }) as unknown as Panel;
                const settings = { budget: 4 };
                panel.addBinding(settings, 'budget', { label: 'Splat Budget (M)', min: 0.5, max: 4, step: 0.5 })
                    .on('change', () => active?.setBudget?.(settings.budget * 1_000_000));
                panel.addButton({ title: 'Reset View' }).on('click', () => active?.resetView?.());
            }
        } catch (error) { if (!context.signal?.aborted) retry(error instanceof Error ? error : new Error(String(error))); }
        finally { starting = false; }
    }
    const dispose = () => {
        if (disposed) return;
        disposed = true; active?.dispose(); clear();
        context.signal?.removeEventListener('abort', dispose);
    };
    context.signal?.addEventListener('abort', dispose, { once: true });
    if (context.signal?.aborted) dispose(); else await launch();
    return { captureSnapshot: request => active?.captureSnapshot(request) ?? Promise.resolve(undefined), dispose };
}
