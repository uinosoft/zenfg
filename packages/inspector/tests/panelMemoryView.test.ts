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
		assert.match(root.textContent!, /No resources match these filters/);
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
		assert.deepEqual(Array.from(root.querySelectorAll<HTMLElement>('.zenfg-inspector-memory-allocation[data-selection-key]'), (header) => header.dataset.selectionKey), ['allocation:allocation:a', 'allocation:allocation:b', 'allocation:allocation:c']);
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
		const row = root.querySelector<HTMLElement>('[data-selection-key="resource:resource:alpha"]')!;
		assert.equal(row.classList.contains('selected'), true);
		assert.equal(document.activeElement, row.querySelector('button'));
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
		for (const label of ['Logical capacity', 'Physical allocation estimate', 'Alias savings estimate', 'Allocations']) {
			assert.equal(metric(env.view.root, label), 'Unavailable');
		}
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-pool')!.textContent!, /Unavailable · Not captured/);
		assert.equal(env.view.root.querySelector<HTMLOptionElement>('option[value="unallocated"]')!.textContent, 'Allocation unavailable');
		assert.match(env.view.root.textContent!, /allocation report unavailable/);
		env.view.setSnapshot(createDebugViewModel(snapshot([], [])));
		for (const label of ['Logical transient estimate', 'Logical capacity', 'Physical allocation estimate', 'Alias savings estimate', 'Idle retained estimate']) {
			assert.equal(metric(env.view.root, label), '0 B');
		}
		assert.equal(metric(env.view.root, 'Allocations'), '0');
		assert.match(env.view.root.querySelector('.zenfg-inspector-memory-summary')!.textContent!, /0 shared · 0 single/);
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
		assert.equal(document.activeElement, allocationToggle(root, 'allocation:a'));
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
		const alpha = root.querySelector<HTMLElement>('[data-selection-key="resource:resource:alpha"]')!;
		assert.equal(alpha.classList.contains('selected'), true);
		assert.equal(document.activeElement, alpha.querySelector('button'));
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
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'true');
		allocationToggle(root, 'allocation:a').click();
		env.view.reveal({ kind: 'allocation', id: 'allocation:a' });
		assert.equal(allocationToggle(root, 'allocation:a').getAttribute('aria-expanded'), 'true');
		assert.equal(document.activeElement, root.querySelector('[data-selection-key="allocation:allocation:a"] .zenfg-inspector-relation-button'));
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
		assert.equal(root.querySelector('.zenfg-inspector-memory-summary')!.children.length, 3);
		assert.equal(metric(root, 'Physical allocation estimate'), '128 B');
		assert.equal(metric(root, 'Alias savings estimate'), '0 B');
		assert.equal(metric(root, 'Logical transient estimate'), '64 B');
		assert.equal(metric(root, 'Logical capacity'), '128 B');
		assert.equal(metric(root, 'Idle retained estimate'), '1.0 KiB');
		assert.equal(metric(root, 'Idle allocations'), '4');
		assert.equal(metric(root, 'Cumulative reuse'), '75.0%');
		env.view.setSnapshot(createDebugViewModel(base));
		assert.equal(metric(root, 'Cumulative reuse'), 'Not applicable');
		assert.equal(metric(root, 'Idle retained estimate'), '0 B');
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
		assert.match(root.querySelector('.zenfg-inspector-memory-summary')!.textContent!, /0 shared · 1 single · 1 unreferenced/);
		const header = () => root.querySelector<HTMLElement>('[data-selection-key="allocation:allocation:unreferenced"]');
		assert.match(header()!.textContent!, /Unreferenced/);
		assert.doesNotMatch(header()!.textContent!, /Single/);
		assert.equal(allocationToggle(root, 'allocation:unreferenced').disabled, true);
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
		assert.equal(document.activeElement, header()!.querySelector('.zenfg-inspector-relation-button'));
		assert.equal(metric(root, 'Physical allocation estimate'), '15.9 MiB');
	} finally { env.close(); }
});

function mountMemory(protocol = snapshot(), callbacks: Partial<WorkbenchCallbacks> = {}) {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'Event', window.Event);
	const view = new MemoryView({ onSelect: () => {}, onHover: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => true, ...callbacks }, 'test');
	document.body.append(view.root);
	view.setSnapshot(createDebugViewModel(protocol));
	return { view, close: () => window.close() };
}

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
	return Array.from(root.querySelectorAll<HTMLElement>('.zenfg-inspector-memory-axis-track > span'), (tick) => [tick.textContent!, tick.style.left]);
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
