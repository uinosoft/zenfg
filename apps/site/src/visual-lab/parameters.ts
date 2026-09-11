import { Pane } from 'tweakpane';

export function mountParameters(root: HTMLElement): () => void {
	const settings = { instances: 2048, culling: true, depth: 'Reverse Z' };
	const defaults = { ...settings };
	const pane = new Pane({ container: root.querySelector<HTMLElement>('#parameter-pane')! });
	// The published Tweakpane package does not include @tweakpane/core types.
	const controls = pane as unknown as {
		addBinding(target: object, key: string, options?: object): void;
		addButton(options: { title: string }): { on(event: 'click', handler: () => void): void };
		on(event: 'change', handler: () => void): void;
		refresh(): void;
	};
	controls.addBinding(settings, 'instances', { label: 'Instances', min: 0, max: 10000, step: 1 });
	controls.addBinding(settings, 'culling', { label: 'Culling' });
	controls.addBinding(settings, 'depth', { label: 'Depth', options: { 'Reverse Z': 'Reverse Z', 'Forward Z': 'Forward Z' } });
	const update = (): void => {
		root.querySelector<HTMLOutputElement>('#parameter-summary')!.value = `${settings.instances.toLocaleString('en-US')} instances · Culling ${settings.culling ? 'on' : 'off'} · ${settings.depth}`;
		root.querySelector('.tp-sldv_t')?.setAttribute('aria-valuenow', String(settings.instances));
	};
	controls.on('change', update);
	controls.addButton({ title: 'Reset parameters' }).on('click', () => { Object.assign(settings, defaults); controls.refresh(); update(); });
	for (const [index, row] of Array.from(root.querySelectorAll('#parameter-pane .tp-lblv')).entries()) {
		const label = row.querySelector<HTMLElement>('.tp-lblv_l');
		if (!label?.textContent) continue;
		label.id = `sample-parameter-${index}`;
		for (const input of row.querySelectorAll('input, select, .tp-sldv_t')) input.setAttribute('aria-labelledby', label.id);
	}
	const slider = root.querySelector('.tp-sldv_t')!;
	slider.setAttribute('role', 'slider');
	slider.setAttribute('aria-valuemin', '0');
	slider.setAttribute('aria-valuemax', '10000');
	update();
	return () => pane.dispose();
}
