import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';

import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { OverviewView } from '../src/panelOverviewView.ts';
import type { Selection, WorkbenchTab } from '../src/panelTypes.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function fixture(name = 'full-webgpu'): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve(`packages/snapshot/fixtures/${name}.fgsnapshot.json`), 'utf8'));
}

function installDom(): Window {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'Event', window.Event);
	return window;
}

function callbacks() {
	const selections: Selection[] = [];
	const reveals: Array<readonly [Selection, WorkbenchTab]> = [];
	const navigation: Array<readonly [WorkbenchTab, 'all' | 'culled' | undefined]> = [];
	const handlers: WorkbenchCallbacks = {
		onSelect: (selection) => selections.push(selection), onHover: () => {},
		onReveal: (selection, tab) => reveals.push([selection, tab]),
		onNavigate: (tab, filter) => navigation.push([tab, filter]),
		onGroupToggle: () => {}, isGroupExpanded: () => false,
	};
	return { handlers, selections, reveals, navigation };
}

function element<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
	const found = root.querySelector<T>(selector);
	assert.ok(found, `Missing ${selector}`);
	return found;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === label);
	assert.ok(found, `Missing button ${label}`);
	return found;
}

function kpi(view: OverviewView, metric: 'gpu' | 'cpu' | 'memory' | 'passes'): HTMLElement {
	return element(view.root, `.zenfg-inspector-overview-kpi[data-metric="${metric}"]`);
}

function value(view: OverviewView, metric: 'gpu' | 'cpu' | 'memory' | 'passes'): string {
	return element(kpi(view, metric), '.zenfg-inspector-overview-value').textContent ?? '';
}

function timingRows(view: OverviewView): HTMLTableRowElement[] {
	return [...view.root.querySelectorAll<HTMLTableRowElement>('.zenfg-inspector-overview-timing-rows tr[data-node-id]')];
}

function timedCapture(durations: readonly number[]): FrameGraphSnapshot {
	const source = fixture('minimal');
	const nodes: FrameGraphSnapshot['graph']['nodes'] = durations.map((_, index) => ({
		id: `node:${index}`, kind: index % 2 === 0 ? 'render' : 'compute', label: `Pass ${index}`,
		recordingOrder: index, sideEffect: true, compileState: { status: 'retained', executionOrder: index },
	}));
	return { ...source, graph: { ...source.graph, nodes: [...nodes].reverse(),
		segments: [{ id: 'segment:all', kind: 'frame-graph', order: 0, nodeIds: nodes.map((node) => node.id) }],
	}, timings: { ...source.timings, gpu: { status: 'available', frameSpanMicros: 100_000,
		nodes: durations.map((durationMicros, index) => ({ nodeId: `node:${index}`, durationMicros })),
	} } };
}

test('Overview prioritizes actual GPU span, CPU collection, physical bytes and retained passes', (t) => {
	const window = installDom(); t.after(() => window.close());
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(fixture()));
	assert.equal(element(view.root, '.zenfg-inspector-overview-kpis').children.length, 4);
	assert.match(value(view, 'gpu'), /1\.851/);
	assert.match(kpi(view, 'cpu').textContent!, /Not collected/);
	assert.match(value(view, 'memory'), /7\.9/);
	assert.match(value(view, 'passes'), /3/);
	assert.match(kpi(view, 'passes').textContent!, /1.*culled/i);
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true');
	assert.deepEqual(timingRows(view).map((row) => row.dataset.nodeId), ['node:scene', 'node:present']);
	assert.match(timingRows(view)[0]!.textContent!, /1\.410.*88\.6%/);
	assert.match(timingRows(view)[1]!.textContent!, /0\.181.*11\.4%/);
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /2\/2/);
	assert.match(element(view.root, '.zenfg-inspector-overview-external').textContent!, /1 external submission.*outside per-pass GPU timing/);
	assert.doesNotMatch(view.root.textContent!, /\bFPS\b|draw calls|GPU utilization/i);
});

test('Overview top five shares use every measured pass and ties follow execution order', (t) => {
	const window = installDom(); t.after(() => window.close());
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(timedCapture([7000, 6000, 6000, 4000, 3000, 2000, 0])));
	const rows = timingRows(view);
	assert.equal(rows.length, 5);
	assert.deepEqual(rows.map((row) => row.dataset.nodeId), ['node:0', 'node:1', 'node:2', 'node:3', 'node:4']);
	assert.match(rows[0]!.textContent!, /7\.000.*25\.0%/);
	assert.match(rows[1]!.textContent!, /6\.000.*21\.4%/);
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /7\/7/);
});

test('CPU-only capture defaults to CPU and explicit timing choice survives refreshed availability', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture();
	const cpu: FrameGraphSnapshot['timings']['cpu'] = { status: 'available', executionDurationMicros: 5000,
		nodes: [{ nodeId: 'node:scene', durationMicros: 1000 }, { nodeId: 'node:external', durationMicros: 3000 }, { nodeId: 'node:present', durationMicros: 0 }],
	};
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel({ ...source, timings: { cpu, gpu: { status: 'unavailable', reason: 'unsupported' } } }));
	assert.equal(button(view.root, 'CPU').getAttribute('aria-pressed'), 'true');
	assert.match(value(view, 'cpu'), /5\.000/);
	assert.deepEqual(timingRows(view).map((row) => row.dataset.nodeId), ['node:external', 'node:scene', 'node:present']);
	assert.match(timingRows(view)[0]!.textContent!, /75\.0%/);
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /3\/3/);
	view.setSnapshot(createDebugViewModel({ ...source, timings: { cpu, gpu: source.timings.gpu } }));
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true');
	button(view.root, 'CPU').click();
	view.setSnapshot(createDebugViewModel({ ...source, timings: { cpu, gpu: source.timings.gpu } }));
	assert.equal(button(view.root, 'CPU').getAttribute('aria-pressed'), 'true');
	button(view.root, 'GPU').click();
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true');
	view.setSnapshot(createDebugViewModel({ ...source, timings: { cpu, gpu: { status: 'unavailable', reason: 'busy' } } }));
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true');
	assert.equal(timingRows(view).length, 0);
});

test('partial timing retains measured zero without assigning zero-sum percentages', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture();
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel({ ...source, timings: { ...source.timings,
		gpu: { status: 'available', frameSpanMicros: 0, nodes: [{ nodeId: 'node:scene', durationMicros: 0 }] },
	} }));
	assert.match(value(view, 'gpu'), /0\.000/);
	assert.deepEqual(timingRows(view).map((row) => row.dataset.nodeId), ['node:scene']);
	assert.match(timingRows(view)[0]!.textContent!, /0\.000/);
	assert.match(timingRows(view)[0]!.textContent!, /—/);
	assert.doesNotMatch(timingRows(view)[0]!.textContent!, /%|NaN|Infinity/);
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /Partial.*1\/2/i);
});

test('timing reasons and no eligible GPU work remain distinct from real zero allocations', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture('timing-unavailable');
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(source));
	assert.match(kpi(view, 'gpu').textContent!, /Unavailable/);
	assert.match(kpi(view, 'cpu').textContent!, /Not collected/);
	assert.match(value(view, 'memory'), /^0(?:\s|$)/);
	assert.match(element(view.root, '.zenfg-inspector-snapshot-details').textContent!, /timestamp-query-unsupported/);
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph,
		nodes: source.graph.nodes.map((node) => ({ ...node, kind: 'command' })),
	} }));
	assert.match(kpi(view, 'gpu').textContent!, /Not applicable/);
	assert.equal(timingRows(view).length, 0);
	assert.doesNotMatch(view.root.textContent!, /NaN|Infinity/);
});

test('physical memory estimates honor missing sizes and unavailable reports without descriptor fallbacks', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture();
	assert.equal(source.memory.allocationReport.status, 'available');
	if (source.memory.allocationReport.status !== 'available') return;
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel({ ...source, memory: { ...source.memory,
		allocationReport: { status: 'available', allocations: source.memory.allocationReport.allocations.map(({ estimatedByteSize: _size, ...allocation }) => allocation) },
	} }));
	assert.match(value(view, 'memory'), /Unknown/);
	assert.match(kpi(view, 'memory').textContent!, /0\/1/);
	view.setSnapshot(createDebugViewModel({ ...source, memory: { ...source.memory,
		allocationReport: { status: 'unavailable', reason: 'not-requested' },
	} }));
	assert.match(value(view, 'memory'), /Unavailable/);
	view.setSnapshot(createDebugViewModel(source));
	assert.match(value(view, 'memory'), /7\.9/);
	assert.doesNotMatch(value(view, 'memory'), /Unknown/);
});

test('alias capacity and cumulative pool reuse are distinct from physical allocation totals', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture('aliasing');
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(source));
	assert.match(value(view, 'memory'), /1\.0/);
	assert.match(view.root.textContent!, /alias.*1\.0 KiB/i);
	assert.match(view.root.textContent!, /cumulative|lifetime/i);
	assert.match(view.root.textContent!, /50(?:\.0)?%/);
	view.setSnapshot(createDebugViewModel({ ...source, memory: { ...source.memory,
		poolReport: { status: 'available', acquireCount: 0, reuseCount: 0, createdCount: 0, retainedCount: 0, estimatedRetainedBytes: 0 },
	} }));
	assert.match(element(view.root, '.zenfg-inspector-overview-pool').textContent!, /Not applicable.*no acquisitions/i);
	assert.doesNotMatch(view.root.textContent!, /NaN|Infinity/);
});

test('hotspot labels retain full long names, ID fallback and explicit pass reveal', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = timedCapture([2000, 1000]);
	const longLabel = `Long pass ${'名称/'.repeat(70)}`;
	const log = callbacks();
	const view = new OverviewView(log.handlers);
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph,
		nodes: source.graph.nodes.map((node) => node.id === 'node:0' ? { ...node, label: longLabel } : { ...node, label: undefined }),
	} }));
	const longButton = button(view.root, longLabel);
	assert.ok(longButton.title.includes(longLabel) || longButton.closest('[title]')?.getAttribute('title')?.includes(longLabel));
	longButton.click(); button(view.root, 'node:1').click();
	assert.deepEqual(log.reveals, [[{ kind: 'node', id: 'node:0' }, 'passes'], [{ kind: 'node', id: 'node:1' }, 'passes']]);
	assert.deepEqual(log.selections, []);
	button(view.root, 'View all passes').click();
	button(view.root, 'View memory').click();
	button(view.root, 'View resources').click();
	button(view.root, 'View diagnostics').click();
	view.setSnapshot(createDebugViewModel(fixture()));
	button(view.root, '1 Culled').click();
	assert.deepEqual(log.navigation, [['passes', 'all'], ['memory', undefined], ['resources', undefined], ['diagnostics', undefined], ['passes', 'culled']]);
});

test('capture and snapshot details preserve open state while refreshing frame and diagnostics', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture();
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(source));
	const capture = element<HTMLDetailsElement>(view.root, '.zenfg-inspector-capture-details');
	const snapshot = element<HTMLDetailsElement>(view.root, '.zenfg-inspector-snapshot-details');
	assert.equal(capture.open, false); assert.equal(snapshot.open, false);
	capture.open = true; snapshot.open = true;
	view.setSnapshot(createDebugViewModel({ ...source, capture: { ...source.capture, frameIndex: 43 }, diagnostics: [] }));
	assert.equal(element<HTMLDetailsElement>(view.root, '.zenfg-inspector-capture-details').open, true);
	assert.equal(element<HTMLDetailsElement>(view.root, '.zenfg-inspector-snapshot-details').open, true);
	assert.match(capture.textContent!, /Frame43/);
	assert.match(view.root.textContent!, /No recorded diagnostics/);
	view.setSnapshot(createDebugViewModel({ ...source, diagnostics: [
		{ severity: 'info', code: 'notice', message: 'Capture notice' },
		{ severity: 'warning', code: 'warning', message: 'Capture warning' },
		{ severity: 'error', code: 'error', message: 'Capture error' },
	] }));
	assert.doesNotMatch(view.root.textContent!, /No recorded diagnostics/);
	assert.match(element(view.root, '.zenfg-inspector-overview-diagnostics').textContent!, /1 error.*1 warning.*1 info/);
});
