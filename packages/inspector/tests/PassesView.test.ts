import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { PassesView } from '../src/panelPassesView.ts';
import type { Selection } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function fixture(name = 'full-webgpu'): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve(`packages/snapshot/fixtures/${name}.fgsnapshot.json`), 'utf8'));
}

function mount(t: { after(callback: () => void): void }) {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window); Reflect.set(globalThis, 'document', window.document); Reflect.set(globalThis, 'Event', window.Event);
	t.after(() => window.close());
	const selected: Selection[] = [];
	const callbacks: WorkbenchCallbacks = { onSelect: selection => selected.push(selection), onHover: () => {}, onReveal: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => false };
	const view = new PassesView(callbacks, 'pass-analysis'); document.body.append(view.root);
	return { view, selected };
}

function element<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
	const found = root.querySelector<T>(selector); assert.ok(found, selector); return found;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.getAttribute('aria-label') === label || candidate.textContent === label);
	assert.ok(found, label); return found;
}

function select(view: PassesView, label: string, value: string): void {
	const control = element<HTMLSelectElement>(view.root, `select[aria-label="${label}"]`);
	control.value = value; control.dispatchEvent(new Event('change'));
}

function search(view: PassesView, value: string): void {
	const control = element<HTMLInputElement>(view.root, 'input[aria-label="Search pass, ID or group"]');
	control.value = value; control.dispatchEvent(new Event('input'));
}

function rows(view: PassesView): HTMLTableRowElement[] {
	return [...view.root.querySelectorAll<HTMLTableRowElement>('.zenfg-inspector-pass-table tbody tr[data-selection-key]')];
}

function metric(view: PassesView, id: string, source: 'cpu' | 'gpu'): HTMLElement {
	assert.equal(element(view.root, '.zenfg-inspector-pass-table').dataset.source, source, 'the expected source is explicitly displayed');
	return element(view.root, `.zenfg-inspector-pass-table tr[data-selection-key="node:${id}"]`);
}

function withCpu(): FrameGraphSnapshot {
	const source = fixture();
	return { ...source, timings: { ...source.timings, cpu: { status: 'available', executionDurationMicros: 1100,
		nodes: [{ nodeId: 'node:scene', durationMicros: 400 }, { nodeId: 'node:present', durationMicros: 0 }, { nodeId: 'node:external', durationMicros: 200 }],
	} } };
}

test('explicit source selection keeps each capture-wide axis and denominator through filters', t => {
	const { view } = mount(t); view.setSnapshot(createDebugViewModel(withCpu()));
	const table = element(view.root, '.zenfg-inspector-pass-table');
	assert.equal(table.querySelectorAll('thead th').length, 5);
	assert.equal(table.dataset.source, 'gpu'); assert.equal(table.dataset.maxMicros, '2000');
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true');
	assert.equal(button(view.root, 'CPU').getAttribute('aria-pressed'), 'false');
	assert.equal(element<HTMLElement>(view.root, '.zenfg-inspector-pass-matched').hidden, true, 'unfiltered capture does not repeat a matched total');
	assert.match(element(table, '.zenfg-inspector-timing-axis').textContent!, /2 ms/);
	assert.equal(rows(view)[0]!.querySelectorAll('.zenfg-inspector-timing-bar').length, 1);
	assert.equal(element(rows(view)[0]!, '.zenfg-inspector-timing-kind').textContent, 'Render');
	assert.equal(element(rows(view)[0]!, '[data-timing-column="order"]').textContent, '0');
	assert.equal(element(rows(view)[0]!, '[data-timing-column="order"]').getAttribute('aria-label'), 'Execution order: 0');
	assert.match(element(rows(view)[0]!, '.zenfg-inspector-timing-attributes .zenfg-inspector-timing-accesses').getAttribute('aria-label')!, /0 reads.*1 writes.*declared access records/);
	assert.equal(element(metric(view, 'node:scene', 'gpu'), '.zenfg-inspector-pass-duration').textContent, '1.410');
	assert.equal(element(metric(view, 'node:scene', 'gpu'), '.zenfg-inspector-pass-share').textContent, '88.6%');
	assert.ok(Math.abs(parseFloat(element(metric(view, 'node:scene', 'gpu'), '.zenfg-inspector-timing-bar > span').style.width) - 70.5125) < 0.000001, 'bar geometry retains the captured sub-microsecond precision');
	search(view, 'node:present');
	assert.equal(rows(view).length, 1);
	assert.equal(table.dataset.maxMicros, '2000');
	assert.equal(element(metric(view, 'node:present', 'gpu'), '.zenfg-inspector-pass-share').textContent, '11.4%');
	assert.match(element(view.root, '.zenfg-inspector-pass-matched').textContent!, /Matched GPU: 0\.181 ms.*11\.4%/);
	button(view.root, 'CPU').click();
	assert.equal(table.dataset.maxMicros, '500'); assert.equal(rows(view).length, 1, 'source choice preserves the pass search');
	assert.match(element(view.root, '.zenfg-inspector-pass-matched').textContent!, /Matched CPU: 0\.000 ms.*0\.0%/);
	assert.equal(element(metric(view, 'node:present', 'cpu'), '.zenfg-inspector-pass-duration').textContent, '0.000');
	assert.equal(element(metric(view, 'node:present', 'cpu'), '.zenfg-inspector-timing-bar > span').style.width, '0%');
	assert.equal(element(metric(view, 'node:present', 'cpu'), '.zenfg-inspector-pass-share').textContent, '0.0%');
});

test('sorting never chooses the source and only time sorting follows an explicit source switch', t => {
	const { view } = mount(t); view.setSnapshot(createDebugViewModel(withCpu()));
	search(view, 'node:');
	select(view, 'Sort passes', 'time');
	const gpuOrder = rows(view).map(row => row.dataset.selectionKey);
	assert.equal(element(view.root, '.zenfg-inspector-pass-table').dataset.source, 'gpu');
	assert.match(element(view.root, '.zenfg-inspector-pass-matched').textContent!, /Matched GPU: 1\.591 ms/);
	button(view.root, 'CPU').click();
	assert.notDeepEqual(rows(view).map(row => row.dataset.selectionKey), gpuOrder, 'time sorting uses the explicitly selected source');
	assert.match(element(view.root, '.zenfg-inspector-pass-matched').textContent!, /Matched CPU: 0\.600 ms/);
	const cpuReadings = () => ['node:scene', 'node:present'].map(id => ({
		duration: element(metric(view, id, 'cpu'), '.zenfg-inspector-pass-duration').textContent,
		share: element(metric(view, id, 'cpu'), '.zenfg-inspector-pass-share').textContent,
		width: element(metric(view, id, 'cpu'), '.zenfg-inspector-timing-bar > span').style.width,
	}));
	const expectedReadings = cpuReadings(); const expectedMatched = element(view.root, '.zenfg-inspector-pass-matched').textContent;
	assert.equal(expectedReadings[0]!.share, '66.7%', 'CPU share uses its 0.600 ms pass sum rather than the 1.100 ms execute total');
	for (const sort of ['order', 'label', 'kind']) {
		select(view, 'Sort passes', sort);
		assert.deepEqual(cpuReadings(), expectedReadings, `${sort} does not change displayed CPU readings`);
		assert.equal(element(view.root, '.zenfg-inspector-pass-matched').textContent, expectedMatched);
		const order = rows(view).map(row => row.dataset.selectionKey);
		button(view.root, 'GPU').click(); assert.deepEqual(rows(view).map(row => row.dataset.selectionKey), order, `${sort} does not reorder when source changes`);
		button(view.root, 'CPU').click(); assert.deepEqual(rows(view).map(row => row.dataset.selectionKey), order);
	}
});

test('pass identity reserves the first line for its name and keeps group search separate from row copy', t => {
	const { view } = mount(t); view.setSnapshot(createDebugViewModel(fixture()));
	const row = rows(view)[0]!;
	const identity = element(row, '[data-timing-column="name"] > .zenfg-inspector-timing-identity');
	const name = element<HTMLButtonElement>(identity, '.zenfg-inspector-timing-name');
	const attributes = element(identity, '.zenfg-inspector-timing-attributes');
	assert.strictEqual(identity.firstElementChild, name);
	assert.strictEqual(identity.children[1], attributes);
	assert.strictEqual(element(identity, '.zenfg-inspector-timing-kind').parentElement, attributes);
	assert.strictEqual(element(identity, '.zenfg-inspector-timing-accesses').parentElement, attributes);
	assert.equal(name.textContent, 'scene');
	assert.equal(row.querySelectorAll('.zenfg-inspector-timing-accesses').length, 1, 'read/write facts appear once per pass');
	assert.equal(row.querySelector('[data-timing-column="access"]'), null);
	assert.equal(view.root.querySelector('.zenfg-inspector-pass-table .zenfg-inspector-list-group-path'), null);
	assert.deepEqual(rows(view).map(candidate => element(candidate, '[data-timing-column="order"]').textContent), ['0', '1', '2', '—']);
	search(view, 'Main / PostFX');
	assert.deepEqual(rows(view).map(candidate => candidate.dataset.selectionKey), ['node:node:present'], 'hidden group paths remain searchable');
	assert.doesNotMatch(element(rows(view)[0]!, '[data-timing-column="name"]').textContent!, /Main|PostFX|Order/);
});

test('source defaults follow availability until an explicit choice persists across capture refresh', t => {
	const { view } = mount(t); const source = withCpu();
	view.setSnapshot(createDebugViewModel({ ...source, timings: { ...source.timings, gpu: { status: 'unavailable', reason: 'unsupported' } } }));
	assert.equal(button(view.root, 'CPU').getAttribute('aria-pressed'), 'true');
	view.setSnapshot(createDebugViewModel(source));
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true', 'unselected default can follow newly available GPU data');
	const cpu = button(view.root, 'CPU'); cpu.focus(); cpu.click();
	view.setSnapshot(createDebugViewModel({ ...source, timings: { ...source.timings, cpu: { status: 'unavailable', reason: 'not-collected' } } }));
	assert.equal(button(view.root, 'CPU').getAttribute('aria-pressed'), 'true', 'a missing measurement does not override the explicit source');
	assert.equal(element(view.root, '.zenfg-inspector-pass-table').dataset.source, 'cpu');
	assert.equal(element(view.root, '.zenfg-inspector-pass-table').dataset.maxMicros, '0');
	assert.equal(element(metric(view, 'node:scene', 'cpu'), '.zenfg-inspector-timing-state-label').textContent, 'Not collected');
	assert.strictEqual(document.activeElement, cpu, 'capture refresh keeps the source button focused');
	select(view, 'Sort passes', 'time');
	assert.equal(button(view.root, 'CPU').getAttribute('aria-pressed'), 'true', 'time sorting cannot silently switch to available GPU data');
});

test('the timing comparison retains the full pass list and excludes copy work from GPU measurements', t => {
	const { view } = mount(t); const source = fixture('minimal');
	const durations = [800, 700, 600, 500, 400, 300];
	const nodes: FrameGraphSnapshot['graph']['nodes'] = Array.from({ length: 8 }, (_, index) => ({
		id: `node:${index}`, label: `Pass ${index}`, kind: index < durations.length ? 'render' : 'copy', sideEffect: true,
		recordingOrder: index, compileState: { status: 'retained', executionOrder: index },
	}));
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, nodes,
		segments: [{ id: 'segment:work', kind: 'frame-graph', order: 0, nodeIds: nodes.map(node => node.id) }],
	}, timings: { ...source.timings, gpu: { status: 'available', frameSpanMicros: 3300,
		nodes: durations.map((durationMicros, index) => ({ nodeId: `node:${index}`, durationMicros })),
	} } }));
	select(view, 'Sort passes', 'time'); assert.equal(rows(view).length, 8);
	assert.equal(element(metric(view, 'node:6', 'gpu'), '.zenfg-inspector-timing-state-label').textContent, 'Not applicable');
	assert.equal(metric(view, 'node:6', 'gpu').querySelector('.zenfg-inspector-pass-share'), null);
	assert.match(element(view.root, '.zenfg-inspector-list-coverage').textContent!, /Capture GPU.*6\/6/);
});

test('clearing active filters restores the search focus instead of leaving it on a hidden action', t => {
	const { view } = mount(t); view.setSnapshot(createDebugViewModel(fixture()));
	const clear = button(view.root, 'Clear filters'); assert.equal(clear.hidden, true);
	search(view, 'missing'); assert.equal(clear.hidden, false);
	clear.focus(); clear.click();
	assert.equal(clear.hidden, true); assert.equal(rows(view).length, 4);
	assert.strictEqual(document.activeElement, element(view.root, 'input[aria-label="Search pass, ID or group"]'));
	select(view, 'Sort passes', 'time'); assert.equal(clear.hidden, true, 'sorting is not an active filter');
});

test('missing, zero and ineligible pass timings do not acquire invented shares or bars', t => {
	const { view } = mount(t); const source = fixture();
	view.setSnapshot(createDebugViewModel({ ...source, timings: { ...source.timings,
		gpu: { status: 'available', frameSpanMicros: 0, nodes: [{ nodeId: 'node:scene', durationMicros: 0 }] },
	} }));
	assert.equal(element(metric(view, 'node:scene', 'gpu'), '.zenfg-inspector-pass-share').textContent, '—');
	assert.equal(element(metric(view, 'node:scene', 'gpu'), '.zenfg-inspector-timing-bar > span').style.width, '0%');
	assert.equal(element(metric(view, 'node:present', 'gpu'), '.zenfg-inspector-timing-state-label').textContent, 'Not collected');
	assert.equal(element(metric(view, 'node:external', 'gpu'), '.zenfg-inspector-timing-state-label').textContent, 'Opaque');
	assert.equal(metric(view, 'node:present', 'gpu').querySelector('.zenfg-inspector-timing-bar'), null);
	assert.match(element(view.root, '.zenfg-inspector-list-context').textContent!, /Capture GPU.*Partial.*1\/2/);
	search(view, 'node:present');
	assert.match(element(view.root, '.zenfg-inspector-pass-matched').textContent!, /Matched GPU: —.*—/);
	view.setSnapshot(createDebugViewModel({ ...source, timings: { ...source.timings,
		gpu: { status: 'unavailable', reason: 'disabled' }, cpu: withCpu().timings.cpu,
	} }));
	assert.equal(element(view.root, '.zenfg-inspector-pass-table').dataset.source, 'cpu');
	assert.equal(element(view.root, '.zenfg-inspector-pass-table').dataset.maxMicros, '500');
	assert.equal(rows(view).length, 1, 'capture refresh preserves the active pass search');
	assert.equal(element(metric(view, 'node:present', 'cpu'), '.zenfg-inspector-pass-duration').textContent, '0.000');
	assert.equal(element(metric(view, 'node:present', 'cpu'), '.zenfg-inspector-timing-bar > span').style.width, '0%');
	button(view.root, 'GPU').click();
	assert.equal(metric(view, 'node:present', 'gpu').querySelector('.zenfg-inspector-timing-bar'), null);
});

test('culled passes expose their reason while preserving selection and retained sort preference', t => {
	const { view, selected } = mount(t); view.setSnapshot(createDebugViewModel(fixture()));
	const culled = element<HTMLTableRowElement>(view.root, 'tr[data-selection-key="culled:node:unused"]');
	assert.equal(culled.cells.length, 3);
	assert.equal(element(culled, '[data-timing-column="order"]').textContent, '—');
	assert.equal(element(culled, '[data-timing-column="order"]').getAttribute('aria-label'), 'Execution order: Not applicable');
	assert.equal(element<HTMLTableCellElement>(culled, '.zenfg-inspector-pass-reason').colSpan, 3);
	assert.match(culled.textContent!, /Not executed.*not-reachable-from-root/);
	assert.equal(culled.querySelector('[data-timing], .zenfg-inspector-timing-bar'), null);
	select(view, 'Sort passes', 'time'); view.showCulled();
	const headers = [...view.root.querySelectorAll<HTMLTableCellElement>('.zenfg-inspector-pass-table th')];
	assert.equal(headers.length, 3);
	assert.equal(headers[2]!.textContent, 'Culled reason'); assert.equal(headers[2]!.colSpan, 3);
	assert.equal(element(view.root, '.zenfg-inspector-list-context').hidden, true);
	button(view.root, 'unused').click(); assert.deepEqual(selected, [{ kind: 'culled', id: 'node:unused' }]);
	view.showAll();
	assert.equal(view.root.querySelectorAll('.zenfg-inspector-pass-table th').length, 5);
	assert.equal(element(view.root, '.zenfg-inspector-pass-table th[data-timing-column="time"]').textContent, 'Time (ms)');
	assert.equal(element<HTMLSelectElement>(view.root, '[aria-label="Sort passes"]').value, 'time');
});

test('group pass scope uses identity and descendants, combines filters and survives renamed captures', t => {
	const { view } = mount(t); const source = withCpu();
	const scoped: FrameGraphSnapshot = { ...source, graph: { ...source.graph,
		groups: [...source.graph.groups, { id: 'group:other', label: 'PostFX' }],
		nodes: source.graph.nodes.map(node => node.id === 'node:external' ? { ...node, groupId: 'group:other' } : node),
	} };
	view.setSnapshot(createDebugViewModel(scoped)); button(view.root, 'CPU').click(); select(view, 'Sort passes', 'time'); search(view, 'missing');
	select(view, 'Pass kind', 'compute'); select(view, 'Pass compile state', 'culled');
	button(view.root, 'Group Hierarchy').click();
	button(view.root, 'View passes in group Main').click();
	assert.equal(button(view.root, 'Pass List').getAttribute('aria-selected'), 'true');
	assert.strictEqual(document.activeElement, button(view.root, 'Pass List'));
	assert.deepEqual(rows(view).map(row => row.dataset.selectionKey), ['node:node:scene', 'node:node:present']);
	assert.match(element(view.root, '.zenfg-inspector-pass-scope').textContent!, /Main.*includes subgroups/);
	assert.equal(element<HTMLSelectElement>(view.root, '[aria-label="Sort passes"]').value, 'time');
	search(view, 'present'); assert.equal(rows(view).length, 1); search(view, '');
	button(view.root, 'Group Hierarchy').click(); button(view.root, 'View passes in group Main / PostFX').click();
	assert.deepEqual(rows(view).map(row => row.dataset.selectionKey), ['node:node:present'], 'same-named group outside the selected canonical subtree is excluded');
	view.setSnapshot(createDebugViewModel({ ...scoped, graph: { ...scoped.graph,
		groups: scoped.graph.groups.map(group => group.id === 'group:postfx' ? { ...group, label: 'Renamed' } : group),
	} }));
	assert.match(element(view.root, '.zenfg-inspector-pass-scope').textContent!, /Main \/ Renamed/);
	assert.equal(rows(view).length, 1);
	view.reveal({ kind: 'node', id: 'node:external' });
	assert.equal(element(view.root, '.zenfg-inspector-pass-scope').hidden, true); assert.equal(rows(view).length, 4);
	button(view.root, 'Group Hierarchy').click(); button(view.root, 'View passes in group Main').click();
	view.setSnapshot(createDebugViewModel({ ...scoped, graph: { ...scoped.graph, groups: [], nodes: scoped.graph.nodes.map(({ groupId: _group, ...node }) => node),
		resources: scoped.graph.resources.map(({ groupId: _group, ...resource }) => resource),
	} }));
	assert.equal(element(view.root, '.zenfg-inspector-pass-scope').hidden, true); assert.equal(rows(view).length, 4);
});

test('capture refresh restores pass focus by ID without redirecting external focus', t => {
	const { view, selected } = mount(t); const source = fixture();
	const long = `Long pass ${'🚀'.repeat(30)}shadow.depth.12345`;
	const capture: FrameGraphSnapshot = { ...source, graph: { ...source.graph, nodes: source.graph.nodes.map(node => node.id === 'node:scene' ? { ...node, label: long } : node) } };
	view.setSnapshot(createDebugViewModel(capture));
	const name = button(view.root, long); assert.ok(name.title.includes('node:scene'));
	assert.equal(name.textContent, long); assert.equal(element(name, '.zenfg-inspector-pass-name-suffix').textContent, [...long].slice(-12).join(''));
	name.focus(); view.setSnapshot(createDebugViewModel(capture));
	assert.strictEqual(document.activeElement, button(view.root, long));
	button(view.root, long).click(); assert.deepEqual(selected, [{ kind: 'node', id: 'node:scene' }]);
	const outside = document.createElement('button'); document.body.append(outside); outside.focus();
	view.setSnapshot(createDebugViewModel(capture)); assert.strictEqual(document.activeElement, outside);
});

test('refreshing away a group restores visible focus from its scope and filter actions', t => {
	const { view } = mount(t); const source = fixture();
	const noGroups: FrameGraphSnapshot = { ...source, graph: { ...source.graph, groups: [],
		nodes: source.graph.nodes.map(({ groupId: _group, ...node }) => node),
		resources: source.graph.resources.map(({ groupId: _group, ...resource }) => resource),
	} };
	for (const action of ['Clear group scope', 'Clear filters']) {
		view.setSnapshot(createDebugViewModel(source));
		button(view.root, 'Group Hierarchy').click(); button(view.root, 'View passes in group Main').click();
		const origin = button(view.root, action); origin.focus();
		view.setSnapshot(createDebugViewModel(noGroups));
		assert.ok(origin.closest('[hidden]'), `${action} is no longer applicable after the group disappears`);
		assert.strictEqual(document.activeElement, button(view.root, 'Pass List'));
		assert.equal(button(view.root, 'Pass List').closest('[hidden]'), null);
	}
});

test('removing all groups restores focus from the disabled hierarchy and its hidden controls', t => {
	const { view } = mount(t); const source = fixture();
	const noGroups: FrameGraphSnapshot = { ...source, graph: { ...source.graph, groups: [],
		nodes: source.graph.nodes.map(({ groupId: _group, ...node }) => node),
		resources: source.graph.resources.map(({ groupId: _group, ...resource }) => resource),
	} };
	for (const origin of ['tab', 'search', 'clear']) {
		view.setSnapshot(createDebugViewModel(source));
		const groupsTab = button(view.root, 'Group Hierarchy'); groupsTab.click();
		const toolbar = element(view.root, '[aria-label="Group search"]');
		(origin === 'tab' ? groupsTab : origin === 'search'
			? element<HTMLInputElement>(toolbar, 'input') : button(toolbar, 'Clear filters')).focus();
		view.setSnapshot(createDebugViewModel(noGroups));
		assert.equal(groupsTab.disabled, true);
		assert.strictEqual(document.activeElement, button(view.root, 'Pass List'), `${origin} returns to the visible subview`);
		assert.equal(button(view.root, 'Pass List').closest('[hidden]'), null);
	}
	view.setSnapshot(createDebugViewModel(source)); button(view.root, 'Group Hierarchy').click();
	const outside = document.createElement('button'); document.body.append(outside); outside.focus();
	view.setSnapshot(createDebugViewModel(noGroups));
	assert.strictEqual(document.activeElement, outside, 'capture refresh must not redirect outside focus');
});
