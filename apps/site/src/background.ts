import type { ThemeMode } from '../shared/theme/index.ts';

type BackgroundInstance = { dispose(): void };
interface BackgroundCallbacks { onReady(): void; onError(error: unknown): void }
interface HomeBackgroundOptions {
	start(callbacks: BackgroundCallbacks): Promise<BackgroundInstance | undefined>;
	onReady(ready: boolean): void;
	onError(error: unknown): void;
}

/** Serializes canvas ownership, including startup that outlives a theme change or page. */
export function createHomeBackground(options: HomeBackgroundOptions) {
	let mode: ThemeMode = 'light';
	let disposed = false;
	let generation = 0;
	let pending = false;
	let instance: BackgroundInstance | undefined;

	async function start(): Promise<void> {
		if (disposed || mode !== 'dark' || pending || instance) return;
		pending = true;
		const request = generation;
		let failed = false;
		const current = () => !disposed && mode === 'dark' && request === generation;
		const fail = (error: unknown) => {
			failed = true;
			if (current()) {
				instance?.dispose();
				instance = undefined;
				options.onReady(false);
				options.onError(error);
			}
		};
		try {
			const controller = await options.start({
				onReady: () => { if (current() && !failed) options.onReady(true); },
				onError: fail,
			});
			if (!current() || failed) controller?.dispose();
			else instance = controller;
		} catch (error) { fail(error); }
		finally {
			pending = false;
			// Retry only when a newer dark request superseded this one, never in an error loop.
			if (request !== generation) void start();
		}
	}
	return {
		setTheme(next: ThemeMode): void {
			if (disposed || mode === next) return;
			mode = next;
			generation++;
			options.onReady(false);
			instance?.dispose();
			instance = undefined;
			if (mode === 'dark') void start();
		},
		destroy(): void {
			if (disposed) return;
			disposed = true;
			generation++;
			options.onReady(false);
			instance?.dispose();
			instance = undefined;
		},
	};
}
