import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { FrameGraphInspector } from '../src/FrameGraphInspector.ts';
import { DetailLayout } from '../src/panelDetailLayout.ts';

function fixture(name = 'full-webgpu'): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve(`packages/snapshot/fixtures/${name}.fgsnapshot.json`), 'utf8')) as FrameGraphSnapshot;
}

function installDom(): Window {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'navigator', window.navigator);
	Reflect.set(globalThis, 'Event', window.Event);
	Reflect.set(globalThis, 'HTMLElement', window.HTMLElement);
	return window;
}

function mount(): FrameGraphInspector {
	const panel = new FrameGraphInspector({ maxGraphElements: 1 });
	document.body.appendChild(panel.dom);
	return panel;
}

function element<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
	const found = root.querySelector<T>(selector);
	assert.ok(found, `Missing ${selector}`);
	return found;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === text);
	assert.ok(found, `Missing button ${text}`);
	return found;
}

function tabs(panel: FrameGraphInspector): HTMLElement { return element(panel.dom, '.zenfg-inspector-workbench-tabs'); }
function aside(panel: FrameGraphInspector): HTMLElement { return element(panel.dom, '.zenfg-inspector-inspector'); }

function trackedSnapshot(state: 'retained' | 'culled' | 'missing', reverse = false): FrameGraphSnapshot {
	const source = fixture('minimal');
	const tracked: FrameGraphSnapshot['graph']['nodes'][number] = {
		id: 'node:tracked', recordingOrder: 0, kind: 'compute', label: 'Tracked', sideEffect: false,
		compileState: state === 'retained' ? { status: 'retained', executionOrder: 0 } : { status: 'culled', reason: 'no-longer-reachable' },
	};
	const other: FrameGraphSnapshot['graph']['nodes'][number] = {
		id: 'node:other', recordingOrder: 1, kind: 'compute', label: 'Other', sideEffect: false,
		compileState: { status: 'retained', executionOrder: state === 'retained' ? 1 : 0 },
	};
	const nodes = (state === 'missing' ? [other] : reverse ? [other, tracked] : [tracked, other])
		.map((node, recordingOrder) => ({ ...node, recordingOrder }));
	return { ...source, graph: { ...source.graph, nodes, segments: [{ id: 'segment:work', order: 0, kind: 'frame-graph',
		nodeIds: state === 'retained' ? ['node:tracked', 'node:other'] : ['node:other'],
	}] } };
}

test('Export keyboard navigation and item actions return focus to the visible trigger', async () => {
	const window = installDom();
	const panel = mount();
	let finishCopy: (() => void) | undefined;
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
		writeText: () => new Promise<void>(resolve => { finishCopy = resolve; }),
	} });
	try {
		panel.setSnapshot(fixture());
		const trigger = element<HTMLButtonElement>(panel.dom, '.zenfg-inspector-export-action');
		const menu = element(panel.dom, '.zenfg-inspector-export-menu');
		const download = element<HTMLButtonElement>(menu, '.zenfg-inspector-download-action');
		const copy = element<HTMLButtonElement>(menu, '.zenfg-inspector-copy-action');
		trigger.focus(); trigger.click();
		assert.equal(menu.hidden, false);
		assert.equal(document.activeElement === download, true, "Expected focus on download");
		for (const [key, target] of [['ArrowDown', copy], ['ArrowUp', download], ['End', copy], ['Home', download]] as const) {
			const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			document.activeElement!.dispatchEvent(event as unknown as KeyboardEvent);
			assert.equal(event.defaultPrevented, true);
			assert.equal(document.activeElement === target, true, "Expected focus on target");
		}
		download.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }) as unknown as KeyboardEvent);
		assert.equal(menu.hidden, true);
		assert.equal(document.activeElement === trigger, true, "Expected focus on trigger");
		let downloads = 0;
		panel.downloadSnapshot = () => { downloads++; assert.equal(document.activeElement === trigger, true, "Expected focus on trigger"); };
		trigger.click(); download.click();
		assert.equal(downloads, 1);
		assert.equal(menu.hidden, true);
		assert.equal(document.activeElement === trigger, true, "Expected focus on trigger");
		trigger.click(); copy.focus(); copy.click();
		assert.equal(menu.hidden, true);
		assert.equal(document.activeElement === trigger, true, "Expected focus on trigger");
		assert.equal(copy.disabled, true, 'Copy remains busy after the menu closes');
		assert.equal(copy.getAttribute('aria-busy'), 'true');
	} finally {
		panel.destroy();
		finishCopy?.();
		await Promise.resolve();
		window.close();
	}
});

test('Export dismisses on keyboard focus and outside clicks without stealing the destination focus', () => {
	const window = installDom();
	const panel = mount();
	const outside = document.createElement('button');
	document.body.append(outside);
	try {
		panel.setSnapshot(fixture());
		button(tabs(panel), 'Passes').click();
		const search = element<HTMLInputElement>(panel.dom, 'input[aria-label="Search pass, ID or group"]');
		const trigger = element<HTMLButtonElement>(panel.dom, '.zenfg-inspector-export-action');
		const menu = element(panel.dom, '.zenfg-inspector-export-menu');
		trigger.click();
		element<HTMLButtonElement>(menu, '.zenfg-inspector-copy-action').focus();
		assert.equal(menu.hidden, false, 'Moving between menu items keeps the menu open');
		search.focus();
		assert.equal(menu.hidden, true);
		assert.equal(trigger.getAttribute('aria-expanded'), 'false');
		for (const key of ['End', 'Home', 'ArrowUp', 'ArrowDown']) {
			const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			search.dispatchEvent(event as unknown as KeyboardEvent);
			assert.equal(event.defaultPrevented, false, `${key} belongs to the focused input`);
			assert.equal(document.activeElement === search, true, "Expected focus on search");
		}
		trigger.click(); outside.focus();
		assert.equal(menu.hidden, true);
		assert.equal(document.activeElement === outside, true, "Expected focus on outside");
		trigger.click(); document.body.click();
		assert.equal(menu.hidden, true, 'Clicks outside the entire embedded Inspector dismiss Export');
	} finally { panel.destroy(); outside.remove(); window.close(); }
});

test('Export listeners isolate embedded instances and are removed on destroy', () => {
	const window = installDom();
	const first = mount();
	const second = mount();
	const outside = document.createElement('button');
	document.body.append(outside);
	try {
		first.setSnapshot(fixture()); second.setSnapshot(fixture());
		const firstTrigger = element<HTMLButtonElement>(first.dom, '.zenfg-inspector-export-action');
		const firstMenu = element(first.dom, '.zenfg-inspector-export-menu');
		const secondTrigger = element<HTMLButtonElement>(second.dom, '.zenfg-inspector-export-action');
		const secondMenu = element(second.dom, '.zenfg-inspector-export-menu');
		firstTrigger.click();
		assert.equal(firstMenu.hidden, false);
		assert.equal(secondMenu.hidden, true);
		secondTrigger.click();
		assert.equal(firstMenu.hidden, true);
		assert.equal(secondMenu.hidden, false);
		first.destroy();
		assert.equal(secondMenu.hidden, false, 'Destroying a peer leaves the active menu alone');
		second.destroy();
		secondMenu.hidden = false;
		outside.focus(); outside.click();
		assert.equal(secondMenu.hidden, false, 'Detached menu is no longer reached by document listeners');
	} finally { first.destroy(); second.destroy(); outside.remove(); window.close(); }
});

test('workbench first snapshot opens Graph with no selection or detail panel', () => {
	const window = installDom();
	const panel = mount();
	try {
		panel.setSnapshot(fixture());
		assert.equal(button(tabs(panel), 'Graph').getAttribute('aria-selected'), 'true');
		assert.equal(aside(panel).hidden, true);
		assert.equal(element(panel.dom, '.zenfg-inspector-workspace').classList.contains('inspector-open'), false);
		assert.equal(element<HTMLButtonElement>(panel.dom, '.zenfg-inspector-open-inspector').hidden, true);
		assert.equal(panel.dom.querySelector('[data-selection].selected'), null);
		assert.equal(panel.dom.querySelector('.zenfg-inspector-capture-context'), null);
		button(tabs(panel), 'Overview').click();
		assert.match(element(panel.dom, '.zenfg-inspector-capture-details').textContent!, /Frame42.*2026-06-15/);
	} finally { panel.destroy(); window.close(); }
});

test('refresh preserves a selected pass by ID across reorder, compile state changes and removal', () => {
	const window = installDom();
	const panel = mount();
	try {
		panel.setSnapshot(trackedSnapshot('retained'));
		button(tabs(panel), 'Passes').click();
		button(element(panel.dom, '.zenfg-inspector-passes-view'), 'Tracked').click();
		assert.equal(aside(panel).hidden, false);
		panel.setSnapshot(trackedSnapshot('retained', true));
		assert.equal(element(aside(panel), 'header strong').textContent, 'Tracked');
		assert.match(aside(panel).textContent!, /Compile stateRetained/);
		panel.setSnapshot(trackedSnapshot('culled', true));
		assert.equal(element(aside(panel), 'header strong').textContent, 'Tracked (culled)');
		assert.match(aside(panel).textContent!, /no-longer-reachable/);
		assert.equal(button(tabs(panel), 'Passes').getAttribute('aria-selected'), 'true');
		panel.setSnapshot(trackedSnapshot('retained'));
		assert.equal(element(aside(panel), 'header strong').textContent, 'Tracked');
		panel.setSnapshot(trackedSnapshot('missing'));
		assert.equal(aside(panel).hidden, true);
		assert.equal(element<HTMLButtonElement>(panel.dom, '.zenfg-inspector-open-inspector').hidden, true);
		assert.equal(panel.dom.querySelector('.zenfg-inspector-passes-view tr.selected'), null);
	} finally { panel.destroy(); window.close(); }
});

test('Overview uses full width while retaining selection and detail open preference', () => {
	const window = installDom();
	const panel = mount();
	try {
		panel.setSnapshot(fixture());
		button(tabs(panel), 'Passes').click();
		button(element(panel.dom, '.zenfg-inspector-passes-view'), 'scene').click();
		const workspace = element(panel.dom, '.zenfg-inspector-workspace');
		assert.equal(workspace.classList.contains('inspector-open'), true);
		button(tabs(panel), 'Overview').click();
		assert.equal(workspace.classList.contains('inspector-open'), false);
		assert.equal(aside(panel).classList.contains('unavailable'), true);
		button(tabs(panel), 'Passes').click();
		assert.equal(workspace.classList.contains('inspector-open'), true);
		assert.equal(element(aside(panel), 'header strong').textContent, 'scene');
	} finally { panel.destroy(); window.close(); }
});

test('Overview pass shortcuts clear filters, return to the list and preserve pass sorting', () => {
	const window = installDom();
	const panel = mount();
	try {
		panel.setSnapshot(fixture());
		button(tabs(panel), 'Passes').click();
		const passes = element(panel.dom, '.zenfg-inspector-passes-view');
		const search = element<HTMLInputElement>(passes, 'input[aria-label="Search pass, ID or group"]');
		const kind = element<HTMLSelectElement>(passes, 'select[aria-label="Pass kind"]');
		const state = element<HTMLSelectElement>(passes, 'select[aria-label="Pass compile state"]');
		const sort = element<HTMLSelectElement>(passes, 'select[aria-label="Sort passes"]');
		const filterToCulled = () => {
			search.value = 'unused'; search.dispatchEvent(new Event('input'));
			kind.value = 'compute'; kind.dispatchEvent(new Event('change'));
			state.value = 'culled'; state.dispatchEvent(new Event('change'));
		};
		const assertUnfiltered = () => {
			assert.equal(button(tabs(panel), 'Passes').getAttribute('aria-selected'), 'true');
			assert.equal(button(passes, 'Pass List').getAttribute('aria-selected'), 'true');
			assert.equal(search.value, ''); assert.equal(kind.value, 'all'); assert.equal(state.value, 'all');
			assert.equal(sort.value, 'cpu');
			assert.equal(passes.querySelectorAll('[id$="pass-list-panel"] tbody tr[data-selection-key]').length, 4);
		};
		sort.value = 'cpu'; sort.dispatchEvent(new Event('change'));
		filterToCulled();
		button(passes, 'Group Hierarchy').click();
		button(tabs(panel), 'Overview').click();
		const overview = element(panel.dom, '.zenfg-inspector-overview-view');
		button(overview, 'View all passes').click();
		assertUnfiltered();
		assert.equal(aside(panel).hidden, true);
		filterToCulled();
		button(tabs(panel), 'Overview').click();
		button(overview, 'scene').click();
		assertUnfiltered();
		assert.equal(aside(panel).hidden, false);
		assert.equal(element(aside(panel), 'header strong').textContent, 'scene');
		assert.ok(button(passes, 'scene').closest('tr')?.classList.contains('selected'));
	} finally { panel.destroy(); window.close(); }
});

test('nonactive pages render on demand and retain old DOM until activated after capture', () => {
	const window = installDom();
	const panel = mount();
	try {
		const source = fixture();
		panel.setSnapshot(source);
		const memory = element(panel.dom, '.zenfg-inspector-memory-view');
		assert.equal(memory.querySelector('.zenfg-inspector-memory-resource'), null);
		assert.equal(panel.dom.querySelector('.zenfg-inspector-passes-view tbody tr'), null);
		button(tabs(panel), 'Memory').click();
		const row = element(memory, '.zenfg-inspector-memory-resource');
		assert.match(row.textContent!, /scene-color/);
		button(tabs(panel), 'Passes').click();
		panel.setSnapshot({ ...source, capture: { ...source.capture, frameIndex: 43 }, graph: { ...source.graph,
			resources: source.graph.resources.map((resource) => resource.id === 'resource:scene-color' ? { ...resource, label: 'Renamed scene buffer' } : resource),
		} });
		assert.strictEqual(memory.querySelector('.zenfg-inspector-memory-resource'), row);
		assert.doesNotMatch(memory.textContent!, /Renamed scene buffer/);
		button(tabs(panel), 'Memory').click();
		assert.notStrictEqual(memory.querySelector('.zenfg-inspector-memory-resource'), row);
		assert.match(memory.textContent!, /Renamed scene buffer/);
	} finally { panel.destroy(); window.close(); }
});

test('ordinary relation selection preserves list filters, explicit locate clears them and reveals the target', () => {
	const window = installDom();
	const panel = mount();
	try {
		panel.setSnapshot(fixture());
		button(tabs(panel), 'Passes').click();
		const passes = element(panel.dom, '.zenfg-inspector-passes-view');
		const search = element<HTMLInputElement>(passes, 'input[aria-label="Search pass, ID or group"]');
		search.value = 'scene'; search.dispatchEvent(new Event('input', { bubbles: true }));
		button(passes, 'scene').click();
		button(aside(panel), 'Relations').click();
		button(aside(panel), 'present').click();
		assert.equal(search.value, 'scene');
		assert.equal(button(tabs(panel), 'Passes').getAttribute('aria-selected'), 'true');
		assert.equal(element(aside(panel), 'header strong').textContent, 'present');
		assert.equal([...passes.querySelectorAll('tbody button')].some((candidate) => candidate.textContent === 'present'), false);
		button(aside(panel), 'Locate in Passes').click();
		assert.equal(search.value, '');
		assert.ok(button(passes, 'present').closest('tr')?.classList.contains('selected'));
	} finally { panel.destroy(); window.close(); }
});

test('Escape closes the inner export menu before detail and never reaches an outer panel handler', () => {
	const window = installDom();
	const panel = mount();
	try {
		panel.setSnapshot(fixture());
		button(tabs(panel), 'Passes').click();
		button(element(panel.dom, '.zenfg-inspector-passes-view'), 'scene').click();
		const exportButton = element<HTMLButtonElement>(panel.dom, '[aria-haspopup="menu"]');
		exportButton.click();
		const menu = element(panel.dom, '.zenfg-inspector-export-menu');
		assert.equal(menu.hidden, false);
		let escaped = 0;
		panel.dom.addEventListener('keydown', () => { escaped++; });
		const menuEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		menu.dispatchEvent(menuEscape as unknown as KeyboardEvent);
		assert.equal(menu.hidden, true);
		assert.equal(menuEscape.defaultPrevented, true);
		assert.equal(aside(panel).hidden, false);
		assert.equal(escaped, 0);
		const detailEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		button(aside(panel), 'Summary').dispatchEvent(detailEscape as unknown as KeyboardEvent);
		assert.equal(aside(panel).hidden, true);
		assert.equal(detailEscape.defaultPrevented, true);
		assert.equal(escaped, 0);
	} finally { panel.destroy(); window.close(); }
});

test('drawer reveal to another page closes onto that page tab instead of a now-hidden original row', () => {
	const window = installDom();
	const panel = mount();
	try {
		const workspace = element(panel.dom, '.zenfg-inspector-workspace');
		workspace.getBoundingClientRect = () => ({ width: 800, height: 600, x: 0, y: 0, left: 0, right: 800, top: 0, bottom: 600, toJSON: () => ({}) });
		panel.setSnapshot(fixture());
		button(tabs(panel), 'Resources').click();
		const original = button(element(panel.dom, '.zenfg-inspector-resources-view'), 'scene-color');
		original.focus(); original.click();
		assert.equal(aside(panel).getAttribute('aria-modal'), 'true');
		assert.equal(element(panel.dom, '.zenfg-inspector-main').inert, true);
		button(aside(panel), 'Locate in Memory').click();
		assert.equal(aside(panel).hidden, true);
		assert.ok(original.closest('[hidden]'));
		assert.strictEqual(document.activeElement, button(tabs(panel), 'Memory'));
		assert.equal(element(panel.dom, '.zenfg-inspector-main').inert, false);
	} finally { panel.destroy(); window.close(); }
});

test('drawer closing and destruction restore an available origin or the current tab', () => {
	const window = installDom();
	try {
		for (const finish of ['close', 'destroy'] as const) {
			for (const originState of ['visible', 'hidden', 'inert', 'removed'] as const) {
				const host = document.createElement('div');
				const chrome = document.createElement('nav');
				const currentTab = document.createElement('button');
				currentTab.setAttribute('role', 'tab'); currentTab.setAttribute('aria-selected', 'true');
				chrome.appendChild(currentTab);
				const workspace = document.createElement('div');
				workspace.getBoundingClientRect = () => ({ width: 800, height: 600, x: 0, y: 0, left: 0, right: 800, top: 0, bottom: 600, toJSON: () => ({}) });
				const main = document.createElement('main');
				const originContainer = document.createElement('div');
				const origin = document.createElement('button');
				originContainer.append(origin); main.append(originContainer);
				const detail = document.createElement('aside');
				const close = document.createElement('button'); detail.append(close);
				workspace.append(main, detail); host.append(chrome, workspace); document.body.append(host);
				const layout = new DetailLayout(workspace, main, detail, chrome, () => layout.update(false));
				origin.focus(); layout.update(true);
				assert.strictEqual(document.activeElement, close);
				if (originState === 'hidden') originContainer.hidden = true;
				else if (originState === 'inert') originContainer.inert = true;
				else if (originState === 'removed') originContainer.remove();
				if (finish === 'close') layout.update(false);
				else layout.destroy();
				assert.strictEqual(document.activeElement, originState === 'visible' ? origin : currentTab, `${finish}: ${originState}`);
				assert.equal(main.inert, false); assert.equal(chrome.inert, false);
				layout.destroy(); host.remove();
			}
		}
	} finally { window.close(); }
});
