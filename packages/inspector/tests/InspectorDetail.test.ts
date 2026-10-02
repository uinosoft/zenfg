import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { InspectorView } from '../src/panelInspectorView.ts';
import { resolveNodeSelection, resolveSelectedCanonicalDetail, selectionExists } from '../src/panelSelection.ts';
import type { Selection } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function fixture(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
}

function installDom(): Window {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'navigator', window.navigator);
	Reflect.set(globalThis, 'Event', window.Event);
	return window;
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
	const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === text || candidate.getAttribute('aria-label') === text);
	assert.ok(found, `Missing button ${text}`);
	return found;
}

function detailView(callbacks: Partial<WorkbenchCallbacks> = {}): InspectorView {
	const view = new InspectorView({
		onSelect: () => {}, onHover: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => false,
		...callbacks,
	}, () => {}, 'test');
	document.body.appendChild(view.root);
	return view;
}

test('canonical detail returns exactly the source object for every selection kind', () => {
	const source = fixture();
	const vm = createDebugViewModel(source);
	assert.equal(source.memory.allocationReport.status, 'available');
	const allocations = source.memory.allocationReport.status === 'available' ? source.memory.allocationReport.allocations : [];
	const cases: readonly [Selection, string, unknown][] = [
		[{ kind: 'node', id: 'node:scene' }, '$.graph.nodes[0]', source.graph.nodes[0]],
		[{ kind: 'culled', id: 'node:unused' }, '$.graph.nodes[3]', source.graph.nodes[3]],
		[{ kind: 'group', pathKey: vm.debugGroups[0]!.pathKey }, '$.graph.groups[0]', source.graph.groups[0]],
		[{ kind: 'resource', id: 'resource:scene-color' }, '$.graph.resources[0]', source.graph.resources[0]],
		[{ kind: 'root', key: vm.roots[0]!.key }, '$.graph.roots[0]', source.graph.roots[0]],
		[{ kind: 'allocation', id: 'allocation:texture-0' }, '$.memory.allocationReport.allocations[0]', allocations[0]],
		[{ kind: 'segment', index: 1 }, '$.graph.segments[1]', source.graph.segments[1]],
	];
	for (const [selection, path, value] of cases) {
		const detail = resolveSelectedCanonicalDetail(vm, selection);
		assert.equal(detail?.path, path);
		assert.strictEqual(detail?.value, value);
		assert.deepEqual(detail?.value, value);
	}
	assert.equal(resolveSelectedCanonicalDetail(vm, undefined), undefined);
	assert.equal(resolveSelectedCanonicalDetail(vm, { kind: 'node', id: 'missing' }), undefined);
});

test('node selections follow stable IDs through reorder and retained/culled transitions', () => {
	const source = fixture();
	const vm = createDebugViewModel(source);
	assert.deepEqual(resolveNodeSelection(vm, 'node:scene'), { kind: 'node', id: 'node:scene' });
	assert.deepEqual(resolveNodeSelection(vm, 'node:unused'), { kind: 'culled', id: 'node:unused' });
	const changed = createDebugViewModel({ ...source, graph: { ...source.graph, nodes: [...source.graph.nodes].reverse().map((node) => (
		node.id === 'node:scene' ? { ...node, compileState: { status: 'culled', reason: 'unused' } }
			: node.id === 'node:unused' ? { ...node, compileState: { status: 'retained', executionOrder: 3 } } : node
	)) } });
	assert.deepEqual(resolveNodeSelection(changed, 'node:scene'), { kind: 'culled', id: 'node:scene' });
	assert.deepEqual(resolveNodeSelection(changed, 'node:unused'), { kind: 'node', id: 'node:unused' });
	assert.equal(selectionExists(changed, { kind: 'culled', id: 'node:scene' }), true);
	assert.equal(selectionExists(changed, { kind: 'culled', id: 'missing' }), false);
	assert.equal(resolveNodeSelection(changed, 'missing'), undefined);
	assert.equal(resolveSelectedCanonicalDetail(changed, { kind: 'culled', id: 'node:scene' })?.path, '$.graph.nodes[3]');
});

test('details start closed, clear disappeared selections, and cache canonical Raw only for the current object', () => {
	const window = installDom();
	try {
		const view = detailView();
		const vm = createDebugViewModel(fixture());
		view.setSnapshot(vm);
		assert.equal(view.isOpen, false);
		assert.equal(view.root.hidden, true);
		assert.equal(view.root.querySelector('.zenfg-inspector-raw-view'), null);
		view.setSelection({ kind: 'node', id: 'node:scene' });
		assert.equal(view.isOpen, true);
		button(view.root, 'Raw').click();
		const raw = view.root.querySelector('.zenfg-inspector-raw-view');
		assert.ok(raw);
		assert.match(raw.textContent!, /\$\.graph\.nodes\[0\]/);
		assert.doesNotMatch(raw.textContent!, /gpuDurationMicros|debugGroupPath|executionSegment/);
		button(view.root, 'Summary').click();
		button(view.root, 'Raw').click();
		assert.strictEqual(view.root.querySelector('.zenfg-inspector-raw-view'), raw);
		view.setSnapshot(createDebugViewModel(fixture()));
		assert.notStrictEqual(view.root.querySelector('.zenfg-inspector-raw-view'), raw);
		view.setSelection(undefined);
		assert.equal(view.isOpen, false);
		assert.equal(view.root.hidden, true);
	} finally { window.close(); }
});

test('Raw search retains matching ancestors while copy always includes the complete object', async () => {
	const window = installDom();
	try {
		let copied = '';
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
		const source = fixture();
		const view = detailView();
		view.setSnapshot(createDebugViewModel(source));
		view.setSelection({ kind: 'resource', id: 'resource:scene-color' });
		button(view.root, 'Raw').click();
		const search = view.root.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = 'width';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		const tree = view.root.querySelector('.zenfg-inspector-raw-detail')!;
		assert.match(tree.textContent!, /descriptor:.*size:.*width: 1920/);
		assert.equal(tree.querySelector('mark')?.textContent, 'width');
		assert.doesNotMatch(tree.textContent!, /height:|usageFlags:/);
		assert.ok([...tree.querySelectorAll('details')].every((details) => details.open));
		button(view.root, 'Copy object').click();
		await Promise.resolve();
		assert.deepEqual(JSON.parse(copied), source.graph.resources[0]);
		search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }) as unknown as KeyboardEvent);
		assert.equal(search.value, '');
		assert.match(tree.textContent!, /usageFlags:/);
	} finally { window.close(); }
});

test('Summary differentiates missing, partial, zero and opaque timing and presents diagnostics and ranges', () => {
	const window = installDom();
	try {
		const source = fixture();
		const view = detailView();
		const unavailable = createDebugViewModel({ ...source, timings: { cpu: { status: 'unavailable', reason: 'not-requested' }, gpu: { status: 'unavailable', reason: 'disabled' } } });
		view.setSnapshot(unavailable);
		view.setSelection({ kind: 'group', pathKey: unavailable.debugGroups[0]!.pathKey });
		assert.match(view.root.textContent!, /Not collected/);
		assert.doesNotMatch(view.root.textContent!, /0\.000 ms/);
		view.setSnapshot(createDebugViewModel({ ...source, timings: { cpu: { status: 'unavailable', reason: 'not-requested' }, gpu: { status: 'available', frameSpanMicros: 10, nodes: [{ nodeId: 'node:scene', durationMicros: 0 }] } } }));
		assert.match(view.root.textContent!, /Partial.*1\/2 timed/);
		assert.match(view.root.textContent!, /0\.000 ms/);
		view.setSelection({ kind: 'node', id: 'node:external' });
		assert.match(view.root.textContent!, /Opaque.*external work is not measured/);
		view.setSelection({ kind: 'resource', id: 'resource:scene-color' });
		assert.match(view.root.textContent!, /example-warning.*Fixture diagnostic/);
		view.setSelection({ kind: 'root', key: unavailable.roots[0]!.key });
		assert.match(view.root.textContent!, /mip 0–0.*layers 0–0.*aspect all/);
		assert.doesNotMatch(view.root.textContent!, /baseMipLevel/);
	} finally { window.close(); }
});

test('Relations preserve selection and hover while explicit locate is separate and culled links use IDs', () => {
	const window = installDom();
	try {
		const selections: Selection[] = [];
		const hovered: (Selection | undefined)[] = [];
		const reveals: [Selection, string][] = [];
		const view = detailView({ onSelect: (selection) => selections.push(selection), onHover: (selection) => hovered.push(selection),
			onReveal: (selection, page) => reveals.push([selection, page]) });
		view.setSnapshot(createDebugViewModel(fixture()));
		view.setSelection({ kind: 'resource', id: 'resource:unused-data' });
		button(view.root, 'Relations').click();
		const link = button(view.root, 'unused (culled)');
		link.dispatchEvent(new Event('mouseenter'));
		assert.deepEqual(hovered.at(-1), { kind: 'culled', id: 'node:unused' });
		link.click();
		assert.deepEqual(selections, [{ kind: 'culled', id: 'node:unused' }]);
		assert.equal(hovered.at(-1), undefined);
		assert.deepEqual(reveals, []);
		const locate = button(view.root, 'Locate in Passes: unused (culled)');
		assert.equal(locate.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
		locate.click();
		assert.deepEqual(reveals, [[{ kind: 'culled', id: 'node:unused' }, 'passes']]);
		view.setSelection({ kind: 'node', id: 'node:scene' });
		assert.match(view.root.textContent!, /Value dependencies.*Downstream.*scene-color/);
	} finally { window.close(); }
});

test('Summary prioritizes identity, measured metrics and related diagnostics before auxiliary facts', () => {
	const window = installDom();
	try {
		const source = fixture();
		const view = detailView({ onReveal: () => {} });
		view.setSnapshot(createDebugViewModel({ ...source, diagnostics: [
			{ severity: 'warning', code: 'scope-warning', message: 'Keep the complete warning.', nodeId: 'node:scene' },
		], timings: { ...source.timings, gpu: { status: 'available', frameSpanMicros: 0, nodes: [{ nodeId: 'node:scene', durationMicros: 0 }] } } }));
		view.setSelection({ kind: 'node', id: 'node:scene' });
		const identity = view.root.querySelector('.zenfg-inspector-detail-identity')!;
		assert.match(identity.textContent!, /renderRetainednode:scene/);
		assert.equal(button(identity as HTMLElement, 'Copy full object ID').querySelector('svg')?.dataset.icon, 'copy');
		const summary = view.root.querySelector('.zenfg-inspector-detail-summary')!;
		const metrics = summary.querySelector('.zenfg-inspector-detail-metrics')!;
		assert.match(metrics.textContent!, /GPU duration0\.000 ms/);
		assert.match(metrics.textContent!, /CPU durationNot collected/);
		assert.equal(metrics.querySelector('.zenfg-inspector-detail-metric-unit')?.textContent, ' ms');
		const sections = [...summary.children];
		const diagnostics = summary.querySelector('.zenfg-inspector-detail-diagnostics')!;
		assert.match(diagnostics.textContent!, /scope-warning.*Keep the complete warning/);
		assert.ok(sections.indexOf(diagnostics) > sections.indexOf(metrics));
		assert.ok(sections.indexOf(diagnostics) < sections.findIndex((element) => element.tagName === 'DETAILS'));
		assert.ok([...summary.querySelectorAll('details')].every((section) => !section.open));
		assert.match(summary.textContent!, /execution success is not implied/);
		assert.match(summary.textContent!, /GPU timestamp interval/);
	} finally { window.close(); }
});

test('Summary auxiliary section preferences survive capture refresh, tab switches and object revisits', () => {
	const window = installDom();
	try {
		const view = detailView();
		const section = () => view.root.querySelector<HTMLDetailsElement>('details[data-section-key="node:node:scene:accesses"]')!;
		view.setSnapshot(createDebugViewModel(fixture()));
		view.setSelection({ kind: 'node', id: 'node:scene' });
		assert.equal(section().open, false);
		section().open = true;
		view.setSnapshot(createDebugViewModel(fixture()));
		assert.equal(section().open, true);
		button(view.root, 'Raw').click();
		button(view.root, 'Summary').click();
		assert.equal(section().open, true);
		view.setSelection({ kind: 'node', id: 'node:present' });
		assert.equal(view.root.querySelector<HTMLDetailsElement>('details[data-section-key="node:node:present:accesses"]')!.open, false);
		view.setSelection({ kind: 'node', id: 'node:scene' });
		assert.equal(section().open, true);
		section().open = false;
		view.setSnapshot(createDebugViewModel(fixture()));
		assert.equal(section().open, false);
	} finally { window.close(); }
});

test('entity copy icon copies the full ID and keeps its accessible name after feedback', async () => {
	const window = installDom();
	try {
		let copied = '';
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
		const view = detailView();
		view.setSnapshot(createDebugViewModel(fixture()));
		view.setSelection({ kind: 'resource', id: 'resource:scene-color' });
		const copy = button(view.root, 'Copy full object ID');
		copy.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(copied, 'resource:scene-color');
		assert.equal(copy.getAttribute('aria-label'), 'Copy full object ID');
		assert.equal(copy.querySelector('svg')?.dataset.icon, 'copy');
		assert.equal(view.root.querySelector('.zenfg-inspector-detail-copy-status')?.textContent, 'Copied');
	} finally { window.close(); }
});

test('detail tabs support arrow, Home and End with a single tab stop', () => {
	const window = installDom();
	try {
		const view = detailView();
		view.setSnapshot(createDebugViewModel(fixture()));
		view.setSelection({ kind: 'node', id: 'node:scene' });
		button(view.root, 'Summary').focus();
		const tabs = view.root.querySelector('[role="tablist"]')!;
		for (const [key, selected] of [['ArrowRight', 'Relations'], ['End', 'Raw'], ['Home', 'Summary']]) {
			tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }) as unknown as KeyboardEvent);
			assert.equal(button(view.root, selected!).getAttribute('aria-selected'), 'true');
			assert.equal(tabs.querySelectorAll('[tabindex="0"]').length, 1);
		}
	} finally { window.close(); }
});

test('replacing a focused relation keeps focus on the active detail tab', () => {
	const window = installDom();
	try {
		const view = detailView({ onSelect: (selected) => view.setSelection(selected) });
		view.setSnapshot(createDebugViewModel(fixture()));
		view.setSelection({ kind: 'resource', id: 'resource:scene-color' });
		button(view.root, 'Relations').click();
		const link = button(view.root, 'scene');
		link.focus();
		link.click();
		assert.strictEqual(document.activeElement, button(view.root, 'Relations'));
		assert.equal(document.activeElement?.isConnected, true);
	} finally { window.close(); }
});

test('Raw identifies canonical migration provenance and does not resolve unavailable allocations', () => {
	const window = installDom();
	try {
		const migrated = JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/legacy-candidate-v1.expected.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
		const vm = createDebugViewModel(migrated);
		const node = vm.nodes[0]!;
		assert.ok(node);
		const view = detailView();
		view.setSnapshot(vm);
		view.setSelection({ kind: 'node', id: node.id });
		button(view.root, 'Raw').click();
		assert.match(view.root.textContent!, /Legacy import: showing the migrated canonical Snapshot object/);
		const unavailable = createDebugViewModel({ ...fixture(), memory: { ...fixture().memory, allocationReport: { status: 'unavailable', reason: 'not-captured' } } });
		assert.equal(resolveSelectedCanonicalDetail(unavailable, { kind: 'allocation', id: 'allocation:texture-0' }), undefined);
	} finally { window.close(); }
});

test('resource details offer Memory navigation only for transients and distinguish allocation ownership from availability', () => {
	const window = installDom();
	try {
		const source = fixture();
		const view = detailView({ onReveal: () => {} });
		view.setSnapshot(createDebugViewModel(source));
		view.setSelection({ kind: 'resource', id: 'resource:backbuffer' });
		assert.match(view.root.textContent!, /Not applicable · externally owned resource/);
		assert.doesNotMatch(view.root.textContent!, /Locate in Memory|Unallocated/);
		view.setSelection({ kind: 'resource', id: 'resource:unused-data' });
		assert.match(view.root.textContent!, /Locate in Memory/);
		assert.match(view.root.textContent!, /AllocationUnallocated/);
		const unavailable: FrameGraphSnapshot = { ...source, memory: { ...source.memory,
			allocationReport: { status: 'unavailable', reason: 'not-requested' },
		}, graph: { ...source.graph, resources: source.graph.resources.map((resource) => ({ ...resource, allocationId: undefined })) } };
		view.setSnapshot(createDebugViewModel(unavailable));
		assert.match(view.root.textContent!, /AllocationUnavailable · allocation report not captured/);
		assert.doesNotMatch(view.root.textContent!, /AllocationUnallocated/);
		view.setSnapshot(createDebugViewModel({ ...unavailable, graph: { ...unavailable.graph,
			resources: unavailable.graph.resources.map((resource) => resource.id === 'resource:unused-data' ? { ...resource, origin: 'imported', initialContents: 'defined' } : resource),
		} }));
		assert.match(view.root.textContent!, /Not applicable · externally owned resource/);
		assert.doesNotMatch(view.root.textContent!, /Locate in Memory/);
	} finally { window.close(); }
});

test('empty and culled-only group pass sums are inapplicable rather than missing measurements', () => {
	const window = installDom();
	try {
		const source = fixture();
		const vm = createDebugViewModel({ ...source, graph: { ...source.graph,
			groups: [...source.graph.groups, { id: 'group:empty', label: 'Empty' }, { id: 'group:culled-only', label: 'Culled only' }],
			nodes: source.graph.nodes.map(node => node.id === 'node:unused' ? { ...node, groupId: 'group:culled-only' } : node),
		} });
		const view = detailView(); view.setSnapshot(vm);
		for (const id of ['group:empty', 'group:culled-only']) {
			view.setSelection({ kind: 'group', pathKey: vm.groupById.get(id)!.pathKey });
			assert.match(view.root.querySelector('.zenfg-inspector-detail-metrics')!.textContent!, /GPU pass sumNot applicableCPU pass sumNot applicable/);
		}
	} finally { window.close(); }
});

test('Raw highlights source characters correctly after length-changing case folds', () => {
	const window = installDom();
	try {
		const source = fixture();
		const view = detailView();
		view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph,
			nodes: source.graph.nodes.map(node => node.id === 'node:scene' ? { ...node, label: 'İstanbul İ renderer' } : node),
		} }));
		view.setSelection({ kind: 'node', id: 'node:scene' });
		button(view.root, 'Raw').click();
		const search = view.root.querySelector<HTMLInputElement>('input[type="search"]')!;
		for (const [query, expected] of [['stan', ['stan']], ['i', ['İ', 'İ']]] as const) {
			search.value = query;
			search.dispatchEvent(new Event('input', { bubbles: true }));
			const leaf = [...view.root.querySelectorAll('.zenfg-inspector-raw-leaf')].find(item => item.textContent?.startsWith('label:'))!;
			assert.equal(leaf.textContent, 'label: "İstanbul İ renderer"');
			assert.deepEqual([...leaf.querySelectorAll('mark')].map(mark => mark.textContent), [...expected]);
		}
	} finally { window.close(); }
});

test('allocation Summary labels zero logical members as unreferenced', () => {
	const window = installDom();
	try {
		const source = fixture();
		assert.equal(source.memory.allocationReport.status, 'available');
		if (source.memory.allocationReport.status !== 'available') throw new Error('Fixture allocation report unavailable');
		const view = detailView();
		view.setSnapshot(createDebugViewModel({ ...source, memory: { ...source.memory,
			allocationReport: { ...source.memory.allocationReport, allocations: [...source.memory.allocationReport.allocations,
				{ id: 'allocation:orphan', kind: 'buffer', compatibilityClassId: 'compatibility:orphan', estimatedByteSize: 64 },
			] },
		} }));
		view.setSelection({ kind: 'allocation', id: 'allocation:orphan' });
		assert.match(view.root.querySelector('.zenfg-inspector-detail-metrics')!.textContent!, /Physical estimate64 B.*Logical resources0/);
		assert.match(view.root.querySelector('.zenfg-inspector-detail-summary')!.textContent!, /AliasUnreferenced/);
		assert.doesNotMatch(view.root.querySelector('.zenfg-inspector-detail-summary')!.textContent!, /single/);
	} finally { window.close(); }
});
