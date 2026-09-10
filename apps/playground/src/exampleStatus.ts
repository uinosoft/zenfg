import { createIcon } from './icons.ts';
import { createFrameRate } from './frameRate.ts';

export type ExampleStatus = 'loading' | 'ready' | 'error';

/** Page-owned runtime feedback; independent from Inspector diagnostics and themes. */
export function createExampleStatus(options: {
	root: HTMLElement;
	status: HTMLElement;
	label: HTMLElement;
	signal: HTMLElement;
	feedback: HTMLElement;
	preview: HTMLElement;
	onFrameRate?: (value?: number) => void;
	onFrameSample?: (value: number) => void;
	readyState: 'live' | 'ready';
	loadingNote?: string;
}) {
	let state: ExampleStatus = 'loading';
	let output: string | undefined;
	let message = '';
	let warning: string | undefined;
	let paused = false;
	let suspended = false;
	const frameRate = createFrameRate();
	const canMeasure = () => state === 'ready' && options.readyState === 'live' && !paused && !suspended;
	function showFps(value?: number): void {
		options.onFrameRate?.(value);
	}
	function resetFps(): void { frameRate.reset(); showFps(); }
	function render(): void {
		options.root.dataset.effectState = state;
		if (state === 'ready') options.root.dataset.hasFrame = 'true';
		options.status.dataset.state = state;
		options.status.dataset.paused = String(paused);
		options.status.dataset.warning = String(!!warning);
		options.status.hidden = state === 'ready' && !paused && !warning && !output;
		const baseLabel = state === 'ready' ? (paused ? 'Paused' : options.readyState === 'live' ? 'Live' : 'Ready')
			: state === 'loading' ? 'Loading…' : 'Error';
		options.label.textContent = baseLabel + (warning ? ' · Warning' : '');
		options.signal.replaceChildren(createIcon(options.signal.ownerDocument, state === 'error' ? 'error' : warning ? 'warning' : state === 'loading' ? 'loading' : paused ? 'pause' : 'check'));
		const detail = state === 'ready' ? [warning, output].filter(Boolean).join('\n\n')
			: state === 'loading' ? [message, options.loadingNote, warning].filter(Boolean).join(' ') : message;
		options.feedback.dataset.state = warning ? 'warning' : state;
		options.feedback.setAttribute('role', state === 'error' ? 'alert' : 'status');
		options.feedback.textContent = detail;
		options.preview.setAttribute('role', state === 'error' ? 'alert' : 'status');
		options.preview.textContent = detail;
		options.preview.hidden = !detail;
		options.status.dataset.hasDetail = String(!!detail);
		options.feedback.hidden = !detail;
	}
	return {
		update(nextState: ExampleStatus, nextMessage = '') {
			if (state !== nextState) {
				options.status.removeAttribute('open');
				if (nextState !== 'ready') warning = undefined;
			}
			state = nextState;
			if (nextState !== 'ready') output = undefined;
			message = nextMessage;
			resetFps();
			render();
		},
		frame(now: number) {
			if (!canMeasure()) return;
			const value = frameRate.record(now);
			if (value !== undefined) options.onFrameSample?.(value);
		},
		// Only the readable average uses the timer; the graph still samples every frame.
		tick(now: number) { showFps(canMeasure() ? frameRate.sample(now) : undefined); },
		pause(value: boolean) { if (paused === value) return; paused = value; resetFps(); render(); },
		suspend(value: boolean) { if (suspended === value) return; suspended = value; resetFps(); },
		output(value?: string) { output = value; render(); },
		warn(nextWarning?: string) {
			if (state === 'error') return;
			warning = nextWarning;
			render();
		},
	};
}
