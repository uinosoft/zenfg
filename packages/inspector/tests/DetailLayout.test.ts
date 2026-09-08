import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { DetailLayout } from '../src/panelDetailLayout.ts';

function installDom(): Window {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'Event', window.Event);
	return window;
}

function createLayout(initialWidth = 1400) {
	let width = initialWidth;
	const host = document.createElement('div');
	const chrome = document.createElement('nav');
	const tab = document.createElement('button');
	tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'true');
	chrome.append(tab);
	const workspace = document.createElement('div');
	workspace.getBoundingClientRect = () => ({ width, height: 600, x: 0, y: 0, left: 0, right: width, top: 0, bottom: 600, toJSON: () => ({}) });
	const main = document.createElement('main');
	const aside = document.createElement('aside');
	aside.append(document.createElement('button'));
	workspace.append(main, aside); host.append(chrome, workspace); document.body.append(host);
	const layout = new DetailLayout(workspace, main, aside, chrome, () => layout.update(false));
	const divider = workspace.querySelector<HTMLElement>('[role="separator"]')!;
	const backdrop = workspace.querySelector<HTMLElement>('.zenfg-inspector-detail-backdrop')!;
	return {
		layout, workspace, main, aside, divider, backdrop,
		width: () => Number.parseFloat(workspace.style.getPropertyValue('--fgd-detail-width')),
		resize: (next: number) => { width = next; layout.update(true); },
		destroy: () => { layout.destroy(); host.remove(); },
	};
}

test('detail docking starts at 340px and keyboard endpoints respect the 300–480px range', () => {
	const window = installDom();
	const view = createLayout();
	try {
		view.layout.update(true);
		assert.equal(view.width(), 340);
		assert.equal(view.divider.hidden, false);
		assert.equal(view.divider.getAttribute('aria-valuenow'), '340');
		for (const [key, expected] of [['Home', 300], ['End', 480], ['ArrowRight', 460], ['ArrowLeft', 480]] as const) {
			const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			view.divider.dispatchEvent(event as unknown as KeyboardEvent);
			assert.equal(view.width(), expected);
			assert.equal(view.divider.getAttribute('aria-valuenow'), String(expected));
			assert.equal(event.defaultPrevented, true);
		}
		assert.equal(view.divider.getAttribute('aria-valuemin'), '300');
		assert.equal(view.divider.getAttribute('aria-valuemax'), '480');
	} finally { view.destroy(); window.close(); }
});

test('docking preserves 640px of main content and switches to a drawer below 948px', () => {
	const window = installDom();
	const view = createLayout(980);
	try {
		view.layout.update(true);
		assert.equal(view.width(), 332);
		assert.equal(980 - view.width() - 8, 640);
		assert.equal(view.divider.getAttribute('aria-valuemax'), '332');
		view.divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }) as unknown as KeyboardEvent);
		assert.equal(view.width(), 332);
		assert.equal(view.layout.isDrawer, false);
		view.resize(948);
		assert.equal(view.width(), 300);
		assert.equal(view.layout.isDrawer, false);
		assert.equal(view.divider.hidden, false);
		view.resize(947);
		assert.equal(view.layout.isDrawer, true);
		assert.equal(view.workspace.classList.contains('detail-drawer'), true);
		assert.equal(view.divider.hidden, true);
		assert.equal(view.backdrop.hidden, false);
		assert.equal(view.aside.getAttribute('aria-modal'), 'true');
		view.resize(1000);
		assert.equal(view.layout.isDrawer, false);
		assert.equal(view.backdrop.hidden, true);
		assert.equal(view.aside.hasAttribute('aria-modal'), false);
	} finally { view.destroy(); window.close(); }
});

test('detail width preferences belong to one layout instance', () => {
	const window = installDom();
	const first = createLayout();
	const second = createLayout();
	try {
		first.layout.update(true); second.layout.update(true);
		first.divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }) as unknown as KeyboardEvent);
		assert.equal(first.width(), 480);
		assert.equal(second.width(), 340);
		second.divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }) as unknown as KeyboardEvent);
		assert.equal(second.width(), 300);
		assert.equal(first.width(), 480);
		first.layout.update(false); first.layout.update(true);
		assert.equal(first.width(), 480);
	} finally { first.destroy(); second.destroy(); window.close(); }
});

test('pointer resizing clamps to the same bounds and stops after pointer release', () => {
	const window = installDom();
	const view = createLayout();
	try {
		const captured: number[] = [];
		view.divider.setPointerCapture = (id) => { captured.push(id); };
		view.layout.update(true);
		const pointer = (type: string, clientX: number) => view.divider.dispatchEvent(new window.PointerEvent(type, {
			pointerId: 7, clientX, bubbles: true, cancelable: true,
		}) as unknown as PointerEvent);
		pointer('pointerdown', 1060);
		assert.deepEqual(captured, [7]);
		pointer('pointermove', 700);
		assert.equal(view.width(), 480);
		pointer('pointermove', 1300);
		assert.equal(view.width(), 300);
		view.resize(980);
		pointer('pointermove', 0);
		assert.equal(view.width(), 332);
		assert.equal(view.divider.getAttribute('aria-valuenow'), '332');
		pointer('pointerup', 0);
		pointer('pointermove', 980);
		assert.equal(view.width(), 332);
	} finally { view.destroy(); window.close(); }
});
