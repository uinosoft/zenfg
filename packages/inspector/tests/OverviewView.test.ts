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

function fact(root: HTMLElement, label: string): HTMLElement {
	const term = [...root.querySelectorAll('dt')].find(candidate => candidate.textContent === label);
	assert.ok(term, `Missing fact ${label}`);
	return element(term.parentElement!, 'dd');
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
	assert.equal(value(view, 'cpu'), 'Not collected');
	assert.equal(element(kpi(view, 'cpu'), '.zenfg-inspector-overview-value').dataset.state, 'unknown');
	assert.match(value(view, 'memory'), /7\.9/);
	for (const metric of ['gpu', 'cpu', 'memory'] as const) {
		assert.equal(kpi(view, metric).querySelector('.zenfg-inspector-overview-note'), null, `${metric} does not repeat a complete measurement or unavailable state`);
	}
	assert.match(value(view, 'passes'), /3/);
	assert.match(kpi(view, 'passes').textContent!, /1.*culled/i);
	assert.equal(button(view.root, 'GPU').getAttribute('aria-pressed'), 'true');
	assert.deepEqual(timingRows(view).map((row) => row.dataset.nodeId), ['node:scene', 'node:present']);
	assert.match(timingRows(view)[0]!.textContent!, /1\.410.*88\.6%/);
	assert.match(timingRows(view)[1]!.textContent!, /0\.181.*11\.4%/);
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /2\/2/);
	assert.match(element(view.root, '.zenfg-inspector-overview-external').textContent!, /1 external submission.*outside per-pass GPU timing/);
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-timing-summary'), null);
	assert.match(element(view.root, '.zenfg-inspector-overview-scope-note').textContent!, /Share of measured pass sum/);
	assert.doesNotMatch(view.root.textContent!, /\bFPS\b|draw calls|GPU utilization/i);
});

test('pass counts stay in the frame summary and structural facts stay in snapshot details', (t) => {
	const window = installDom(); t.after(() => window.close());
	const log = callbacks();
	const view = new OverviewView(log.handlers);
	view.setSnapshot(createDebugViewModel(fixture()));
	assert.match(kpi(view, 'passes').textContent!, /2 render.*1 external/i);
	button(kpi(view, 'passes'), '1 Culled').click();
	assert.deepEqual(log.navigation, [['passes', 'culled']]);
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-work'), null);
	assert.doesNotMatch(view.root.textContent!, /Work composition/);
	const details = element<HTMLDetailsElement>(view.root, '.zenfg-inspector-snapshot-details');
	assert.equal(details.open, false);
	assert.match(details.textContent!, /Frame-graph segments\s*2/);
	assert.match(details.textContent!, /External boundaries\s*1/);
	assert.match(details.textContent!, /Groups\s*2/);
	assert.doesNotMatch(element(view.root, '.zenfg-inspector-overview-summary').textContent!, /Frame-graph segments|External boundaries/);
	view.setSnapshot(createDebugViewModel(timedCapture([440, 321])));
	assert.equal(kpi(view, 'passes').querySelector('button'), null);
	assert.doesNotMatch(kpi(view, 'passes').textContent!, /culled/i);
	assert.match(details.textContent!, /Frame-graph segments\s*1/);
	assert.match(details.textContent!, /External boundaries\s*0/);
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
	// The main chart compares milliseconds on a common axis, while the labels
	// retain shares of every measured pass, including the undisplayed tail.
	const table = element(view.root, '.zenfg-inspector-overview-timings');
	assert.equal(Number(table.dataset.maxMicros), 10_000);
	assert.equal(element(rows[0]!, '.zenfg-inspector-overview-bar > span').style.width, '70%');
	assert.equal(element(rows[1]!, '.zenfg-inspector-overview-bar > span').style.width, '60%');
	const axis = element(view.root, '.zenfg-inspector-overview-axis');
	assert.match(axis.textContent!, /10(?:\.0+)?\s*ms/);
	const top = element(view.root, '.zenfg-inspector-overview-timing-totals [data-part="top"]');
	const other = element(view.root, '.zenfg-inspector-overview-timing-totals [data-part="other"]');
	assert.match(top.textContent!, /5/);
	assert.match(top.textContent!, /26\.000\s*ms.*92\.9%/);
	assert.match(other.textContent!, /2/);
	assert.match(other.textContent!, /2\.000\s*ms.*7\.1%/);
	assert.ok(view.root.querySelector('.zenfg-inspector-overview-timing-composition'));
});

test('timing summary excludes unmeasured passes from the tail and hides an absent tail', (t) => {
	const window = installDom(); t.after(() => window.close());
	const view = new OverviewView(callbacks().handlers);
	const source = timedCapture([440, 321, 313, 293, 269, 200, 0, 111]);
	assert.equal(source.timings.gpu.status, 'available');
	if (source.timings.gpu.status !== 'available') return;
	view.setSnapshot(createDebugViewModel({ ...source, timings: { ...source.timings,
		gpu: { ...source.timings.gpu, nodes: source.timings.gpu.nodes.slice(0, 7) },
	} }));
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /Partial.*7\/8/);
	assert.equal(element(kpi(view, 'gpu'), '.zenfg-inspector-overview-note').textContent, 'Pass timing partial');
	assert.doesNotMatch(kpi(view, 'gpu').textContent!, /7\/8/);
	assert.equal(Number(element(view.root, '.zenfg-inspector-overview-timings').dataset.maxMicros), 500);
	assert.equal(element(timingRows(view)[0]!, '.zenfg-inspector-overview-bar > span').style.width, '88%');
	assert.match(timingRows(view)[0]!.textContent!, /0\.440.*24\.0%/);
	const other = element(view.root, '.zenfg-inspector-overview-timing-totals [data-part="other"]');
	assert.match(other.textContent!, /2/);
	assert.match(other.textContent!, /0\.200\s*ms.*10\.9%/);
	view.setSnapshot(createDebugViewModel(timedCapture([440, 321])));
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-timing-summary'), null);
	assert.match(element(view.root, '.zenfg-inspector-overview-scope-note').textContent!, /Share of measured pass sum/);
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
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /4\.000\s*ms/);
	assert.equal(Number(element(view.root, '.zenfg-inspector-overview-timings').dataset.maxMicros), 5000);
	assert.equal(element(timingRows(view)[0]!, '.zenfg-inspector-overview-bar > span').style.width, '60%');
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
	assert.equal(element(timingRows(view)[0]!, '.zenfg-inspector-overview-bar > span').style.width, '0%');
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-timing-composition'), null);
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-timing-summary'), null);
	view.setSnapshot(createDebugViewModel(timedCapture([0, 0, 0, 0, 0, 0])));
	assert.match(element(view.root, '.zenfg-inspector-overview-timing-summary').textContent!, /Top 5.*0\.000 ms.*—.*Other 1.*0\.000 ms.*—/);
	assert.doesNotMatch(element(view.root, '.zenfg-inspector-overview-timing-summary').textContent!, /%|NaN|Infinity/);
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-timing-composition'), null);
});

test('partial CPU timing keeps execution total and measured coverage in separate roles', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture();
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel({ ...source, timings: {
		gpu: { status: 'unavailable', reason: 'unsupported' },
		cpu: { status: 'available', executionDurationMicros: 5000, nodes: [{ nodeId: 'node:scene', durationMicros: 1000 }] },
	} }));
	assert.match(value(view, 'cpu'), /5\.000/);
	assert.equal(element(kpi(view, 'cpu'), '.zenfg-inspector-overview-note').textContent, 'Pass timing partial');
	assert.doesNotMatch(kpi(view, 'cpu').textContent!, /1\/3/);
	assert.match(element(view.root, '.zenfg-inspector-overview-coverage').textContent!, /1\.000 ms.*Partial.*1\/3/);
});

test('timing reasons and no eligible GPU work remain distinct from real zero allocations', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture('timing-unavailable');
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(source));
	assert.match(kpi(view, 'gpu').textContent!, /Unavailable/);
	assert.match(kpi(view, 'cpu').textContent!, /Not collected/);
	assert.equal(value(view, 'gpu'), 'Unavailable');
	assert.equal(value(view, 'cpu'), 'Not collected');
	assert.match(value(view, 'memory'), /^0(?:\s|$)/);
	assert.match(element(view.root, '.zenfg-inspector-snapshot-details').textContent!, /timestamp-query-unsupported/);
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-axis'), null);
	assert.equal(view.root.querySelector('.zenfg-inspector-overview-timing-summary'), null);
	view.setSnapshot(createDebugViewModel({ ...source, graph: { ...source.graph,
		nodes: source.graph.nodes.map((node) => ({ ...node, kind: 'command' })),
	} }));
	assert.match(kpi(view, 'gpu').textContent!, /Not applicable/);
	assert.equal(value(view, 'gpu'), 'Not applicable');
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
	assert.equal(element(kpi(view, 'memory'), '.zenfg-inspector-overview-value').dataset.state, 'unknown');
	view.setSnapshot(createDebugViewModel({ ...source, memory: { ...source.memory,
		allocationReport: { status: 'unavailable', reason: 'not-requested' },
	} }));
	assert.match(value(view, 'memory'), /Unavailable/);
	assert.equal(kpi(view, 'memory').querySelector('.zenfg-inspector-overview-note'), null);
	view.setSnapshot(createDebugViewModel(source));
	assert.match(value(view, 'memory'), /7\.9/);
	assert.doesNotMatch(value(view, 'memory'), /Unknown/);
	assert.equal(kpi(view, 'memory').querySelector('.zenfg-inspector-overview-note'), null);
});

test('resource summaries merge related facts and unavailable reports retain one group state', (t) => {
	const window = installDom(); t.after(() => window.close());
	const source = fixture();
	const view = new OverviewView(callbacks().handlers);
	view.setSnapshot(createDebugViewModel(source));
	let resources = element(view.root, '.zenfg-inspector-overview-resources');
	assert.match(fact(resources, 'Logical resources').textContent!, /2 textures\s*·\s*1 buffers?/);
	assert.ok(![...resources.querySelectorAll('dt')].some(term => term.textContent === 'Textures / buffers'));
	assert.equal(fact(resources, 'Physical allocations').textContent, '1');
	assert.match(fact(resources, 'Idle retained estimate').textContent!, /7\.9 MiB/);
	assert.match(fact(resources, 'Idle retained estimate').textContent!, /1 allocation/);
	assert.equal(fact(resources, 'Cumulative reuse').textContent, '66.7%');
	assert.equal(element(resources, '.zenfg-inspector-overview-pool h3').textContent, 'Resource pool');
	assert.ok(![...resources.querySelectorAll('dt')].some(term => term.textContent === 'Idle allocations'));
	view.setSnapshot(createDebugViewModel({ ...source, memory: {
		allocationReport: { status: 'unavailable', reason: 'not-requested' },
		poolReport: { status: 'unavailable', reason: 'not-requested' },
	} }));
	resources = element(view.root, '.zenfg-inspector-overview-resources');
	assert.equal(resources.querySelectorAll('.zenfg-inspector-overview-report-state').length, 2);
	assert.equal(resources.querySelectorAll('.zenfg-inspector-overview-pool .zenfg-inspector-overview-report-state').length, 1);
	assert.equal(resources.querySelectorAll('.zenfg-inspector-overview-pool dl').length, 0);
	assert.ok(![...resources.querySelectorAll('dt')].some(term => term.textContent === 'Physical allocations' || term.textContent === 'Alias savings estimate'));
	assert.ok(fact(resources, 'Logical resources'));
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
	assert.match(fact(element(view.root, '.zenfg-inspector-overview-pool'), 'Idle retained estimate').textContent!, /0 B/);
	assert.match(fact(element(view.root, '.zenfg-inspector-overview-pool'), 'Idle retained estimate').textContent!, /0 allocations/);
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
