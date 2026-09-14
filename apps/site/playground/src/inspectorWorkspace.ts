import type { PlaygroundRuntime } from './types.ts';

/** Lazy Inspector initialization shares the page's runtime cancellation signal. */
export async function initializeInspectorWorkspace(options: {
    readonly signal: AbortSignal;
    readonly loading: HTMLElement;
    readonly runtime: Promise<PlaygroundRuntime | undefined>;
    readonly load: () => Promise<(runtime: PlaygroundRuntime) => void>;
}): Promise<void> {
    const { signal, loading } = options;
    if (signal.aborted) return;
    loading.hidden = false;
    loading.textContent = 'Waiting for the live example…';
    const mounted = await options.runtime;
    if (signal.aborted) return;
    if (!mounted) {
        loading.textContent = 'Live capture is unavailable because WebGPU could not start. The source remains available in Code.';
        return;
    }
    loading.textContent = 'Loading FrameGraph Inspector…';
    try {
        const mount = await options.load();
        if (signal.aborted) return;
        mount(mounted);
        loading.hidden = true;
    } catch (error) {
        if (signal.aborted) return;
        loading.textContent = `Could not load the Inspector: ${error instanceof Error ? error.message : String(error)}`;
    }
}
