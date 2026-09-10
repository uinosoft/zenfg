import { Pane } from 'tweakpane';

/** Page-owned, titleless monitor. Sampling remains owned by the runtime status. */
export function createFrameRateMonitor(container: HTMLElement) {
	const pane = new Pane({ container });
	const values = { fps: Number.NaN };
	// Tweakpane ships without its inherited @tweakpane/core declarations.
	const controls = pane as unknown as {
		addBinding(object: object, key: string, options: object): { refresh(): void; element: HTMLElement };
	};
	const binding = controls.addBinding(values, 'fps', {
		label: 'FPS', readonly: true, interval: 0,
		format: (value: number) => Number.isFinite(value) ? String(value) : '—',
	});
	const input = binding.element.querySelector('input')!;
	input.dataset.frameRate = '';
	input.setAttribute('aria-label', 'Average rendered frames per second over 500 milliseconds');
	input.title = 'Average FPS · 500ms window';
	type GraphBinding = ReturnType<typeof controls.addBinding> & {
		max: number;
		// Tweakpane 4's monitor buffer: clear the constructor's initial sample.
		controller: { value: { rawValue: (number | undefined)[] } };
	};
	const history = { fps: 0 };
	const graph = controls.addBinding(history, 'fps', {
		label: '', readonly: true, view: 'graph', interval: 0, bufferSize: 120,
		min: 0, max: 120, rows: 1.5,
		format: (sample: number) => sample + ' FPS',
	}) as GraphBinding;
	graph.controller.value.rawValue = Array.from({ length: 120 }, () => undefined);
	const svg = graph.element.querySelector('svg')!;
	svg.dataset.frameRateHistory = '';
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', 'FPS trend: latest 120 rendered frame intervals');
	// Native graph coordinates normally redraw on samples. Resize frozen history too,
	// without refresh(), which would append a fake sample while paused or idle.
	const resizeObserver = new ResizeObserver(() => {
		graph.controller.value.rawValue = [...graph.controller.value.rawValue];
	});
	resizeObserver.observe(svg);
	return {
		update(value?: number): void {
			values.fps = value ?? Number.NaN;
			binding.refresh();
		},
		record(value: number): void {
			if (!Number.isFinite(value)) return;
			history.fps = value;
			graph.max = Math.max(graph.max, Math.ceil(value * 1.1 / 60) * 60);
			graph.refresh();
		},
		dispose(): void { resizeObserver.disconnect(); pane.dispose(); },
	};
}
