import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
	FRAME_GRAPH_SNAPSHOT_FORMAT, FRAME_GRAPH_SNAPSHOT_VERSION,
	validateFrameGraphSnapshot,
	type FrameGraphSnapshot, type FrameGraphSnapshotAllocation, type FrameGraphSnapshotResource,
} from '@zenfg/snapshot';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { analyzeSnapshotAliases } from '../src/panelAliasAnalysis.ts';
import { MemoryView } from '../src/panelMemoryView.ts';
import { OverviewView } from '../src/panelOverviewView.ts';
import type { Selection } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

test('memory uses inclusive nonzero execution slots shared by ticks, gridlines, and bars', () => {
	const env = mountMemory();
	try {
		const { root } = env.view;
		const axis = root.querySelector('.zenfg-inspector-memory-axis')!;
		assert.equal(axis.children[2]!.className, 'zenfg-inspector-memory-axis-track');
		assert.deepEqual(ticks(root), [['5', '12.5%'], ['6', '37.5%'], ['7', '62.5%'], ['8', '87.5%']]);
		const alpha = bar(root, 'resource:alpha');
		const beta = bar(root, 'resource:beta');
		const gamma = bar(root, 'resource:gamma');
		assert.deepEqual([alpha.style.left, alpha.style.width], ['0%', '25%']);
		assert.deepEqual([beta.style.left, beta.style.width], ['25%', '50%']);
		assert.deepEqual([gamma.style.left, gamma.style.width], ['0%', '50%']);
		// Adjacent lifetimes meet exactly; overlapping lifetimes share slot space.
		assert.equal(Number.parseFloat(alpha.style.left) + Number.parseFloat(alpha.style.width), Number.parseFloat(beta.style.left));
		assert.ok(Number.parseFloat(gamma.style.width) > Number.parseFloat(alpha.style.width));
		assert.deepEqual(Array.from(root.querySelectorAll<HTMLElement>('[data-selection-key="resource:resource:alpha"] .zenfg-inspector-memory-gridline'), (line) => line.style.left), ['12.5%', '37.5%', '62.5%', '87.5%']);
		assert.equal(bar(root, 'resource:unallocated').classList.contains('empty'), true);
	} finally { env.close(); }
});

test('single-slot lifetimes fill the domain, while missing lifetimes do not invent an execution slot', () => {
	const env = mountMemory(snapshot([resource('only', { firstUse: 9, lastUse: 9 })], []));
	try {
		assert.deepEqual(ticks(env.view.root), [['9', '50%']]);
		assert.deepEqual([bar(env.view.root, 'resource:only').style.left, bar(env.view.root, 'resource:only').style.width], ['0%', '100%']);
		env.view.setSnapshot(createDebugViewModel(snapshot([resource('missing')], [])));
		assert.deepEqual(ticks(env.view.root), []);
		assert.match(env.view.root.textContent ?? '', /No execution lifetimes/);
		assert.equal(bar(env.view.root, 'resource:missing').classList.contains('empty'), true);
	} finally { env.close(); }
});

test('memory filters and search preserve the snapshot domain and whole-snapshot metrics', () => {
	const env = mountMemory();
	try {
		const root = env.view.root;
		const originalTicks = ticks(root);
		const summary = root.querySelector('.zenfg-inspector-memory-summary')!.textContent;
		assert.match(root.querySelector('[role="status"]')!.textContent!, /5 \/ 5 resources/);
		changeSelect(root, 'Memory allocation status', 'aliased');
		assert.deepEqual(resourceIds(root), ['resource:alpha', 'resource:beta']);
		search(root, 'beta');
		assert.deepEqual(resourceIds(root), ['resource:beta']);
		assert.match(root.querySelector('[role="status"]')!.textContent!, /1 \/ 5 resources/);
		assert.deepEqual(ticks(root), originalTicks);
		assert.equal(root.querySelector('.zenfg-inspector-memory-summary')!.textContent, summary);
		assert.match(root.querySelector('.zenfg-inspector-memory-allocation')!.textContent!, /Shared ×2/);
		search(root, '');
		changeSelect(root, 'Memory allocation status', 'single');
		assert.deepEqual(resourceIds(root), ['resource:unknown', 'resource:gamma']);
		changeSelect(root, 'Memory allocation status', 'unallocated');
		assert.deepEqual(resourceIds(root), ['resource:unallocated']);
		search(root, 'no match');
		assert.match(root.textContent!, /No allocations or logical resources match these filters/);
		Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Clear filters')!.click();
		assert.equal(resourceIds(root).length, 5);
		assert.deepEqual(ticks(root), originalTicks);
	} finally { env.close(); }
});

test('allocation search includes members, and size sorting keeps unknown allocation sizes last', () => {
	const env = mountMemory();
	try {
		const root = env.view.root;
		search(root, 'allocation:a');
		assert.deepEqual(resourceIds(root), ['resource:alpha', 'resource:beta']);
		search(root, 'Main');
		assert.deepEqual(resourceIds(root), ['resource:alpha']);
		search(root, '');
		changeSelect(root, 'Memory sort', 'size');
		assert.deepEqual(Array.from(root.querySelector('.zenfg-inspector-memory-timeline')!.children).filter(row => (row as HTMLElement).dataset.allocationId).map(row => (row as HTMLElement).dataset.allocationId), ['allocation:a', 'allocation:b', 'allocation:c']);
		assert.doesNotMatch(root.textContent!, /Allocation #allocation:/);
	} finally { env.close(); }
});

test('ordinary memory selection preserves filters; explicit reveal clears blockers and locates its row', () => {
	let selected: Selection | undefined;
	let revealed: readonly unknown[] | undefined;
	const env = mountMemory(snapshot(), {
		onSelect: (selection) => { selected = selection; },
		onReveal: (selection, tab) => { revealed = [selection, tab]; },
	});
	try {
		const root = env.view.root;
		search(root, 'beta');
		env.view.setSelection({ kind: 'resource', id: 'resource:alpha' });
		assert.deepEqual(resourceIds(root), ['resource:beta']);
		env.view.reveal({ kind: 'resource', id: 'resource:alpha' });
		assert.equal(resourceIds(root).length, 5);
		const row = root.querySelector<HTMLElement>('.zenfg-inspector-memory-resource[data-selection-key="resource:resource:alpha"]')!;
		assert.equal(row.classList.contains('selected'), true);
		assert.ok(document.activeElement === row.querySelector('button'));
		row.querySelector<HTMLButtonElement>('.zenfg-inspector-relation-button')!.click();
		assert.deepEqual(selected, { kind: 'resource', id: 'resource:alpha' });
		row.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-reveal')!.click();
		assert.deepEqual(revealed, [{ kind: 'resource', id: 'resource:alpha' }, 'resources']);
	} finally { env.close(); }
});

test('memory distinguishes unavailable reports, partial estimates, and valid zero allocations', () => {
	const env = mountMemory();
	try {
		assert.equal(metric(env.view.root, 'Physical allocation estimate'), 'Unknown');
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-summary')!.textContent!, /2\/3 sizes known/);
		assert.match(metric(env.view.root, 'Logical capacity'), /Unknown · 3\/4 sizes known/);
		const base = snapshot([resource('unallocated')], []);
		env.view.setSnapshot(createDebugViewModel({ ...base, memory: {
			allocationReport: { status: 'unavailable', reason: 'Not captured' },
			poolReport: { status: 'unavailable', reason: 'Not captured' },
		} }));
		assert.equal(metric(env.view.root, 'Logical capacity'), 'Unavailable');
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-report-state')!.textContent!, /Allocation report unavailable.*Not captured/);
		assert.equal(env.view.root.querySelectorAll('.zenfg-inspector-memory-summary .zenfg-inspector-memory-metric').length, 0);
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-pool')!.textContent!, /Unavailable · Not captured/);
		assert.equal(env.view.root.querySelector<HTMLOptionElement>('option[value="unallocated"]')!.textContent, 'Allocation unavailable');
		assert.match(env.view.root.textContent!, /allocation report unavailable/);
		env.view.setSnapshot(createDebugViewModel(snapshot([], [])));
		for (const label of ['Logical transient estimate', 'Logical capacity', 'Physical allocation estimate', 'Alias savings estimate', 'Idle pool estimate']) {
			assert.equal(metric(env.view.root, label), '0 B');
		}
		assert.equal(metric(env.view.root, 'Allocations'), '0');
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-allocation-stats')!.textContent!, /0 shared · 0 single/);
	} finally { env.close(); }
});

test('allocation folding keeps matching counts and search expands without changing the saved preference', () => {
	const env = mountMemory();
	try {
		const root = env.view.root;
		const originalTicks = ticks(root);
		allocationToggle(root, 'allocation:a').click();
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'false');
		assert.deepEqual(resourceIds(root), ['resource:unknown', 'resource:gamma', 'resource:unallocated']);
		assert.match(root.querySelector('[role="status"]')!.textContent!, /5 \/ 5 resources/);
		assert.ok(document.activeElement === allocationToggle(root, 'allocation:a'));
		search(root, 'beta');
		assert.deepEqual(resourceIds(root), ['resource:beta']);
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'true');
		assert.equal(allocationToggle(root, 'allocation:a').disabled, true);
		assert.match(root.querySelector('.zenfg-inspector-memory-allocation')!.textContent!, /Shared ×2/);
		search(root, '');
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'false');
		assert.deepEqual(ticks(root), originalTicks);
		env.view.setSelection({ kind: 'resource', id: 'resource:alpha' });
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'false');
		env.view.reveal({ kind: 'resource', id: 'resource:alpha' });
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'true');
		const alpha = root.querySelector<HTMLElement>('.zenfg-inspector-memory-resource[data-selection-key="resource:resource:alpha"]')!;
		assert.equal(alpha.classList.contains('selected'), true);
		assert.ok(document.activeElement === alpha.querySelector('button'));
	} finally { env.close(); }
});

test('refresh preserves estimate disclosure and folds for surviving allocations but drops removed IDs', () => {
	const env = mountMemory();
	try {
		const root = env.view.root;
		const details = root.querySelector<HTMLDetailsElement>('.zenfg-inspector-memory-estimate-details')!;
		details.open = true;
		allocationToggle(root, 'allocation:a').click();
		env.view.setSnapshot(createDebugViewModel(snapshot()));
		assert.equal(details.open, true);
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'false');
		env.view.setSnapshot(createDebugViewModel(snapshot([], [])));
		env.view.setSnapshot(createDebugViewModel(snapshot()));
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'false');
		env.view.reveal({ kind: 'allocation', id: 'allocation:a' });
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'true');
		assert.ok(document.activeElement === root.querySelector('[data-selection-key="allocation:allocation:a"] .zenfg-inspector-relation-button'));
		assert.equal(root.querySelector('.zenfg-inspector-memory-summary')!.parentElement, root.querySelector('.zenfg-inspector-memory-scroller'));
	} finally { env.close(); }
});

test('pool metrics stay separate from allocation estimates and reuse is cumulative with zero acquisitions inapplicable', () => {
	const base = snapshot([resource('logical', { firstUse: 0, lastUse: 0 }, 'allocation:a', 64)], [
		{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 128 },
	]);
	const env = mountMemory({ ...base, memory: { ...base.memory, poolReport: {
		status: 'available', acquireCount: 8, reuseCount: 6, createdCount: 2, retainedCount: 4, estimatedRetainedBytes: 1024,
	} } }, { onReveal: () => {} });
	try {
		const root = env.view.root;
		assert.equal(root.querySelector('.zenfg-inspector-memory-summary')!.children.length, 2);
		assert.equal(metric(root, 'Physical allocation estimate'), '128 B');
		assert.equal(metric(root, 'Alias savings estimate'), '0 B');
		assert.equal(metric(root, 'Logical transient estimate'), '64 B');
		assert.equal(metric(root, 'Logical capacity'), '128 B');
		assert.equal(metric(root, 'Idle pool estimate'), '1.0 KiB');
		assert.match(root.querySelector('.zenfg-inspector-memory-pool')!.textContent!, /Idle pool estimate1.0 KiB· 4 allocations/);
		assert.equal(metric(root, 'Cumulative reuse'), '75.0%');
		env.view.setSnapshot(createDebugViewModel(base));
		assert.equal(metric(root, 'Cumulative reuse'), 'Not applicable');
		assert.equal(metric(root, 'Idle pool estimate'), '0 B');
		const locate = root.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-reveal')!;
		assert.equal(locate.getAttribute('aria-label'), 'Locate logical in Resources');
		assert.ok(locate.querySelector('svg[data-icon="locate"]'));
		assert.equal(locate.textContent, '');
	} finally { env.close(); }
});

test('allocation analysis caches immutable captures and ignores imported resource lifetimes', () => {
	const viewModel = createDebugViewModel(snapshot());
	const first = analyzeSnapshotAliases(viewModel);
	assert.equal(analyzeSnapshotAliases(viewModel), first);
	assert.equal(first.minUse, 5);
	assert.equal(first.maxUse, 8);
	assert.equal(first.resources.get('resource:imported')!.aliasStatus, 'not-transient');
	assert.equal(first.resources.get('resource:alpha')!.aliasStatus, 'aliased');
	const next = analyzeSnapshotAliases(createDebugViewModel(snapshot([resource('later', { firstUse: 12, lastUse: 14 })], [])));
	assert.notEqual(next, first);
	assert.equal(next.minUse, 12);
	assert.equal(next.maxUse, 14);
});

test('unreferenced allocations retain physical estimates without counting as single-resource allocations', () => {
	const base = JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
	assert.equal(base.memory.allocationReport.status, 'available');
	if (base.memory.allocationReport.status !== 'available') throw new Error('Expected available fixture allocations');
	const protocol: FrameGraphSnapshot = { ...base, memory: { ...base.memory, allocationReport: {
		...base.memory.allocationReport, allocations: [...base.memory.allocationReport.allocations, {
			id: 'allocation:unreferenced', kind: 'buffer', compatibilityClassId: 'compatibility:unreferenced', estimatedByteSize: 8388608,
		}],
	} } };
	assert.deepEqual(validateFrameGraphSnapshot(protocol), [], 'an unreferenced allocation is a valid snapshot record');
	const env = mountMemory(protocol);
	try {
		const root = env.view.root;
		assert.equal(metric(root, 'Allocations'), '2');
		assert.equal(metric(root, 'Physical allocation estimate'), '15.9 MiB');
		assert.match(root.querySelector('.zenfg-inspector-memory-allocation-stats')!.textContent!, /0 shared · 1 single · 1 unreferenced/);
		const header = () => root.querySelector<HTMLElement>('[data-selection-key="allocation:allocation:unreferenced"]');
		assert.match(header()!.textContent!, /Unreferenced/);
		assert.doesNotMatch(header()!.textContent!, /Single/);
		assert.equal(root.querySelector('[data-allocation-toggle="allocation:unreferenced"]'), null);
		changeSelect(root, 'Memory allocation status', 'single');
		assert.equal(header(), null);
		assert.deepEqual(resourceIds(root), ['resource:scene-color']);
		changeSelect(root, 'Memory allocation status', 'all');
		search(root, 'allocation:unreferenced');
		assert.ok(header());
		assert.deepEqual(resourceIds(root), []);
		assert.match(root.querySelector('[role="status"]')!.textContent!, /0 \/ 2 resources/);
		env.view.reveal({ kind: 'allocation', id: 'allocation:unreferenced' });
		assert.equal(header()!.classList.contains('selected'), true);
		assert.ok(document.activeElement === header()!.querySelector('.zenfg-inspector-relation-button'));
		assert.equal(metric(root, 'Physical allocation estimate'), '15.9 MiB');
	} finally { env.close(); }
});

function mountMemory(protocol = snapshot(), callbacks: Partial<WorkbenchCallbacks> = {}, expand = true) {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'Event', window.Event);
	const view = new MemoryView({ onSelect: () => {}, onHover: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => true, ...callbacks }, 'test');
	document.body.append(view.root);
	view.setSnapshot(createDebugViewModel(protocol));
	// Lifetime tests inspect resource children; production starts with allocations collapsed.
	if (expand) for (const toggle of [...view.root.querySelectorAll<HTMLButtonElement>('[data-allocation-toggle]')]) toggle.click();
	return { view, close: () => window.close() };
}

test('focus follows a logical resource to its current allocation when capture membership changes', () => {
	const allocations: FrameGraphSnapshotAllocation[] = [
		{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 64 },
		{ id: 'allocation:b', kind: 'buffer', compatibilityClassId: 'class:b', estimatedByteSize: 64 },
	];
	const moving = resource('moving', { firstUse: 0, lastUse: 1 }, 'allocation:a', 60);
	const env = mountMemory(snapshot([moving], allocations), {}, false);
	try {
		env.view.reveal({ kind: 'resource', id: moving.id });
		const migrated = { ...moving, allocationId: 'allocation:b' };
		env.view.setSnapshot(createDebugViewModel(snapshot([migrated], allocations)));
		assert.equal((document.activeElement as HTMLElement).dataset.memoryFocus, 'resource:moving:preview');
		env.view.setSnapshot(createDebugViewModel(snapshot([migrated, resource('sibling', { firstUse: 2, lastUse: 2 }, 'allocation:b', 60)], allocations)));
		assert.equal((document.activeElement as HTMLElement).dataset.memoryFocus, 'allocation:b:name');
	} finally { env.close(); }
});

function resource(name: string, lifetime?: { firstUse: number; lastUse: number }, allocationId?: string, estimatedByteSize?: number): FrameGraphSnapshotResource {
	return { id: `resource:${name}`, label: name, kind: 'buffer', origin: 'transient', initialContents: 'undefined', usageFlags: [], lifetime, allocationId, estimatedByteSize };
}

function snapshot(resources: readonly FrameGraphSnapshotResource[] = [
	{ ...resource('alpha', { firstUse: 5, lastUse: 5 }, 'allocation:a', 64), groupId: 'group:main' },
	resource('beta', { firstUse: 6, lastUse: 7 }, 'allocation:a', 128),
	resource('gamma', { firstUse: 5, lastUse: 6 }, 'allocation:b', 0),
	resource('unknown', { firstUse: 8, lastUse: 8 }, 'allocation:c'),
	resource('unallocated'),
	{ ...resource('imported', { firstUse: 0, lastUse: 99 }), origin: 'imported', initialContents: 'defined' },
], allocations: readonly FrameGraphSnapshotAllocation[] = [
	{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 256 },
	{ id: 'allocation:c', kind: 'buffer', compatibilityClassId: 'class:c' },
	{ id: 'allocation:b', kind: 'buffer', compatibilityClassId: 'class:b', estimatedByteSize: 0 },
]): FrameGraphSnapshot {
	return {
		format: FRAME_GRAPH_SNAPSHOT_FORMAT, version: FRAME_GRAPH_SNAPSHOT_VERSION,
		producer: { name: 'Memory tests', version: '1' }, capture: { frameIndex: 1 },
		graph: { groups: [{ id: 'group:main', label: 'Main' }], nodes: [], resources, textureViews: [], accesses: [], dependencies: [], roots: [], segments: [] },
		memory: { allocationReport: { status: 'available', allocations }, poolReport: { status: 'available', acquireCount: 0, reuseCount: 0, createdCount: 0, retainedCount: 0, estimatedRetainedBytes: 0 } },
		timings: { cpu: { status: 'unavailable', reason: 'not-requested' }, gpu: { status: 'unavailable', reason: 'not collected' } }, diagnostics: [], extensions: {},
	};
}

function ticks(root: ParentNode): string[][] {
	return Array.from(root.querySelectorAll<HTMLElement>('.zenfg-inspector-memory-axis-track > span'), (tick) => [tick.textContent!, tick.style.getPropertyValue('--fgd-memory-tick-position')]);
}

function bar(root: ParentNode, resourceId: string): HTMLElement {
	return root.querySelector<HTMLElement>(`[data-selection-key="resource:${resourceId}"] .zenfg-inspector-memory-bar`)!;
}

function resourceIds(root: ParentNode): string[] {
	return Array.from(root.querySelectorAll<HTMLElement>('.zenfg-inspector-memory-resource'), (row) => row.dataset.selectionKey!.slice('resource:'.length));
}

function search(root: ParentNode, value: string): void {
	const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
	input.value = value;
	input.dispatchEvent(new Event('input'));
}

function changeSelect(root: ParentNode, label: string, value: string): void {
	const select = root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
	select.value = value;
	select.dispatchEvent(new Event('change'));
}

function metric(root: ParentNode, label: string): string {
	const item = Array.from(root.querySelectorAll('.zenfg-inspector-memory-metric')).find((entry) => entry.querySelector('.zenfg-inspector-memory-metric-label')!.textContent === label);
	if (item) return item.querySelector('strong')!.textContent!;
	return Array.from(root.querySelectorAll('.zenfg-inspector-memory-estimate-facts > div')).find((entry) => entry.querySelector('dt')!.textContent === label)!.querySelector('dd')!.textContent!;
}

function allocationToggle(root: ParentNode, id: string): HTMLButtonElement {
	return Array.from(root.querySelectorAll<HTMLButtonElement>('[data-allocation-toggle]')).find((button) => button.dataset.allocationToggle === id)!;
}


test('alias savings survive unreferenced and unknown single allocations and agree with Overview', () => {
	const source = JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/aliasing.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
	if (source.memory.allocationReport.status !== 'available') throw new Error('Expected allocations');
	const protocol: FrameGraphSnapshot = { ...source, graph: { ...source.graph, resources: [...source.graph.resources,
		resource('unknown-single', { firstUse: 0, lastUse: 0 }, 'allocation:unknown-single'),
	] }, memory: { ...source.memory, allocationReport: { status: 'available', allocations: [...source.memory.allocationReport.allocations,
		{ id: 'allocation:unused', kind: 'buffer', compatibilityClassId: 'class:unused', estimatedByteSize: 8192 },
		{ id: 'allocation:unknown-single', kind: 'buffer', compatibilityClassId: 'class:unknown' },
	] } } };
	const model = createDebugViewModel(protocol);
	assert.equal(model.metrics.physicalEstimatedBytes, undefined);
	assert.equal(model.metrics.aliasReuseBytes, 1024);
	assert.deepEqual(model.metrics.estimatedCoverage.alias, { known: 1, total: 1 });
	assert.equal(model.metrics.unreferencedPhysicalEstimatedBytes, 8192);
	const env = mountMemory(protocol);
	try {
		assert.equal(metric(env.view.root, 'Alias savings estimate'), '1.0 KiB');
		const overview = new OverviewView({ onSelect: () => {}, onHover: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => false });
		overview.setSnapshot(model);
		const alias = [...overview.root.querySelectorAll('dt')].find(term => term.textContent === 'Alias savings estimate')!;
		assert.equal(alias.nextElementSibling!.textContent, '1.0 KiB');
		const unknownShared: FrameGraphSnapshot = { ...protocol, memory: { ...protocol.memory, allocationReport: {
			status: 'available', allocations: protocol.memory.allocationReport.status === 'available' ? protocol.memory.allocationReport.allocations.map(allocation =>
				allocation.id === 'allocation:shared' ? { ...allocation, estimatedByteSize: undefined } : allocation) : [],
		} } };
		const missing = createDebugViewModel(unknownShared); env.view.setSnapshot(missing); overview.setSnapshot(missing);
		assert.equal(missing.metrics.aliasReuseBytes, undefined);
		assert.deepEqual(missing.metrics.estimatedCoverage.alias, { known: 0, total: 1 });
		assert.equal(metric(env.view.root, 'Alias savings estimate'), 'Unknown');
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-summary')!.textContent!, /0[/]1 shared allocation sizes known/);
		assert.match(overview.root.textContent!, /Alias savings estimateUnknown.*0[/]1 shared allocation sizes known/);
	} finally { env.close(); }
});

test('alias savings exclude imported members and preserve a known zero shared capacity', () => {
	const source = snapshot([
		resource('a', { firstUse: 0, lastUse: 0 }, 'allocation:a', 60), resource('b', { firstUse: 1, lastUse: 1 }, 'allocation:a', 60),
		{ ...resource('external', undefined, 'allocation:a'), origin: 'imported', initialContents: 'defined' },
	], [{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 64 }]);
	assert.equal(createDebugViewModel(source).metrics.aliasReuseBytes, 64);
	assert.equal(createDebugViewModel({ ...source, memory: { ...source.memory, allocationReport: { status: 'available', allocations: [
		{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 0 },
	] } } }).metrics.aliasReuseBytes, 0);
	const empty = createDebugViewModel(snapshot([], []));
	assert.equal(empty.metrics.aliasReuseBytes, 0); assert.equal(empty.metrics.unreferencedPhysicalEstimatedBytes, 0);
});

test('Single and Shared use physical allocation parents with logical children and distinct selection', () => {
	const selected: Selection[] = [];
	const env = mountMemory(snapshot([resource('only', { firstUse: 0, lastUse: 0 }, 'allocation:a', 60)], [
		{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 64 },
	]), { onSelect: value => selected.push(value) }, false);
	try {
		const root = env.view.root, parent = root.querySelector<HTMLElement>('.zenfg-inspector-memory-allocation')!;
		assert.equal(root.querySelector('.zenfg-inspector-memory-resource'), null);
		assert.match(parent.textContent!, /Single/);
		assert.equal(parent.querySelector('.zenfg-inspector-memory-size')!.getAttribute('title'), 'Physical estimate: 64 B');
		parent.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-allocation-link')!.click();
		parent.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-preview')!.click();
		parent.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-track')!.click();
		allocationToggle(root, 'allocation:a').click();
		const child = root.querySelector<HTMLElement>('.zenfg-inspector-memory-resource')!;
		assert.equal(child.querySelector('.zenfg-inspector-memory-size')!.getAttribute('title'), 'Logical estimate: 60 B');
		child.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-track')!.click();
		assert.deepEqual(selected, [{ kind: 'allocation', id: 'allocation:a' }, { kind: 'resource', id: 'resource:only' }, { kind: 'allocation', id: 'allocation:a' }, { kind: 'resource', id: 'resource:only' }]);
		env.view.reveal({ kind: 'resource', id: 'resource:only' }); assert.ok(document.activeElement === child.querySelector('button') || (document.activeElement as HTMLElement).dataset.memoryFocus === 'resource:only:name');
	} finally { env.close(); }
});

test('Memory long names and inclusive Order links retain exact IDs through recording reorder', () => {
	const source = JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
	const label = 'history.' + '名称😀.'.repeat(40) + 'color-pyramid.layer.12'; const revealed: unknown[] = [];
	const env = mountMemory({ ...source, graph: { ...source.graph, nodes: [...source.graph.nodes].reverse(), resources: source.graph.resources.map(resource =>
		resource.id === 'resource:scene-color' ? { ...resource, label } : resource) } }, { onReveal: (selection, page) => revealed.push([selection, page]) });
	try {
		const row = env.view.root.querySelector<HTMLElement>('.zenfg-inspector-memory-resource[data-selection-key="resource:resource:scene-color"]')!;
		const name = row.querySelector<HTMLButtonElement>('.zenfg-inspector-memory-title > .zenfg-inspector-object-name')!;
		assert.equal(name.textContent, label); assert.equal(name.title, label + ' · resource:scene-color');
		assert.equal(name.querySelector('.zenfg-inspector-name-suffix')!.textContent, [...label].slice(-12).join(''));
		const links = row.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-memory-range button');
		links[0]!.click(); links[1]!.click();
		assert.deepEqual(revealed, [[{ kind: 'node', id: 'node:scene' }, 'passes'], [{ kind: 'node', id: 'node:present' }, 'passes']]);
	} finally { env.close(); }
});

test('Memory refresh restores stable name and allocation focus, including Shared to Single transitions', () => {
	const env = mountMemory();
	try {
		const root = env.view.root;
		const control = (key: string) => [...root.querySelectorAll<HTMLButtonElement>('[data-memory-focus]')].find(element => element.dataset.memoryFocus === key)!;
		control('resource:alpha:name').focus(); env.view.setSnapshot(createDebugViewModel(snapshot()));
		assert.equal((document.activeElement as HTMLElement).dataset.memoryFocus, 'resource:alpha:name');
		control('allocation:a:toggle').focus();
		const single = snapshot([resource('alpha', { firstUse: 5, lastUse: 5 }, 'allocation:a', 64)], [
			{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 256 },
		]);
		env.view.setSnapshot(createDebugViewModel(single));
		assert.equal((document.activeElement as HTMLElement).dataset.memoryFocus, 'allocation:a:toggle');
		env.view.setSnapshot(createDebugViewModel(snapshot()));
		assert.equal((document.activeElement as HTMLElement).dataset.memoryFocus, 'allocation:a:toggle');
		control('resource:alpha:name').focus(); env.view.setSnapshot(createDebugViewModel(snapshot([], [])));
		assert.ok(document.activeElement === root.querySelector('input'));
		const outside = document.createElement('button'); document.body.append(outside); outside.focus();
		env.view.setSnapshot(createDebugViewModel(snapshot())); assert.ok(document.activeElement === outside);
		search(root, 'beta'); const clear = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Clear filters')!;
		clear.focus(); clear.click(); assert.equal(clear.hidden, true); assert.ok(document.activeElement === root.querySelector('input'));
	} finally { env.close(); }
});

test('reported external allocation members remain inside the lifetime domain without increasing alias savings', () => {
	const source = JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/aliasing.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
	const transient = source.graph.resources[1]!;
	const external: FrameGraphSnapshotResource = { ...transient, id: 'resource:assigned-external', origin: 'imported', initialContents: 'defined', lifetime: { firstUse: 0, lastUse: 1 } };
	const protocol: FrameGraphSnapshot = { ...source, graph: { ...source.graph, resources: [transient, external], accesses: source.graph.accesses.filter(access => access.resourceId === transient.id) } };
	assert.deepEqual(validateFrameGraphSnapshot(protocol), []);
	const env = mountMemory(protocol);
	try {
		assert.equal(metric(env.view.root, 'Alias savings estimate'), '0 B');
		assert.deepEqual(ticks(env.view.root).map(tick => tick[0]), ['0', '1']);
		const externalRow = env.view.root.querySelector('.zenfg-inspector-memory-resource[data-selection-key="resource:resource:assigned-external"]')!;
		assert.equal(externalRow.querySelector('[data-origin="imported"]')!.textContent, 'Imported');
		assert.doesNotMatch(externalRow.textContent!, /Unallocated/);
		const track = bar(env.view.root, external.id);
		assert.deepEqual([track.style.left, track.style.width], ['0%', '100%']);
		const externalOnly: FrameGraphSnapshot = { ...protocol, graph: { ...protocol.graph, resources: [external], accesses: [] } };
		assert.deepEqual(validateFrameGraphSnapshot(externalOnly), []);
		env.view.setSnapshot(createDebugViewModel(externalOnly));
		assert.deepEqual(ticks(env.view.root).map(tick => tick[0]), ['0', '1']);
		assert.equal(bar(env.view.root, external.id).style.width, '100%');
		assert.equal(metric(env.view.root, 'Alias savings estimate'), '0 B');
	} finally { env.close(); }
});


test('allocation coverage unions overlaps and adjacent slots while preserving gaps and missing members through filtering', () => {
	const source = snapshot([
		resource('a', { firstUse: 0, lastUse: 2 }, 'allocation:a', 64), resource('b', { firstUse: 2, lastUse: 4 }, 'allocation:a', 64),
		resource('c', { firstUse: 5, lastUse: 5 }, 'allocation:a', 64), resource('d', { firstUse: 9, lastUse: 10 }, 'allocation:a', 64), resource('e', undefined, 'allocation:a'),
	], [{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 128 }]);
	const model = createDebugViewModel(source), coverage = analyzeSnapshotAliases(model).allocations[0]!.coverage;
	assert.deepEqual(coverage, { intervals: [{ firstUse: 0, lastUse: 5 }, { firstUse: 9, lastUse: 10 }], known: 4, total: 5 });
	const env = mountMemory(source, {}, false);
	try {
		const parent = () => env.view.root.querySelector<HTMLElement>('.zenfg-inspector-memory-allocation')!;
		const segments = () => [...parent().querySelectorAll<HTMLElement>('.zenfg-inspector-memory-bar')].map(bar => [bar.style.left, bar.style.width]);
		assert.equal(segments().length, 2); assert.match(parent().textContent!, /4[/]5 known/);
		assert.ok(Math.abs(Number.parseFloat(segments()[0]![1]!) - 600 / 11) < .001);
		const original = segments(); search(env.view.root, 'resource:d');
		assert.deepEqual(segments(), original); assert.match(parent().textContent!, /Shared ×5/); assert.match(parent().textContent!, /1 [/] 5 logical resources matching/);
		assert.deepEqual(resourceIds(env.view.root), ['resource:d']);
	} finally { env.close(); }
});

test('global physical-size sorting keeps expanded resources with their allocation and excludes unallocated logical rows', () => {
	const source = snapshot([
		resource('a', { firstUse: 0, lastUse: 0 }, 'allocation:a', 60), resource('b', { firstUse: 2, lastUse: 2 }, 'allocation:a', 64),
		resource('single', { firstUse: 0, lastUse: 2 }, 'allocation:b', 1), resource('unknown', undefined, 'allocation:c'), resource('loose', undefined, undefined, 8192),
	], [
		{ id: 'allocation:a', kind: 'buffer', compatibilityClassId: 'class:a', estimatedByteSize: 128 },
		{ id: 'allocation:b', kind: 'buffer', compatibilityClassId: 'class:b', estimatedByteSize: 256 },
		{ id: 'allocation:u', kind: 'buffer', compatibilityClassId: 'class:u', estimatedByteSize: 192 },
		{ id: 'allocation:c', kind: 'buffer', compatibilityClassId: 'class:c' },
	]);
	const env = mountMemory(source, {}, false);
	try {
		const root = env.view.root;
		const ids = () => [...root.querySelectorAll<HTMLElement>('.zenfg-inspector-memory-allocation-group')].map(group => group.dataset.allocationId);
		assert.equal(root.querySelectorAll('.zenfg-inspector-memory-resource').length, 1, 'only the unallocated row is initially a logical row');
		assert.equal(root.querySelectorAll('[data-allocation-toggle]').length, 3, 'Single and Shared share expansion behavior');
		changeSelect(root, 'Memory sort', 'size'); assert.deepEqual(ids(), ['allocation:b', 'allocation:u', 'allocation:a', 'allocation:c']);
		allocationToggle(root, 'allocation:b').click(); allocationToggle(root, 'allocation:a').click();
		assert.deepEqual(ids(), ['allocation:b', 'allocation:u', 'allocation:a', 'allocation:c']);
		assert.equal(root.querySelector('.zenfg-inspector-memory-allocation-group .zenfg-inspector-memory-size')!.getAttribute('data-scope'), 'physical');
		assert.equal(root.querySelector('.zenfg-inspector-memory-allocation-resources .zenfg-inspector-memory-size')!.getAttribute('data-scope'), 'logical');
		env.view.setSnapshot(createDebugViewModel(source)); assert.equal(allocationToggle(root, 'allocation:b').getAttribute('aria-expanded'), 'true');
	} finally { env.close(); }
});
