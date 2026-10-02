import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateFrameGraphSnapshot, type FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { labelNode, labelResource } from '../src/panelDomHelpers.ts';
import { OverviewView } from '../src/panelOverviewView.ts';
import { PassesView } from '../src/panelPassesView.ts';
import { ResourcesView } from '../src/panelResourcesView.ts';
import { resolveSelectedCanonicalDetail, selectionExists } from '../src/panelSelection.ts';
import type { Selection, WorkbenchTab } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function fixture(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8'));
}

test('legal whitespace-only group labels use ID display fallback without changing canonical facts', () => {
	const source = fixture();
	const protocol: FrameGraphSnapshot = { ...source, graph: { ...source.graph,
		groups: source.graph.groups.map((group) => group.id === 'group:main' ? { ...group, label: ' \t\n' } : group),
	} };
	assert.deepEqual(validateFrameGraphSnapshot(protocol), []);
	const model = createDebugViewModel(protocol);
	assert.equal(model.groupById.get('group:main')!.label, 'group:main');
	assert.deepEqual(model.groupById.get('group:postfx')!.path, ['group:main', 'PostFX']);
	assert.equal(model.protocol, protocol);
	assert.equal(model.protocol.graph.groups[0]!.label, ' \t\n');
	const selection: Selection = { kind: 'group', pathKey: model.groupById.get('group:main')!.pathKey };
	assert.equal(selectionExists(model, selection), true);
	assert.deepEqual(resolveSelectedCanonicalDetail(model, selection), { path: '$.graph.groups[0]', value: protocol.graph.groups[0] });
});

test('same-named parents and siblings retain distinct group identities and normal label text', () => {
	const source = fixture();
	const protocol: FrameGraphSnapshot = { ...source, graph: { ...source.graph, groups: [
		{ id: 'group:main', label: ' Main ' },
		{ id: 'group:second-parent', label: 'Main' },
		{ id: 'group:postfx', parentId: 'group:main', label: ' Layer ' },
		{ id: 'group:sibling', parentId: 'group:main', label: 'Layer' },
		{ id: 'group:other-child', parentId: 'group:second-parent', label: 'Layer' },
		{ id: 'group:blank-child', parentId: 'group:main', label: '\t' },
		{ id: 'group:matching-fallback', parentId: 'group:main', label: 'group:blank-child' },
		{ id: 'group:blank ', label: ' ' },
		{ id: 'group:matching-trimmed-id', label: 'group:blank' },
	] } };
	assert.deepEqual(validateFrameGraphSnapshot(protocol), []);
	const model = createDebugViewModel(protocol);
	assert.equal(new Set(model.debugGroups.map((group) => group.pathKey)).size, protocol.graph.groups.length);
	assert.equal(model.groupByPathKey.size, protocol.graph.groups.length);
	assert.equal(model.groupById.get('group:main')!.label, ' Main ');
	assert.deepEqual(model.groupById.get('group:postfx')!.path, [' Main ', ' Layer ']);
	assert.deepEqual(JSON.parse(model.groupById.get('group:postfx')!.pathKey), [['Main', 0], ['Layer', 0]]);
	assert.deepEqual(JSON.parse(model.groupById.get('group:sibling')!.pathKey), [['Main', 0], ['Layer', 1]]);
	assert.notEqual(model.groupById.get('group:postfx')!.pathKey, model.groupById.get('group:other-child')!.pathKey);
	assert.notEqual(model.groupById.get('group:blank-child')!.pathKey, model.groupById.get('group:matching-fallback')!.pathKey);
	assert.notEqual(model.groupById.get('group:blank ')!.pathKey, model.groupById.get('group:matching-trimmed-id')!.pathKey);
	assert.equal(model.protocol.graph.groups.find((group) => group.id === 'group:postfx')!.label, ' Layer ');
});

test('pass and resource labels fall back for missing, empty and whitespace text while preserving normal labels', () => {
	for (const label of [undefined, '', ' \t\n']) {
		assert.equal(labelNode({ id: 'node:test', label }), 'node:test');
		assert.equal(labelResource({ id: 'resource:test', kind: 'texture', label }), 'resource:test');
	}
	assert.equal(labelNode({ id: 'node:test', label: ' Scene ' }), ' Scene ');
	assert.equal(labelResource({ id: 'resource:test', kind: 'texture', label: ' Color ' }), ' Color ');
});

test('blank canonical labels remain inspectable through named Overview, Passes and Resources controls', (t) => {
	const win = new Window(); t.after(() => win.close());
	Reflect.set(globalThis, 'window', win); Reflect.set(globalThis, 'document', win.document);
	const source = fixture();
	const protocol: FrameGraphSnapshot = { ...source, graph: { ...source.graph,
		nodes: source.graph.nodes.map((node) => node.id === 'node:scene' ? { ...node, label: '' } : node),
		resources: source.graph.resources.map((resource) => resource.id === 'resource:scene-color' ? { ...resource, label: ' \t' } : resource),
	} };
	assert.deepEqual(validateFrameGraphSnapshot(protocol), []);
	const model = createDebugViewModel(protocol);
	const selections: Selection[] = [];
	const reveals: Array<readonly [Selection, WorkbenchTab]> = [];
	const callbacks: WorkbenchCallbacks = {
		onSelect: (selection) => selections.push(selection), onHover: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => true,
		onReveal: (selection, tab) => reveals.push([selection, tab]),
	};
	const overview = new OverviewView(callbacks); overview.setSnapshot(model);
	const passes = new PassesView(callbacks, 'passes'); passes.setSnapshot(model);
	const resources = new ResourcesView(callbacks, 'resources'); resources.setSnapshot(model);
	const hotspot = overview.root.querySelector<HTMLButtonElement>('tr[data-node-id="node:scene"] button')!;
	assert.equal(hotspot.textContent, 'node:scene'); hotspot.click();
	const pass = passes.root.querySelector<HTMLButtonElement>('tr[data-selection-key="node:node:scene"] td > .zenfg-inspector-relation-button')!;
	assert.equal(pass.textContent, 'node:scene'); pass.click();
	const resource = resources.root.querySelector<HTMLButtonElement>('tr[data-selection-key="resource:resource:scene-color"] td > .zenfg-inspector-relation-button')!;
	assert.equal(resource.textContent, 'resource:scene-color'); resource.click();
	assert.deepEqual(reveals, [[{ kind: 'node', id: 'node:scene' }, 'passes']]);
	assert.deepEqual(selections, [{ kind: 'node', id: 'node:scene' }, { kind: 'resource', id: 'resource:scene-color' }]);
	assert.equal(model.protocol.graph.nodes[0]!.label, '');
	assert.equal(model.protocol.graph.resources[0]!.label, ' \t');
	assert.deepEqual(resolveSelectedCanonicalDetail(model, selections[0]), { path: '$.graph.nodes[0]', value: protocol.graph.nodes[0] });
	assert.deepEqual(resolveSelectedCanonicalDetail(model, selections[1]), { path: '$.graph.resources[0]', value: protocol.graph.resources[0] });
});
