import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { InspectorView } from '../src/panelInspectorView.ts';
import { ResourcesView } from '../src/panelResourcesView.ts';
import type { Selection, WorkbenchTab } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function fixture(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8'));
}
function environment(t: TestContext) {
	const window = new Window({ url: 'http://localhost/' }); t.after(() => window.close());
	for (const [key, value] of Object.entries({ window, document: window.document, Event: window.Event })) Reflect.set(globalThis, key, value);
	const selected: Selection[] = []; const revealed: Array<readonly [Selection, WorkbenchTab]> = [];
	const callbacks: WorkbenchCallbacks = { onSelect: value => selected.push(value), onHover: () => {},
		onGroupToggle: () => {}, isGroupExpanded: () => false, onReveal: (value, tab) => revealed.push([value, tab]) };
	const view = new ResourcesView(callbacks, 'resources'); document.body.append(view.root);
	return { view, callbacks, selected, revealed };
}
function element<T extends HTMLElement = HTMLElement>(host: ParentNode, selector: string): T {
	const found = host.querySelector<T>(selector); assert.ok(found, selector); return found;
}
function row(view: ResourcesView, id: string): HTMLTableRowElement {
	return element(view.root, `tr[data-selection-key="resource:resource:${id}"]`);
}
function setFilter(view: ResourcesView, label: string, value: string): void {
	const input = element<HTMLInputElement | HTMLSelectElement>(view.root, `[aria-label="${label}"]`);
	input.value = value; input.dispatchEvent(new Event(input.tagName === 'INPUT' ? 'input' : 'change'));
}
function name(view: ResourcesView, id: string): HTMLButtonElement { return element(row(view, id), '.zenfg-inspector-object-name'); }
function filter(view: InspectorView, label: string): HTMLButtonElement {
	return element(view.root, `[aria-label="Filter resource accesses: ${label}"]`);
}

test('resource size bars keep a capture-wide domain through search, kind filters and sorting; zero and unknown stay distinct', t => {
	const { view } = environment(t); const source = fixture();
	const zero = { ...source.graph.resources[2]!, id: 'resource:zero', label: 'zero', estimatedByteSize: 0 };
	const snapshot = { ...source, graph: { ...source.graph, resources: [...source.graph.resources.map(resource => resource.id === 'resource:scene-color'
		? { ...resource, estimatedByteSize: 1024 } : resource.id === 'resource:unused-data' ? { ...resource, estimatedByteSize: 512 } : resource), zero] } };
	view.setSnapshot(createDebugViewModel(snapshot));
	const size = (id: string) => element(row(view, id), '[data-resource-column="size"]');
	const fill = (id: string) => element(size(id), '.zenfg-inspector-resource-size-bar > span').style.width;
	assert.equal(fill('unused-data'), '50%'); assert.equal(fill('zero'), '0%');
	assert.equal(element(size('zero'), '.zenfg-inspector-resource-size-value').textContent, '0 B');
	assert.equal(size('backbuffer').querySelector('.zenfg-inspector-resource-size-bar'), null);
	assert.equal(size('backbuffer').getAttribute('aria-label'), 'Logical estimate: Unknown');
	assert.match(element(view.root, '.zenfg-inspector-resource-notes p').textContent!, /3\/4 logical estimates known/);
	setFilter(view, 'Resource kind', 'buffer'); assert.equal(fill('unused-data'), '50%');
	setFilter(view, 'Search resource, ID or group', 'unused'); assert.equal(fill('unused-data'), '50%');
	setFilter(view, 'Sort resources', 'size'); assert.equal(fill('unused-data'), '50%');
	view.reveal({ kind: 'resource', id: 'resource:backbuffer' });
	assert.deepEqual([...view.root.querySelectorAll<HTMLElement>('tr[data-selection-key]')].map(el => el.dataset.selectionKey),
		['resource:resource:scene-color', 'resource:resource:unused-data', 'resource:resource:zero', 'resource:resource:backbuffer']);
	assert.equal(element(view.root, 'th[data-resource-column="size"]').getAttribute('aria-sort'), 'descending');
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, resources: source.graph.resources.map(resource => ({ ...resource, estimatedByteSize: 0 })) } }));
	assert.equal(fill('scene-color'), '0%');
});

test('resource identity preserves Unicode name tails and keeps descriptor capacity separate from unknown estimates', t => {
	const { view } = environment(t); const source = fixture();
	const label = `frame.${'history.'.repeat(20)}光照纹理😀.layer.12`;
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, resources: source.graph.resources.map(resource =>
		resource.id === 'resource:scene-color' ? { ...resource, label } : resource) } }));
	assert.equal(name(view, 'scene-color').textContent, label);
	assert.equal(name(view, 'scene-color').getAttribute('aria-label'), label);
	assert.equal(name(view, 'scene-color').title, `${label} · resource:scene-color`);
	assert.equal(element(name(view, 'scene-color'), '.zenfg-inspector-name-suffix').textContent, [...label].slice(-12).join(''));
	assert.equal(row(view, 'scene-color').querySelector('.zenfg-inspector-list-group-path'), null);
	assert.match(element(row(view, 'scene-color'), '.zenfg-inspector-resource-descriptor').textContent!, /rgba16float · 1920×1080$/);
	assert.equal(element(row(view, 'unused-data'), '.zenfg-inspector-resource-descriptor').textContent, 'Capacity 4.0 KiB');
	assert.equal(element(row(view, 'unused-data'), '.zenfg-inspector-resource-size-value').textContent, 'Unknown');
	setFilter(view, 'Search resource, ID or group', 'Main'); assert.equal(view.root.querySelectorAll('tr[data-selection-key]').length, 1);
});

test('lifetime boundaries reveal the correct retained pass IDs independently of recording order', t => {
	const { view, revealed } = environment(t); const source = fixture();
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, nodes: [...source.graph.nodes].reverse().map(node => node.id === 'node:scene' ? { ...node, label: '  ' } : node) } }));
	const boundaries = row(view, 'scene-color').querySelectorAll<HTMLButtonElement>('.zenfg-inspector-resource-lifetime button');
	assert.equal(boundaries.length, 2); assert.match(boundaries[0]!.getAttribute('aria-label')!, /Passes: node:scene$/); boundaries[0]!.click(); boundaries[1]!.click();
	assert.deepEqual(revealed, [[{ kind: 'node', id: 'node:scene' }, 'passes'], [{ kind: 'node', id: 'node:present' }, 'passes']]);
	assert.equal(row(view, 'unused-data').querySelector('.zenfg-inspector-resource-lifetime button'), null);
	assert.match(element(row(view, 'unused-data'), '.zenfg-inspector-resource-lifetime').title, /does not imply.*unused/);
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, resources: source.graph.resources.map(resource =>
		resource.id === 'resource:scene-color' ? { ...resource, lifetime: { firstUse: 1, lastUse: 1 } } : resource) } }));
	const only = element<HTMLButtonElement>(row(view, 'scene-color'), '.zenfg-inspector-resource-lifetime button');
	only.click(); assert.deepEqual(revealed.at(-1), [{ kind: 'node', id: 'node:external' }, 'passes']);
});

test('access entry points count declared records including repeated ranges and Culled passes', t => {
	const { callbacks } = environment(t); const source = fixture();
	const opened: unknown[] = [];
	const view = new ResourcesView(callbacks, 'accesses', (id, mode) => opened.push([id, mode])); document.body.append(view.root);
	const read = source.graph.accesses.find(access => access.id === 'access:present-read')!;
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, accesses: [...source.graph.accesses,
		{ ...read, id: 'access:repeated' }, { ...read, id: 'access:culled-read', nodeId: 'node:unused' }] } }));
	const readButton = element<HTMLButtonElement>(row(view, 'scene-color'), 'button[data-access="read"]');
	assert.match(readButton.getAttribute('aria-label')!, /^Read 3 declared access records/); readButton.click();
	assert.deepEqual(opened, [['resource:scene-color', 'read']]);
	assert.equal(element(row(view, 'scene-color'), '.zenfg-inspector-resource-culled').textContent, '1 culled access');
	assert.equal(element<HTMLButtonElement>(row(view, 'unused-data'), 'button[data-access="read"]').disabled, true);
	assert.equal(element<HTMLButtonElement>(row(view, 'unused-data'), 'button[data-access="write"]').disabled, false);
});

test('refresh restores resource controls by stable ID and recovers missing or disabled targets without stealing external focus', t => {
	const { view } = environment(t); const source = fixture(); view.setSnapshot(createDebugViewModel(source));
	const clear = element<HTMLButtonElement>(view.root, '.zenfg-inspector-view-toolbar > button'); assert.equal(clear.hidden, true);
	name(view, 'scene-color').focus();
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, resources: source.graph.resources.map(resource =>
		resource.id === 'resource:scene-color' ? { ...resource, label: 'renamed' } : resource) } }));
	assert.strictEqual(document.activeElement, name(view, 'scene-color'));
	const read = element<HTMLButtonElement>(row(view, 'scene-color'), 'button[data-access="read"]'); read.focus();
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, accesses: source.graph.accesses.filter(access => access.id !== 'access:present-read') } }));
	assert.strictEqual(document.activeElement, view.root.querySelector('input'));
	name(view, 'unused-data').focus();
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, resources: source.graph.resources.filter(resource => resource.id !== 'resource:unused-data'),
		accesses: source.graph.accesses.filter(access => access.resourceId !== 'resource:unused-data') } }));
	assert.strictEqual(document.activeElement, view.root.querySelector('input'));
	const outside = document.createElement('button'); document.body.append(outside); outside.focus();
	view.setSnapshot(createDebugViewModel(source)); assert.strictEqual(document.activeElement, outside);
	setFilter(view, 'Resource origin', 'surface'); assert.equal(clear.hidden, false); clear.focus(); clear.click();
	assert.equal(clear.hidden, true); assert.strictEqual(document.activeElement, view.root.querySelector('input'));
});

test('resource Summary exposes descriptor and logical estimate before folded details and keeps allocation states', t => {
	const { callbacks } = environment(t); const view = new InspectorView(callbacks, () => {}, 'details'); document.body.append(view.root);
	view.setSnapshot(createDebugViewModel(fixture())); view.setSelection({ kind: 'resource', id: 'resource:scene-color' });
	const descriptor = [...view.root.querySelectorAll('dt')].find(term => term.textContent === 'Descriptor')!;
	assert.equal(descriptor.closest('details'), null); assert.match(descriptor.nextElementSibling!.textContent!, /rgba16float.*1920×1080/);
	assert.match(element(view.root, '.zenfg-inspector-detail-metrics').textContent!, /Logical estimate.*7\.9/);
	view.setSelection({ kind: 'resource', id: 'resource:unused-data' });
	assert.match(element(view.root, '.zenfg-inspector-detail-metrics').textContent!, /Logical estimateUnknown/);
	assert.match(view.root.textContent!, /4\.0 KiB buffer/); assert.match(view.root.textContent!, /AllocationUnallocated/);
	view.setSelection({ kind: 'resource', id: 'resource:backbuffer' });
	assert.match(view.root.textContent!, /Not applicable · externally owned resource/);
});

test('resource access relations group by pass in execution Order, retain range records, and separate inspection from location', t => {
	const { callbacks, selected, revealed } = environment(t); const source = fixture();
	const read = source.graph.accesses.find(access => access.id === 'access:present-read')!;
	const snapshot = { ...source, graph: { ...source.graph, nodes: [...source.graph.nodes].reverse(), accesses: [...source.graph.accesses,
		{ ...read, id: 'access:repeat' }, { ...read, id: 'access:same-pass', nodeId: 'node:scene' },
		{ ...read, id: 'access:culled', nodeId: 'node:unused' }].reverse() } };
	const view = new InspectorView(callbacks, () => {}, 'relations'); document.body.append(view.root);
	view.setSnapshot(createDebugViewModel(snapshot)); view.setSelection({ kind: 'resource', id: 'resource:scene-color' }); view.showResourceAccesses('all');
	const entries = () => [...view.root.querySelectorAll<HTMLElement>('[data-access-node-id]')];
	assert.deepEqual(entries().map(entry => entry.dataset.accessNodeId), ['node:scene', 'node:present', 'node:unused']);
	assert.equal(entries()[0]!.querySelectorAll('li').length, 2); assert.equal(entries()[1]!.querySelectorAll('li').length, 2);
	assert.match(entries()[1]!.textContent!, /mip 0–0.*layers 0–0/);
	assert.match(entries()[2]!.textContent!, /Culled · not executed · not-reachable-from-root/);
	assert.match(element(view.root, '.zenfg-inspector-resource-pass-accesses p').textContent!, /5 declared access records · 3 passes · 1 culled access/);
	element<HTMLButtonElement>(entries()[0]!, '.zenfg-inspector-object-name').click();
	assert.deepEqual(selected, [{ kind: 'node', id: 'node:scene' }]); assert.deepEqual(revealed, []);
	element<HTMLButtonElement>(entries()[2]!, '.zenfg-inspector-icon-action').click();
	assert.deepEqual(revealed, [[{ kind: 'culled', id: 'node:unused' }, 'passes']]);
	filter(view, 'Read').focus(); filter(view, 'Read').click();
	assert.strictEqual(document.activeElement, filter(view, 'Read')); assert.equal(filter(view, 'Read').getAttribute('aria-pressed'), 'true');
	view.setSnapshot(createDebugViewModel(snapshot)); assert.strictEqual(document.activeElement, filter(view, 'Read'));
	assert.equal(view.root.querySelectorAll('.zenfg-inspector-resource-access-records li').length, 4);
	filter(view, 'Write').click(); assert.deepEqual(entries().map(entry => entry.dataset.accessNodeId), ['node:scene']);
	view.setSelection({ kind: 'resource', id: 'resource:unused-data' }); view.showResourceAccesses('all');
	assert.equal(filter(view, 'All').getAttribute('aria-pressed'), 'true'); assert.match(entries()[0]!.textContent!, /bytes 0–4096/);
});


test('culled relation names preserve the identifying tail independently of compile-state labels', t => {
	const { callbacks, selected, revealed } = environment(t); const source = fixture();
	const label = 'mesh.' + 'shadow.namespace.'.repeat(16) + 'directional-shadow.depth.12';
	const view = new InspectorView(callbacks, () => {}, 'culled-name'); document.body.append(view.root);
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph, nodes: source.graph.nodes.map(node => node.id === 'node:unused' ? { ...node, label } : node) } }));
	view.setSelection({ kind: 'resource', id: 'resource:unused-data' }); view.showResourceAccesses('write');
	const entry = element(view.root, '[data-access-node-id="node:unused"]');
	const link = element<HTMLButtonElement>(entry, '.zenfg-inspector-object-name');
	assert.equal(link.textContent, label);
	assert.equal(element(link, '.zenfg-inspector-name-suffix').textContent, [...label].slice(-12).join(''));
	assert.equal(link.getAttribute('aria-label'), label + ' (culled)');
	assert.match(element(entry, '.zenfg-inspector-resource-pass-state').textContent!, /Culled · not executed/);
	link.click(); assert.deepEqual(selected, [{ kind: 'culled', id: 'node:unused' }]);
	element<HTMLButtonElement>(entry, '.zenfg-inspector-icon-action').click();
	assert.deepEqual(revealed, [[{ kind: 'culled', id: 'node:unused' }, 'passes']]);
});
