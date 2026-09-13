import type { ThemeMode } from '../shared/theme/index.ts';

type BackgroundInstance = { setTheme(theme: ThemeMode): void; setActive(active: boolean): void; dispose(): void };
interface BackgroundCallbacks { onReady(): void; onError(error: unknown): void }
interface HomeBackgroundOptions {
	start(theme: ThemeMode, callbacks: BackgroundCallbacks): Promise<BackgroundInstance | undefined>;
	onReady(ready: boolean): void;
	onError(error: unknown): void;
}

/** Own one device across theme changes, including changes during asynchronous startup. */
export function createHomeBackground(options: HomeBackgroundOptions) {
	let mode: ThemeMode = 'dark';
	let started = false;
	let disposed = false;
	let failed = false;
	let active = true;
	let ready = false;
	let instance: BackgroundInstance | undefined;
	const fail = (error: unknown) => {
		if (disposed || failed) return;
		failed = true;
		instance?.dispose();
		instance = undefined;
		options.onReady(false);
		options.onError(error);
	};
	async function start(): Promise<void> {
		started = true;
		options.onReady(false);
		try {
			const controller = await options.start(mode, {
				onReady: () => { ready = true; if (!disposed && !failed && instance) options.onReady(true); },
				onError: fail,
			});
			if (disposed || failed) { controller?.dispose(); return; }
			instance = controller;
			controller?.setTheme(mode);
			controller?.setActive(active);
			if (controller && ready) options.onReady(true);
		} catch (error) { fail(error); }
	}
	return {
		setTheme(next: ThemeMode): void {
			if (disposed) return;
			mode = next;
			instance?.setTheme(next);
			if (!started) void start();
		},
		setActive(next: boolean): void { active = next; instance?.setActive(next); },
		destroy(): void {
			if (disposed) return;
			disposed = true;
			options.onReady(false);
			instance?.dispose();
			instance = undefined;
		},
	};
}
