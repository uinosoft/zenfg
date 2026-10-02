import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { GraphSearch } from '../src/panelGraphSearch.ts';
import type { Selection } from '../src/panelTypes.ts';

function fixture(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8'));
}

function mount(source = fixture()) {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'Event', window.Event);
	Reflect.set(globalThis, 'KeyboardEvent', window.KeyboardEvent);
	Reflect.set(globalThis, 'MouseEvent', window.MouseEvent);
	Reflect.set(globalThis, 'PointerEvent', window.PointerEvent);
	const reveals: Selection[] = [];
	const view = new GraphSearch((selection) => reveals.push(selection), 'test-search');
	document.body.append(view.root);
	view.setSnapshot(createDebugViewModel(source));
	const toggle = view.root.querySelector<HTMLButtonElement>('button[aria-controls="test-search"]')!;
	const input = view.root.querySelector<HTMLInputElement>('input')!;
	const popover = view.root.querySelector<HTMLElement>('.zenfg-inspector-graph-search-popover')!;
	const rows = () => [...view.root.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-graph-search-results > button')];
	const query = (value: string) => {
		if (popover.hidden) toggle.click();
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const key = (key: string) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	return { window, view, toggle, input, popover, rows, query, key, reveals,
		close: () => { view.destroy(); window.close(); } };
}

function namedNodes(labels: readonly string[]): FrameGraphSnapshot {
	const base = fixture();
	return { ...base, graph: { ...base.graph, groups: [], resources: [], roots: [], accesses: [], dependencies: [],
		segments: [], nodes: labels.map((label, index) => ({
			id: `node:${index}`, label, kind: 'command', sideEffect: true, recordingOrder: index,
			compileState: { status: 'retained', executionOrder: index },
		})),
	} };
}

test('Graph search separates names from type, ID and group context for actual snapshot entries', (t) => {
	const env = mount(); t.after(env.close);
	env.query('node:present');
	const pass = env.rows()[0]!;
	assert.equal(pass.querySelector('.zenfg-inspector-graph-search-label')!.textContent, 'present');
	assert.equal(pass.querySelector('.zenfg-inspector-graph-search-metadata')!.textContent, 'Pass · Render · node:present');
	assert.equal(pass.querySelector('.zenfg-inspector-graph-search-path')!.textContent, 'Main / PostFX');
	assert.equal(pass.dataset.selectionKind, 'node');
	assert.equal(pass.dataset.selectionId, 'node:present');
	assert.equal(env.toggle.querySelector('svg')!.getAttribute('aria-hidden'), 'true');
	assert.equal(env.toggle.getAttribute('aria-label'), 'Search');
	assert.equal(env.input.getAttribute('role'), 'combobox');
	assert.equal(env.input.getAttribute('aria-controls'), 'test-search-results');
	env.query('resource:scene-color');
	assert.match(env.rows()[0]!.querySelector('.zenfg-inspector-graph-search-metadata')!.textContent!, /Resource · Texture · resource:scene-color/);
	assert.equal(env.rows()[0]!.querySelector('.zenfg-inspector-graph-search-path')!.textContent, 'Main');
	env.query('group:postfx');
	assert.equal(env.rows()[0]!.querySelector('.zenfg-inspector-graph-search-label')!.textContent, 'PostFX');
	assert.equal(env.rows()[0]!.querySelector('.zenfg-inspector-graph-search-path')!.textContent, 'Main / PostFX');
	env.query('backbuffer');
	assert.ok(env.rows().some((row) => row.dataset.selectionKind === 'root'));
	assert.ok(env.rows().filter((row) => row.dataset.selectionKind === 'root').every((row) => row.querySelector('.zenfg-inspector-graph-search-metadata')!.textContent!.startsWith('Output ·')));
});

test('Graph search ranks exact names and IDs first, prefixes next, and preserves capture order among equal matches', (t) => {
	const source = namedNodes(['post scene', 'scene AA', 'scene', 'SCENE', 'scene ZZ', 'another pass']);
	const env = mount(source); t.after(env.close);
	env.query(' scene ');
	assert.deepEqual(env.rows().map((row) => row.dataset.selectionId), ['node:2', 'node:3', 'node:1', 'node:4', 'node:0']);
	env.query('NODE:4');
	assert.equal(env.rows()[0]!.dataset.selectionId, 'node:4');
	env.key('Enter');
	assert.deepEqual(env.reveals, [{ kind: 'node', id: 'node:4' }]);
	assert.equal(env.popover.hidden, true);
	assert.equal(document.activeElement, env.toggle);
});

test('Graph search keyboard navigation retains input focus, reveals the active result, and hover does not reveal', (t) => {
	const env = mount(namedNodes(['Pass one', 'Pass two', 'Pass three'])); t.after(env.close);
	env.query('Pass');
	env.rows()[1]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
	assert.deepEqual(env.reveals, []);
	assert.equal(env.input.hasAttribute('aria-activedescendant'), false);
	env.key('ArrowDown');
	assert.equal(env.input.getAttribute('aria-activedescendant'), env.rows()[0]!.id);
	assert.equal(env.rows()[0]!.getAttribute('aria-selected'), 'true');
	env.key('ArrowDown');
	assert.equal(env.rows()[1]!.getAttribute('aria-selected'), 'true');
	env.key('ArrowUp');
	assert.equal(env.rows()[0]!.getAttribute('aria-selected'), 'true');
	env.key('ArrowUp');
	assert.equal(env.rows()[2]!.getAttribute('aria-selected'), 'true');
	assert.equal(document.activeElement, env.input);
	assert.deepEqual(env.reveals, []);
	env.key('Enter');
	assert.deepEqual(env.reveals, [{ kind: 'node', id: 'node:2' }]);
	assert.equal(env.popover.hidden, true);
	env.query('Pass');
	env.key('Escape');
	assert.equal(env.popover.hidden, true);
	assert.equal(env.input.value, '');
	assert.equal(env.toggle.getAttribute('aria-expanded'), 'false');
	assert.equal(document.activeElement, env.toggle);
});

test('Graph search preserves the query and active semantic result across a capture and resets a removed result', (t) => {
	const source = namedNodes(['Pass one', 'Pass two', 'Pass three']);
	const env = mount(source); t.after(env.close);
	env.query('Pass');
	env.key('ArrowDown'); env.key('ArrowDown');
	const updated = { ...source, graph: { ...source.graph, nodes: source.graph.nodes.map((node) => node.id === 'node:1' ? { ...node, label: 'Pass two updated' } : node) } };
	env.view.setSnapshot(createDebugViewModel(updated));
	assert.equal(env.input.value, 'Pass');
	assert.equal(env.rows()[1]!.getAttribute('aria-selected'), 'true');
	assert.equal(env.input.getAttribute('aria-activedescendant'), env.rows()[1]!.id);
	assert.match(env.rows()[1]!.textContent!, /Pass two updated/);
	env.view.setSnapshot(createDebugViewModel({ ...updated, graph: { ...updated.graph, nodes: updated.graph.nodes.filter((node) => node.id !== 'node:1') } }));
	assert.equal(env.input.hasAttribute('aria-activedescendant'), false);
	env.key('Enter');
	assert.deepEqual(env.reveals, [{ kind: 'node', id: 'node:0' }]);
});

test('Graph search closes outside the popover without stealing focus and removes outside listeners on destroy', (t) => {
	const env = mount(); t.after(env.close);
	const added: string[] = [];
	const removed: string[] = [];
	const owner = env.view.root.ownerDocument;
	const add = owner.addEventListener.bind(owner);
	const remove = owner.removeEventListener.bind(owner);
	owner.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
		added.push(type); return add(type, listener, options);
	}) as typeof owner.addEventListener;
	owner.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
		removed.push(type); return remove(type, listener, options);
	}) as typeof owner.removeEventListener;
	env.query('present');
	env.input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
	assert.equal(env.popover.hidden, false);
	document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
	assert.equal(env.popover.hidden, true);
	assert.notEqual(document.activeElement, env.toggle, 'outside pointer interaction must keep its own focus behavior');
	env.query('present');
	const outside = document.createElement('button'); document.body.append(outside); outside.focus();
	assert.equal(env.popover.hidden, true);
	assert.equal(document.activeElement, outside);
	env.query('present');
	env.view.destroy();
	assert.equal(env.popover.hidden, true);
	assert.equal(added.filter((type) => type === 'pointerdown').length, 3);
	assert.equal(removed.filter((type) => type === 'pointerdown').length, 3);
	assert.equal(added.filter((type) => type === 'focusin').length, 3);
	assert.equal(removed.filter((type) => type === 'focusin').length, 3);
});

test('Graph search caps results, reports the total, and handles empty matches without revealing', (t) => {
	const env = mount(namedNodes(Array.from({ length: 64 }, (_, index) => `Pass ${index}`))); t.after(env.close);
	env.query('Pass');
	assert.equal(env.rows().length, 50);
	assert.match(env.view.root.querySelector('[role="status"]')!.textContent!, /Showing 50 of 64 results/);
	env.key('ArrowUp');
	assert.equal(env.rows()[49]!.getAttribute('aria-selected'), 'true');
	env.query('No such pass');
	assert.equal(env.rows().length, 0);
	assert.equal(env.view.root.querySelector('[role="status"]')!.textContent, '0 results');
	env.key('ArrowDown'); env.key('Enter');
	assert.deepEqual(env.reveals, []);
	assert.equal(env.popover.hidden, false);
	env.query('');
	assert.equal(env.view.root.querySelector<HTMLElement>('[role="status"]')!.hidden, true);
	assert.equal(env.view.root.querySelector<HTMLElement>('[role="listbox"]')!.hidden, true);
});

test('Graph search exposes unrepresented resources to the existing reveal flow and falls back to missing labels', (t) => {
	const base = fixture();
	const source = { ...base, graph: { ...base.graph, nodes: base.graph.nodes.map((node) => node.id === 'node:scene' ? { ...node, label: undefined } : node) } };
	const env = mount(source); t.after(env.close);
	env.query('node:scene');
	assert.equal(env.rows()[0]!.querySelector('.zenfg-inspector-graph-search-label')!.textContent, 'node:scene');
	env.query('resource:unused-data');
	env.rows()[0]!.click();
	assert.deepEqual(env.reveals, [{ kind: 'resource', id: 'resource:unused-data' }]);
});
