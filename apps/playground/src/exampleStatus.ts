import { createFrameRate } from './frameRate.ts';

export type ExampleStatus = 'loading' | 'ready' | 'error';

/** Page-owned runtime feedback; independent from Inspector diagnostics and themes. */
export function createExampleStatus(options: {
	root: HTMLElement;
	status: HTMLElement;
	label: HTMLElement;
	signal: HTMLElement;
	feedback: HTMLElement;
	fps?: HTMLElement;
	readyState: 'live' | 'ready';
	loadingNote?: string;
}) {
	let state: ExampleStatus = 'loading';
	let message = '';
	let warning: string | undefined;
	let paused = false;
	let suspended = false;
	const frameRate = createFrameRate();
	const canMeasure = () => state === 'ready' && options.readyState === 'live' && !paused && !suspended;
	function showFps(value?: number): void {
		if (!options.fps) return;
		options.fps.hidden = value === undefined;
		options.fps.textContent = value === undefined ? '' : `${value} FPS`;
	}
	function resetFps(): void { frameRate.reset(); showFps(); }
	function render(): void {
		options.root.dataset.effectState = state;
		if (state === 'ready') options.root.dataset.hasFrame = 'true';
		options.status.dataset.state = state;
		options.status.dataset.paused = String(paused);
		options.status.dataset.warning = String(!!warning);
		const baseLabel = state === 'ready' ? (paused ? 'Paused' : options.readyState === 'live' ? 'Live' : 'Ready')
			: state === 'loading' ? 'Loading…' : 'Error';
		options.label.textContent = baseLabel + (warning ? ' · Warning' : '');
		options.signal.textContent = state === 'error' || warning ? '!' : '';
		const detail = state === 'ready' ? (warning ?? '')
			: state === 'loading' ? [message, options.loadingNote, warning].filter(Boolean).join(' ') : message;
		options.feedback.dataset.state = warning ? 'warning' : state;
		options.feedback.setAttribute('role', state === 'error' ? 'alert' : 'status');
		options.feedback.textContent = detail;
		options.feedback.hidden = !detail;
	}
	return {
		update(nextState: ExampleStatus, nextMessage = '') {
			state = nextState;
			message = nextMessage;
			if (nextState !== 'ready') warning = undefined;
			resetFps();
			render();
		},
		frame(now: number) { if (canMeasure()) frameRate.record(now); },
		tick(now: number) { showFps(canMeasure() ? frameRate.sample(now) : undefined); },
		pause(value: boolean) { if (paused === value) return; paused = value; resetFps(); render(); },
		suspend(value: boolean) { if (suspended === value) return; suspended = value; resetFps(); },
		warn(nextWarning?: string) {
			if (state === 'error') return;
			warning = nextWarning;
			render();
		},
	};
}
