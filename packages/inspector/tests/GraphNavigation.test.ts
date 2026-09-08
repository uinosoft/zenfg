import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot, FrameGraphSnapshotNode } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { FrameGraphInspector } from '../src/FrameGraphInspector.ts';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { resolveGraphScene } from '../src/panelGraphView.ts';
import type { GraphViewState } from '../src/panelTypes.ts';

test('explicit group navigation enables Groups and expands ancestors while ordinary selection leaves them alone', () => {
	const source = fixture();
	const env = mount(source, 1);
	try {
		const groups = button(env.panel.dom.querySelector('.zenfg-inspector-graph-toolbar')!, 'Groups');
		groups.click();
		assert.equal(groups.getAttribute('aria-pressed'), 'false');
		tab(env.panel, 'Passes').click();
		button(env.panel.dom.querySelector('.zenfg-inspector-passes-view')!, 'Group Hierarchy').click();
		const row = groupRow(env.panel, 'PostFX');
		button(row, 'PostFX').click();
		assert.equal(tab(env.panel, 'Passes').getAttribute('aria-selected'), 'true');
		assert.equal(env.graph.groupsEnabled, false);
		assert.deepEqual([...env.graph.expandedGroupPaths], []);
		button(row, 'Show in Graph').click();
		assert.equal(tab(env.panel, 'Graph').getAttribute('aria-selected'), 'true');
		assert.equal(env.graph.groupsEnabled, true);
		assert.equal(groups.getAttribute('aria-pressed'), 'true');
		const vm = createDebugViewModel(source);
		assert.ok(env.graph.expandedGroupPaths.has(vm.groupById.get('group:main')!.pathKey));
		const scene = resolveGraphScene(env.graph, vm);
		assert.ok(scene.nodes.some((node) => node.kind === 'group' && node.groupId === 'group:postfx'));
	} finally { env.close(); }
});

test('empty and culled-only groups show a useful navigation failure and preserve the current page and projection', () => {
	const base = fixture();
	const source: FrameGraphSnapshot = { ...base, graph: { ...base.graph,
		groups: [...base.graph.groups, { id: 'group:empty', label: 'Empty', parentId: 'group:main' }, { id: 'group:culled', label: 'Culled Only', parentId: 'group:main' }],
		nodes: base.graph.nodes.map((node) => node.compileState.status === 'culled' ? { ...node, groupId: 'group:culled' } : node),
	} };
	const env = mount(source, 1);
	try {
		button(env.panel.dom.querySelector('.zenfg-inspector-graph-toolbar')!, 'Groups').click();
		tab(env.panel, 'Passes').click();
		button(env.panel.dom.querySelector('.zenfg-inspector-passes-view')!, 'Group Hierarchy').click();
		for (const label of ['Empty', 'Culled Only']) {
			const before = [...env.graph.expandedGroupPaths];
			button(groupRow(env.panel, label), 'Show in Graph').click();
			assert.equal(tab(env.panel, 'Passes').getAttribute('aria-selected'), 'true');
			assert.equal(env.graph.groupsEnabled, false);
			assert.deepEqual([...env.graph.expandedGroupPaths], before);
			const feedback = env.panel.dom.querySelector<HTMLDetailsElement>('.zenfg-inspector-feedback')!;
			assert.equal(feedback.hidden, false);
			assert.equal(feedback.open, true);
			assert.match(feedback.textContent!, /no representation in Frame Flow/);
			button(feedback, 'Show in passes').click();
			assert.equal(groupRow(env.panel, label).classList.contains('selected'), true);
		}
	} finally { env.close(); }
});

test('the default graph element budget preserves large lists and renders inactive pages only on first use', () => {
	const source = largeSnapshot(5001);
	const env = mount(source);
	try {
		const dom = env.panel.dom;
		assert.equal(env.graph.renderer, undefined);
		assert.match(env.graph.host.textContent!, /5001 graph elements exceed the 5000 element budget/);
		const passes = dom.querySelector('.zenfg-inspector-passes-view')!;
		const resources = dom.querySelector('.zenfg-inspector-resources-view')!;
		const memory = dom.querySelector('.zenfg-inspector-memory-view')!;
		assert.equal(passes.querySelectorAll('tbody tr').length, 0);
		assert.equal(resources.querySelectorAll('tbody tr').length, 0);
		assert.equal(memory.querySelectorAll('.zenfg-inspector-memory-resource').length, 0);
		tab(env.panel, 'Passes').click();
		assert.equal(passes.querySelectorAll('tr[data-selection-key]').length, 5001);
		const query = passes.querySelector<HTMLInputElement>('input[aria-label="Search pass, ID or group"]')!;
		query.value = 'Pass 5000';
		query.dispatchEvent(new Event('input'));
		assert.equal(passes.querySelectorAll('tr[data-selection-key]').length, 1);
		button(passes, 'Pass 5000').click();
		assert.equal(dom.querySelector('.zenfg-inspector-inspector > header strong')!.textContent, 'Pass 5000');
		assert.equal(resources.querySelectorAll('tbody tr').length, 0);
		tab(env.panel, 'Resources').click();
		assert.equal(resources.querySelectorAll('tr[data-selection-key]').length, 1);
		assert.equal(memory.querySelectorAll('.zenfg-inspector-memory-resource').length, 0);
		const changed: FrameGraphSnapshot = { ...source, capture: { frameIndex: 2 }, graph: { ...source.graph,
			nodes: source.graph.nodes.map((node) => node.id === 'node:5000' ? { ...node, label: 'Pass 5000 updated' } : node),
		} };
		env.panel.setSnapshot(changed);
		assert.equal(button(passes, 'Pass 5000').textContent, 'Pass 5000', 'hidden list DOM remains deferred after capture');
		tab(env.panel, 'Passes').click();
		assert.equal(passes.querySelectorAll('tr[data-selection-key]').length, 1, 'search survives a new capture');
		assert.equal(button(passes, 'Pass 5000 updated').textContent, 'Pass 5000 updated');
		tab(env.panel, 'Memory').click();
		assert.equal(memory.querySelectorAll('.zenfg-inspector-memory-resource').length, 1);
		assert.equal(env.graph.renderer, undefined);
	} finally { env.close(); }
});

function fixture(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
}

function largeSnapshot(count: number): FrameGraphSnapshot {
	const base = fixture();
	const nodes: FrameGraphSnapshotNode[] = Array.from({ length: count }, (_, index) => ({
		id: `node:${index}`, label: `Pass ${index}`, kind: 'command', sideEffect: true, recordingOrder: index,
		compileState: { status: 'retained', executionOrder: index },
	}));
	return { ...base, capture: { frameIndex: 1 },
		graph: { groups: [], nodes, resources: [{ id: 'resource:unused', label: 'Unused buffer', kind: 'buffer', origin: 'transient', initialContents: 'undefined', usageFlags: [], estimatedByteSize: 64 }],
			textureViews: [], accesses: [], dependencies: [], roots: nodes.map((node) => ({ reason: 'side-effect', nodeId: node.id })),
			segments: [{ id: 'segment:0', order: 0, kind: 'frame-graph', nodeIds: nodes.map((node) => node.id) }],
		},
		memory: { allocationReport: { status: 'available', allocations: [] }, poolReport: { status: 'unavailable', reason: 'Synthetic capture' } },
		timings: { gpu: { status: 'unavailable', reason: 'Synthetic capture' } }, diagnostics: [], extensions: {},
	};
}

function mount(snapshot: FrameGraphSnapshot, maxGraphElements?: number) {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'navigator', window.navigator);
	Reflect.set(globalThis, 'Event', window.Event);
	const panel = new FrameGraphInspector(maxGraphElements === undefined ? {} : { maxGraphElements });
	document.body.append(panel.dom);
	panel.setSnapshot(snapshot);
	const graph = (panel as unknown as { graphView: GraphViewState }).graphView;
	return { panel, graph, close: () => { panel.destroy(); window.close(); } };
}

function button(root: ParentNode, label: string): HTMLButtonElement {
	const match = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent === label);
	assert.ok(match, `Expected button ${label}`);
	return match;
}

function tab(panel: FrameGraphInspector, label: string): HTMLButtonElement {
	return button(panel.dom.querySelector('.zenfg-inspector-workbench-tabs')!, label);
}

function groupRow(panel: FrameGraphInspector, label: string): HTMLElement {
	return button(panel.dom.querySelector('.zenfg-inspector-passes-view')!, label).closest('tr')!;
}
