import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';

import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { DiagnosticsView } from '../src/panelDiagnosticsView.ts';
import { PassesView } from '../src/panelPassesView.ts';
import { ResourcesView } from '../src/panelResourcesView.ts';
import type { Selection, WorkbenchTab } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function installDom(): Window {
	const win = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', win);
	Reflect.set(globalThis, 'document', win.document);
	Reflect.set(globalThis, 'Event', win.Event);
	return win;
}

function fixture(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8'));
}

function callbacks() {
	const selections: Selection[] = [];
	const reveals: Array<readonly [Selection, WorkbenchTab]> = [];
	const navigation: Array<readonly [WorkbenchTab, 'culled' | undefined]> = [];
	const graphToggles: string[] = [];
	const handlers: WorkbenchCallbacks = {
		onSelect: (selection) => selections.push(selection),
		onHover: () => {},
		onReveal: (selection, tab) => reveals.push([selection, tab]),
		onNavigate: (tab, filter) => navigation.push([tab, filter]),
		onGroupToggle: (path) => graphToggles.push(path),
		isGroupExpanded: () => false,
	};
	return { handlers, selections, reveals, navigation, graphToggles };
}

function setSelect(root: HTMLElement, label: string, value: string): void {
	const control = root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
	assert.ok(control, label);
	control.value = value;
	control.dispatchEvent(new Event('change'));
}

function search(root: HTMLElement, label: string, value: string): void {
	const control = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
	assert.ok(control, label);
	control.value = value;
	control.dispatchEvent(new Event('input'));
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
	const control = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent === text);
	assert.ok(control, text);
	return control;
}

function listRows(view: PassesView): HTMLTableRowElement[] {
	return Array.from(view.root.querySelectorAll<HTMLTableRowElement>('[id$="pass-list-panel"] tbody tr[data-selection-key]'));
}

test('Passes includes retained and culled work with composable state, kind, ID search and clear filters', (t) => {
	const win = installDom(); t.after(() => win.close());
	const log = callbacks();
	const view = new PassesView(log.handlers, 'passes');
	view.setSnapshot(createDebugViewModel(fixture()));
	assert.deepEqual(listRows(view).map((row) => row.dataset.selectionKey), ['node:node:scene', 'node:node:external', 'node:node:present', 'culled:node:unused']);
	assert.match(listRows(view)[3]!.textContent!, /CulledNot applicablecomputeNot applicable/);
	assert.match(view.root.querySelector('.zenfg-inspector-result-count')!.textContent!, /4 \/ 4 passes/);
	search(view.root, 'Search pass, ID or group', 'node:unused');
	assert.equal(listRows(view).length, 1);
	button(view.root, 'unused').click();
	assert.deepEqual(log.selections, [{ kind: 'culled', id: 'node:unused' }]);
	assert.deepEqual(log.reveals, []);
	setSelect(view.root, 'Pass compile state', 'retained');
	assert.equal(listRows(view).length, 0);
	button(view.root, 'Clear filters').click();
	setSelect(view.root, 'Pass kind', 'compute');
	setSelect(view.root, 'Pass compile state', 'culled');
	assert.equal(listRows(view).length, 1);
	view.reveal({ kind: 'node', id: 'node:present' });
	assert.equal(listRows(view).length, 4);
	assert.equal(view.root.querySelector<HTMLSelectElement>('[aria-label="Pass kind"]')!.value, 'all');
	view.showCulled();
	assert.deepEqual(listRows(view).map((row) => row.dataset.selectionKey), ['culled:node:unused']);
});

test('Pass order uses execution order then culled recording order and falls back to original order', (t) => {
	const win = installDom(); t.after(() => win.close());
	const original = fixture();
	const unused = original.graph.nodes.find((node) => node.id === 'node:unused')!;
	const snapshot: FrameGraphSnapshot = {
		...original,
		graph: { ...original.graph, nodes: [
			{ ...unused, id: 'node:second', label: 'second', recordingOrder: 9 },
			...original.graph.nodes,
			{ ...unused, id: 'node:first', label: 'first', recordingOrder: 2 },
		] },
	};
	const view = new PassesView(callbacks().handlers, 'order');
	view.setSnapshot(createDebugViewModel(snapshot));
	assert.deepEqual(listRows(view).map((row) => row.dataset.selectionKey), [
		'node:node:scene', 'node:node:external', 'node:node:present', 'culled:node:first', 'culled:node:unused', 'culled:node:second',
	]);
	view.setSnapshot(createDebugViewModel({ ...snapshot, graph: {
		...snapshot.graph, nodes: snapshot.graph.nodes.map(({ recordingOrder: _recordingOrder, ...node }) => node),
	} }));
	assert.deepEqual(listRows(view).slice(3).map((row) => row.dataset.selectionKey), ['culled:node:second', 'culled:node:unused', 'culled:node:first']);
});

test('Group hierarchy expands independently of Graph, keeps search ancestors, and supports explicit reveal', (t) => {
	const win = installDom(); t.after(() => win.close());
	const log = callbacks();
	const snapshot = createDebugViewModel(fixture());
	const view = new PassesView(log.handlers, 'groups');
	view.setSnapshot(snapshot);
	button(view.root, 'Group Hierarchy').click();
	const rows = () => view.root.querySelectorAll('[id$="group-list-panel"] tbody tr[data-selection-key]');
	assert.equal(rows().length, 2, 'tree defaults expanded although Graph is collapsed');
	assert.equal(view.root.querySelector<HTMLElement>('[aria-label="Pass filters and sorting"]')!.hidden, true);
	view.root.querySelector<HTMLButtonElement>('[aria-label="Collapse group Main"]')!.click();
	assert.equal(rows().length, 1);
	assert.deepEqual(log.graphToggles, []);
	search(view.root, 'Search group path or ID', 'PostFX');
	assert.equal(rows().length, 2);
	assert.match(rows()[0]!.textContent!, /Main/);
	search(view.root, 'Search group path or ID', '');
	assert.equal(rows().length, 1, 'search did not mutate collapse state');
	const postfx = snapshot.groupById.get('group:postfx')!;
	view.reveal({ kind: 'group', pathKey: postfx.pathKey });
	assert.equal(rows().length, 2);
	button(rows()[1] as HTMLElement, 'Show in Graph').click();
	assert.deepEqual(log.reveals, [[{ kind: 'group', pathKey: postfx.pathKey }, 'graph']]);
});

test('Pass and group GPU values distinguish missing, partial, zero and ineligible timings', (t) => {
	const win = installDom(); t.after(() => win.close());
	const snapshot = fixture();
	const view = new PassesView(callbacks().handlers, 'timing');
	view.setSnapshot(createDebugViewModel({ ...snapshot, timings: { gpu: {
		status: 'available', frameSpanMicros: 0, nodes: [{ nodeId: 'node:scene', durationMicros: 0 }],
	} } }));
	assert.equal(listRows(view)[0]!.cells[4]!.textContent, '0.000');
	assert.equal(listRows(view)[2]!.cells[4]!.textContent, 'Not collected');
	assert.match(view.root.querySelector('.zenfg-inspector-list-context')!.textContent!, /Partial.*1\/2/);
	assert.match(view.root.querySelector('[id$="group-list-panel"] tbody tr')!.textContent!, /0\.000 ms.*Partial.*1\/2/);
	view.setSnapshot(createDebugViewModel({ ...snapshot, timings: { gpu: { status: 'unavailable', reason: 'disabled' } } }));
	assert.doesNotMatch(view.root.querySelector('[id$="group-list-panel"]')!.textContent!, /0\.000/);
	assert.match(view.root.querySelector('[id$="group-list-panel"]')!.textContent!, /Not collected/);
	view.setSnapshot(createDebugViewModel({ ...snapshot,
		graph: { ...snapshot.graph, nodes: snapshot.graph.nodes.map((node) => ({ ...node, kind: 'copy' })) },
		timings: { gpu: { status: 'unavailable', reason: 'disabled' } },
	}));
	assert.match(view.root.querySelector('[id$="group-list-panel"]')!.textContent!, /Not applicable/);
});

test('Group hierarchy keeps subtrees contiguous when recording interleaves groups', (t) => {
	const win = installDom(); t.after(() => win.close());
	const snapshot = fixture();
	const view = new PassesView(callbacks().handlers, 'tree');
	view.setSnapshot(createDebugViewModel({ ...snapshot, graph: { ...snapshot.graph, groups: [
		snapshot.graph.groups[0]!, { id: 'group:other', label: 'Other' }, snapshot.graph.groups[1]!,
	] } }));
	const names = Array.from(view.root.querySelectorAll('[id$="group-list-panel"] tbody tr'),
		(row) => row.querySelector('td .zenfg-inspector-relation-button')!.textContent);
	assert.deepEqual(names, ['Main', 'PostFX', 'Other']);
});

test('Pass subview keyboard navigation activates tabs and maintains one tab stop', (t) => {
	const win = installDom(); t.after(() => win.close());
	const view = new PassesView(callbacks().handlers, 'keys');
	view.setSnapshot(createDebugViewModel(fixture()));
	document.body.appendChild(view.root);
	const list = button(view.root, 'Pass List');
	const groups = button(view.root, 'Group Hierarchy');
	list.focus();
	list.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as KeyboardEvent);
	assert.equal(groups.getAttribute('aria-selected'), 'true');
	assert.equal(list.tabIndex, -1);
	assert.equal(groups.tabIndex, 0);
	groups.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }) as unknown as KeyboardEvent);
	assert.equal(list.getAttribute('aria-selected'), 'true');
});

test('Resource Surface filter, ID/group search, size and lifetime sorting retain unknowns at the end', (t) => {
	const win = installDom(); t.after(() => win.close());
	const original = fixture();
	const snapshot: FrameGraphSnapshot = { ...original, graph: { ...original.graph, resources: original.graph.resources.map((resource) =>
		resource.id === 'resource:unused-data' ? { ...resource, estimatedByteSize: 0, lifetime: { firstUse: 1, lastUse: 1 } } : resource,
	) } };
	const view = new ResourcesView(callbacks().handlers, 'resources');
	view.setSnapshot(createDebugViewModel(snapshot));
	const rows = () => Array.from(view.root.querySelectorAll<HTMLTableRowElement>('tbody tr[data-selection-key]'));
	setSelect(view.root, 'Resource origin', 'surface');
	assert.deepEqual(rows().map((row) => row.dataset.selectionKey), ['resource:resource:backbuffer']);
	assert.equal(rows()[0]!.querySelector('small'), null, 'no placeholder group row');
	assert.match(view.root.querySelector('.zenfg-inspector-result-count')!.textContent!, /1 \/ 3 resources/);
	button(view.root, 'Clear filters').click();
	search(view.root, 'Search resource, ID or group', 'resource:scene-color');
	assert.equal(rows().length, 1);
	search(view.root, 'Search resource, ID or group', 'Main');
	assert.equal(rows().length, 1);
	view.reveal({ kind: 'resource', id: 'resource:backbuffer' });
	setSelect(view.root, 'Sort resources', 'size');
	assert.deepEqual(rows().map((row) => row.dataset.selectionKey), ['resource:resource:scene-color', 'resource:resource:unused-data', 'resource:resource:backbuffer']);
	setSelect(view.root, 'Sort resources', 'lifetime');
	assert.deepEqual(rows().map((row) => row.dataset.selectionKey), ['resource:resource:scene-color', 'resource:resource:unused-data', 'resource:resource:backbuffer']);
	assert.equal(rows()[1]!.cells[2]!.textContent, '0 B');
});

test('Diagnostics preserves every message, sorts by severity stably and provides separate node/resource associations', (t) => {
	const win = installDom(); t.after(() => win.close());
	const log = callbacks();
	const longMessage = 'A long diagnostic message. '.repeat(150);
	const snapshot: FrameGraphSnapshot = { ...fixture(), diagnostics: [
		{ severity: 'info', code: 'same', message: 'Info first' },
		{ severity: 'warning', code: 'same', message: 'Warning first', nodeId: 'node:unused', resourceId: 'resource:backbuffer' },
		{ severity: 'error', code: 'same', message: longMessage },
		{ severity: 'warning', code: 'same', message: 'Warning second', nodeId: 'node:scene' },
		{ severity: 'error', code: 'same', message: 'Error second' },
	] };
	const view = new DiagnosticsView(log.handlers, 'diagnostics');
	view.setSnapshot(createDebugViewModel(snapshot));
	const articles = () => Array.from(view.root.querySelectorAll<HTMLElement>('.zenfg-inspector-diagnostic-message'));
	assert.deepEqual(articles().map((entry) => entry.dataset.severity), ['error', 'error', 'warning', 'warning', 'info']);
	assert.deepEqual(articles().map((entry) => entry.querySelector('p')!.textContent), [longMessage, 'Error second', 'Warning first', 'Warning second', 'Info first']);
	const associated = articles()[2]!;
	assert.equal(associated.querySelectorAll('.zenfg-inspector-diagnostic-links').length, 2);
	button(associated, 'unused').click();
	button(associated, 'backbuffer').click();
	assert.deepEqual(log.selections, [{ kind: 'culled', id: 'node:unused' }, { kind: 'resource', id: 'resource:backbuffer' }]);
	assert.deepEqual(log.reveals, []);
	button(associated, 'Show in Passes').click();
	button(associated, 'Show in Resources').click();
	assert.deepEqual(log.reveals, [[{ kind: 'culled', id: 'node:unused' }, 'passes'], [{ kind: 'resource', id: 'resource:backbuffer' }, 'resources']]);
	setSelect(view.root, 'Diagnostic severity', 'warning');
	assert.equal(articles().length, 2);
	search(view.root, 'Search diagnostic code or message', 'Warning second');
	assert.equal(articles().length, 1);
	assert.match(view.root.querySelector('.zenfg-inspector-result-count')!.textContent!, /1 \/ 5 diagnostics/);
	view.reveal({ kind: 'culled', id: 'node:unused' });
	assert.equal(articles().length, 5);
	assert.equal(view.root.querySelectorAll('table').length, 0, 'GPU and culled tables are not duplicated');
});

test('Diagnostics empty state and collapsible compile explanations keep list navigation explicit', (t) => {
	const win = installDom(); t.after(() => win.close());
	const log = callbacks();
	const snapshot = createDebugViewModel({ ...fixture(), diagnostics: [] });
	const view = new DiagnosticsView(log.handlers, 'compile');
	view.setSnapshot(snapshot);
	assert.match(view.root.textContent!, /No diagnostic messages in this snapshot/);
	assert.equal(view.root.querySelectorAll('details[open]').length, 0);
	button(view.root, 'Show culled passes').click();
	assert.deepEqual(log.navigation, [['passes', 'culled']]);
	view.reveal({ kind: 'root', key: snapshot.roots[0]!.key });
	assert.equal(view.root.querySelector<HTMLDetailsElement>('[data-section="roots"]')!.open, true);
	view.reveal({ kind: 'segment', index: 1 });
	assert.equal(view.root.querySelector<HTMLDetailsElement>('[data-section="segments"]')!.open, true);
	assert.equal(view.root.querySelector<HTMLDetailsElement>('[data-section="segment:1"]')!.open, true);
	const segment = view.root.querySelector<HTMLElement>('[data-section="segment:1"]')!;
	assert.match(segment.querySelector('summary')!.textContent!, /Opaque interval.*1 passes/);
	button(segment, 'Inspect segment').click();
	assert.deepEqual(log.selections, [{ kind: 'segment', index: 1 }]);
});
