import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
	FRAME_GRAPH_SNAPSHOT_FORMAT, FRAME_GRAPH_SNAPSHOT_VERSION,
	type FrameGraphSnapshot, type FrameGraphSnapshotAllocation, type FrameGraphSnapshotResource,
} from '@zenfg/snapshot';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { analyzeSnapshotAliases } from '../src/panelAliasAnalysis.ts';
import { MemoryView } from '../src/panelMemoryView.ts';
import { PANEL_MEMORY_CSS } from '../src/panelMemoryStyles.ts';
import type { Selection } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

test('memory uses inclusive nonzero execution slots shared by ticks, gridlines, and bars', () => {
	const env = mountMemory();
	try {
		const { root } = env.view;
		const axis = root.querySelector('.zenfg-inspector-memory-axis')!;
		assert.equal(axis.children[2]!.className, 'zenfg-inspector-memory-axis-track');
		assert.match(PANEL_MEMORY_CSS, /\.zenfg-inspector-memory-axis-track,\s*\.zenfg-inspector-memory-track\s*\{ grid-column: 3; \}/);
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
		assert.match(root.querySelector('.zenfg-inspector-memory-allocation')!.textContent!, /aliased ×2/);
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
		assert.match(metric(env.view.root, 'Physical estimate'), /Unknown · 2\/3 sizes known/);
		assert.match(metric(env.view.root, 'Logical capacity'), /Unknown · 3\/4 sizes known/);
		const base = snapshot([resource('unallocated')], []);
		env.view.setSnapshot(createDebugViewModel({ ...base, memory: {
			allocationReport: { status: 'unavailable', reason: 'Not captured' },
			poolReport: { status: 'unavailable', reason: 'Not captured' },
		} }));
		for (const label of ['Logical capacity', 'Physical estimate', 'Alias reuse', 'Pool retained', 'Allocations']) {
			assert.equal(metric(env.view.root, label), 'Not collected');
		}
		assert.match(env.view.root.textContent!, /allocation report unavailable/);
		env.view.setSnapshot(createDebugViewModel(snapshot([], [])));
		for (const label of ['Resource estimate', 'Logical capacity', 'Physical estimate', 'Alias reuse', 'Pool retained']) {
			assert.equal(metric(env.view.root, label), '0 B');
		}
		assert.equal(metric(env.view.root, 'Allocations'), '0 · 0 aliased');
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
		timings: { gpu: { status: 'unavailable', reason: 'not collected' } }, diagnostics: [], extensions: {},
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
	return Array.from(root.querySelectorAll('.zenfg-inspector-memory-summary > div')).find((item) => item.querySelector('span')!.textContent === label)!.querySelector('strong')!.textContent!;
}
