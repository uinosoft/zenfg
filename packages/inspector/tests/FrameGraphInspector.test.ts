import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { Window } from 'happy-dom';

import { FrameGraphInspector, mountFrameGraphInspector } from '../src/FrameGraphInspector.ts';
import { BufferAccess, TextureAccess } from './accessKinds.ts';
import { createLegacyDebugViewModel, toSnapshot, type LegacyFrameGraphCapture } from './legacySnapshotFixture.ts';

test('keeps the shared header action-free and exposes capture commands outside the tablist', () => {
	const testWindow = installDom();
	const panel = mountFrameGraphInspector(document.body);

	assert.equal(panel.dom.querySelector('.zenfg-inspector-shell-header .zenfg-inspector-shell-action'), null);
	const header = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-shell-header');
	const commandBar = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-command-bar');
	const tabs = commandBar?.querySelector<HTMLElement>('[role="tablist"]');
	const actions = commandBar?.querySelector<HTMLElement>('[role="toolbar"]');
	assert.ok(header && commandBar && tabs && actions);
	assert.equal(actions.getAttribute('aria-label'), 'FrameGraph commands');
	assert.equal(tabs.contains(actions), false);
	assert.equal(tabs.contains(panel.dom.querySelector('.zenfg-inspector-open-inspector')), false);
	assert.equal(actions.contains(panel.dom.querySelector('.zenfg-inspector-open-inspector')), true);
	assert.equal(captureAction(panel.dom).disabled, true);
	assert.equal(copyAction(panel.dom).disabled, true);
	assert.equal(tabButton(tabs, 'Graph').disabled, true);

	header.click();
	assert.equal(panel.expanded, true);
	header.click();
	assert.equal(panel.expanded, false);

	panel.setSnapshot(toSnapshot(createEmptyCapture()));
	assert.equal(copyAction(panel.dom).disabled, false);
	assert.equal(tabButton(tabs, 'Graph').disabled, false);

	panel.destroy();
	assert.equal(panel.dom.isConnected, false);
	testWindow.close();
});

test('injects scoped visual tokens and keeps icon buttons accessibly named', () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	const style = document.getElementById('zenfg-inspector-panel-styles');
	assert.ok(style);
	const css = style.textContent ?? '';
	assert.match(css, /--fgd-canvas: #0b0f14/);
	assert.match(css, /--fgd-accent: var\(--zenfg-inspector-accent, #38bdf8\)/);
	assert.match(css, /border: 1px solid var\(--zenfg-inspector-border/);
	assert.equal(css.includes('#zenfg-inspector > .zenfg-inspector-shell-header'), false);
	assert.equal(css.includes('.zenfg-inspector-stats'), false);
	assert.equal(css.includes('.zenfg-inspector-timeline'), false);

	const capture = captureAction(panel.dom);
	const copy = copyAction(panel.dom);
	const inspector = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-open-inspector');
	const close = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-inspector-close');
	assert.ok(inspector && close);
	for (const button of [capture, copy, inspector, close]) {
		const icon = button.querySelector<SVGElement>('.zenfg-inspector-control-icon');
		assert.ok(icon);
		assert.equal(icon.getAttribute('aria-hidden'), 'true');
	}
	assert.equal(capture.textContent, 'Capture');
	assert.equal(copy.textContent, 'Copy JSON');
	assert.equal(close.getAttribute('aria-label'), 'Close inspector');
	panel.destroy();
	testWindow.close();
});

test('automatically captures only once per initialized source and allows manual retry', async () => {
	const testWindow = installDom();
	let calls = 0;
	const panel = new FrameGraphInspector({
		captureSnapshot: async () => {
			calls += 1;
			return undefined;
		},
	});

	panel.setExpanded(true);
	await flushAsync();
	assert.equal(calls, 1);
	assert.match(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent ?? '', /No snapshot was produced/);
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'error');
	assert.equal(captureAction(panel.dom).disabled, false);

	panel.setExpanded(false);
	panel.setExpanded(true);
	await flushAsync();
	assert.equal(calls, 1);

	captureAction(panel.dom).click();
	await flushAsync();
	assert.equal(calls, 2);

	panel.destroy();
	testWindow.close();
});

test('starts the one-shot capture when a source is injected after expansion', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	panel.setExpanded(true);
	assert.match(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent ?? '', /Waiting for a FrameGraph capture source/);
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'waiting');
	assert.equal(captureAction(panel.dom).disabled, true);

	let calls = 0;
	let resolveCapture!: (snapshot: ReturnType<typeof toSnapshot> | undefined) => void;
	panel.setCaptureSnapshotProvider(() => {
		calls += 1;
		return new Promise((resolve) => {
			resolveCapture = resolve;
		});
	});
	assert.equal(calls, 1);
	assert.equal(captureAction(panel.dom).textContent, 'Capturing…');
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'capturing');
	assert.equal(captureAction(panel.dom).querySelector('svg')?.dataset.icon, 'spinner');
	assert.equal(captureAction(panel.dom).disabled, true);

	resolveCapture(toSnapshot(createGroupedCapture()));
	await flushAsync();
	assert.equal(captureAction(panel.dom).textContent, 'Capture');
	assert.equal(captureAction(panel.dom).disabled, false);
	assert.equal(copyAction(panel.dom).disabled, false);
	assert.equal(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.hasAttribute('hidden'), false);

	panel.destroy();
	testWindow.close();
});

test('keeps the current snapshot and view state when a manual recapture fails', async () => {
	const testWindow = installDom();
	let rejectCapture!: (reason: Error) => void;
	const panel = new FrameGraphInspector({
		captureSnapshot: () => new Promise((_resolve, reject) => {
			rejectCapture = reject;
		}),
	});
	panel.setSnapshot(toSnapshot(createLongCapture(80)));
	panel.setExpanded(true);

	const tabs = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-tabs');
	assert.ok(tabs);
	tabButton(tabs, 'Passes').click();
	const scroller = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-passes-view .zenfg-inspector-table-scroller');
	assert.ok(scroller);
	scroller.scrollTop = 240;
	const lastPass = Array.from(panel.dom.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-passes-view .zenfg-inspector-relation-button'))
		.find((button) => button.textContent === 'pass-80');
	assert.ok(lastPass);
	lastPass.click();

	captureAction(panel.dom).click();
	assert.equal(captureAction(panel.dom).textContent, 'Capturing…');
	assert.equal(captureAction(panel.dom).disabled, true);
	assert.equal(copyAction(panel.dom).disabled, false);
	assert.match(panel.dom.querySelector('.zenfg-inspector-passes-view')?.textContent ?? '', /pass-80/);

	rejectCapture(new Error('capture failed'));
	await flushAsync();
	assert.equal(panel.dom.querySelector('.zenfg-inspector-passes-view .zenfg-inspector-table-scroller'), scroller);
	assert.equal(scroller.scrollTop, 240);
	assert.equal(tabButton(tabs, 'Passes').getAttribute('aria-selected'), 'true');
	assert.equal(panel.dom.querySelector('.zenfg-inspector-inspector > header strong')?.textContent, 'pass-80');
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /capture failed/);
	assert.equal(copyAction(panel.dom).disabled, false);

	panel.setCaptureSnapshotProvider(async () => undefined);
	captureAction(panel.dom).click();
	await flushAsync();
	assert.match(panel.dom.querySelector('.zenfg-inspector-passes-view')?.textContent ?? '', /pass-80/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /No snapshot was produced/);

	panel.setCaptureSnapshotProvider(async () => toSnapshot(createGroupedCapture()));
	captureAction(panel.dom).click();
	await flushAsync();
	assert.equal(tabButton(tabs, 'Passes').getAttribute('aria-selected'), 'true');
	assert.doesNotMatch(panel.dom.querySelector('.zenfg-inspector-passes-view')?.textContent ?? '', /pass-80/);
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-command-status')?.hidden, true);

	panel.destroy();
	testWindow.close();
});

test('copies the current capture JSON with pending and copied feedback', async () => {
	const testWindow = installDom();
	let copiedText = '';
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				copiedText = text;
			},
		},
	});
	const capture = createGroupedCapture();
	const panel = new FrameGraphInspector();
	panel.setSnapshot(toSnapshot(capture));

	copyAction(panel.dom).click();
	assert.equal(copyAction(panel.dom).textContent, 'Copying…');
	assert.equal(copyAction(panel.dom).disabled, true);
	await flushAsync();
	assert.equal(copyAction(panel.dom).textContent, 'Copied');
	assert.deepEqual(JSON.parse(copiedText), toSnapshot(capture));

	panel.setSnapshot(toSnapshot(createEmptyCapture()));
	assert.equal(copyAction(panel.dom).textContent, 'Copy JSON');

	panel.destroy();
	testWindow.close();
});

test('downloads canonical V1 with the frame-index Snapshot filename', async () => {
	const testWindow = installDom();
	let downloadedName = '';
	let downloadedBlob: Blob | undefined;
	const url = globalThis.URL as typeof URL;
	const previousCreate = url.createObjectURL;
	const previousRevoke = url.revokeObjectURL;
	const anchorPrototype = testWindow.HTMLAnchorElement.prototype;
	const previousClick = anchorPrototype.click;
	Object.defineProperty(url, 'createObjectURL', {
		configurable: true,
		value: (blob: Blob) => {
			downloadedBlob = blob;
			return 'blob:test';
		},
	});
	Object.defineProperty(url, 'revokeObjectURL', { configurable: true, value: () => {} });
	anchorPrototype.click = function click() {
		downloadedName = this.download;
	};
	try {
		const panel = new FrameGraphInspector();
		panel.setSnapshot(toSnapshot(createGroupedCapture()));
		panel.downloadSnapshot();
		assert.equal(downloadedName, 'frame-graph-2.fgsnapshot.json');
		assert.ok(downloadedBlob);
		assert.equal(JSON.parse(await downloadedBlob.text()).format, 'zenfg.frame-graph-snapshot');
		panel.destroy();
	} finally {
		Object.defineProperty(url, 'createObjectURL', { configurable: true, value: previousCreate });
		Object.defineProperty(url, 'revokeObjectURL', { configurable: true, value: previousRevoke });
		anchorPrototype.click = previousClick;
		testWindow.close();
	}
});



test('does not apply stale Copied feedback after the capture is replaced', async () => {
	const testWindow = installDom();
	let resolveCopy!: () => void;
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: () => new Promise<void>((resolve) => {
				resolveCopy = resolve;
			}),
		},
	});
	const panel = new FrameGraphInspector();
	panel.setSnapshot(toSnapshot(createGroupedCapture()));
	copyAction(panel.dom).click();
	assert.equal(copyAction(panel.dom).textContent, 'Copying…');

	panel.setSnapshot(toSnapshot(createEmptyCapture()));
	resolveCopy();
	await flushAsync();
	assert.equal(copyAction(panel.dom).textContent, 'Copy JSON');
	assert.equal(copyAction(panel.dom).disabled, false);

	panel.destroy();
	testWindow.close();
});

test('imports V1 and Legacy JSON atomically without removing the live provider', async () => {
	const testWindow = installDom();
	let liveCaptures = 0;
	const panel = new FrameGraphInspector({
		captureSnapshot: async () => {
			liveCaptures++;
			return toSnapshot(createEmptyCapture());
		},
	});
	const legacy = createGroupedCapture();
	await panel.importSnapshot(new testWindow.File(
		[JSON.stringify(legacy)],
		'legacy.json',
		{ type: 'application/json' },
	) as unknown as File);
	assert.equal(panel.getSnapshot()?.capture.frameIndex, 2);
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /Legacy V0 → V1/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /migrated/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /Texture viewsUnknown/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /Recording orderUnknown/);

	const canonical = panel.getSnapshot();
	assert.ok(canonical);
	await panel.importSnapshot(new testWindow.File(
		[JSON.stringify(canonical)],
		'canonical.fgsnapshot.json',
		{ type: 'application/json' },
	) as unknown as File);
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /Legacy V0 → V1/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /migration provenance/);

	await panel.captureSnapshot();
	assert.equal(liveCaptures, 1);
	assert.equal(panel.getSnapshot()?.capture.frameIndex, 1);
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /Live Capture/);

	panel.destroy();
	testWindow.close();
});

test('imports the t3d V1 candidate with canonical migration provenance and feedback', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	const candidate = readWorkspaceJson('packages/snapshot/fixtures/legacy-t3d-v1.json');

	await panel.importSnapshot(new testWindow.File(
		[JSON.stringify(candidate)],
		'legacy-t3d-v1.json',
		{ type: 'application/json' },
	) as unknown as File);

	const snapshot = panel.getSnapshot();
	assert.equal(snapshot?.format, 'zenfg.frame-graph-snapshot');
	assert.equal(snapshot?.capture.frameIndex, 42);
	assert.equal(snapshot?.capture.migration?.sourceFormat, 't3d-v1');
	const status = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-command-status');
	assert.match(status?.textContent ?? '', /Imported t3d V1 candidate and migrated it to ZenFG Snapshot V1/);
	assert.equal(status?.dataset.tone, 'neutral');

	panel.destroy();
	testWindow.close();
});

test('rejects semantic-invalid and over-depth Snapshots atomically and reports their JSON Pointers', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	panel.setSnapshot(toSnapshot(createGroupedCapture()));
	const current = panel.getSnapshot();
	const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs');
	assert.ok(tabs);
	tabButton(tabs, 'Passes').click();
	const passRows = panel.dom.querySelectorAll<HTMLTableRowElement>('#zenfg-inspector-pass-list-panel tbody tr');
	assert.ok(passRows.length > 1);
	const selectedRow = passRows[1];
	const selectedButton = selectedRow.querySelector<HTMLButtonElement>('.zenfg-inspector-relation-button');
	assert.ok(selectedButton);
	selectedButton.click();
	assert.equal(selectedRow.classList.contains('selected'), true);
	const selectedBefore = selectedRow.textContent;
	const invalid = readWorkspaceJson('packages/snapshot/conformance/invalid/semantic-duplicate-id.json');

	await panel.importSnapshot(new testWindow.File(
		[JSON.stringify(invalid)],
		'semantic-invalid.fgsnapshot.json',
		{ type: 'application/json' },
	) as unknown as File);

	assert.equal(panel.getSnapshot(), current);
	const selectedAfter = panel.dom.querySelector<HTMLTableRowElement>('#zenfg-inspector-pass-list-panel tbody tr.selected');
	assert.equal(selectedAfter, selectedRow);
	assert.equal(selectedAfter?.textContent, selectedBefore);
	const status = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-command-status');
	assert.equal(status?.dataset.tone, 'error');
	assert.match(status?.textContent ?? '', /\/graph\/nodes\/1\/id/);
	assert.match(status?.textContent ?? '', /already declared/);

	const overDepth = readWorkspaceJson('packages/snapshot/conformance/invalid/structural-extension-depth-65.json');
	await panel.importSnapshot(new testWindow.File(
		[JSON.stringify(overDepth)],
		'over-depth.fgsnapshot.json',
		{ type: 'application/json' },
	) as unknown as File);

	assert.equal(panel.getSnapshot(), current);
	const selectedAfterDepth = panel.dom.querySelector<HTMLTableRowElement>('#zenfg-inspector-pass-list-panel tbody tr.selected');
	assert.equal(selectedAfterDepth, selectedRow);
	assert.equal(selectedAfterDepth?.textContent, selectedBefore);
	assert.equal(status?.dataset.tone, 'error');
	assert.match(status?.textContent ?? '', /\/extensions\/dev\.zenfg\.deep/);
	assert.match(status?.textContent ?? '', /must not exceed 64 container levels/);

	panel.destroy();
	testWindow.close();
});

test('keeps the current Snapshot and view state for invalid, oversized, and stale imports', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector({ maxImportBytes: 16 });
	panel.setSnapshot(toSnapshot(createGroupedCapture()));
	const current = panel.getSnapshot();

	await panel.importSnapshot(new testWindow.File(['{'], 'broken.json') as unknown as File);
	assert.equal(panel.getSnapshot(), current);
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /Invalid JSON/);

	await panel.importSnapshot({
		name: 'large.fgsnapshot.json',
		size: 17,
		text: async () => '{}',
	} as File);
	assert.equal(panel.getSnapshot(), current);
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /16 bytes/);

	let resolveText!: (text: string) => void;
	const staleImport = panel.importSnapshot({
		name: 'stale.fgsnapshot.json',
		size: 1,
		text: () => new Promise<string>((resolve) => { resolveText = resolve; }),
	} as File);
	const later = toSnapshot(createEmptyCapture());
	panel.setSnapshot(later);
	resolveText(JSON.stringify(toSnapshot(createGroupedCapture())));
	await staleImport;
	assert.deepEqual(panel.getSnapshot(), later);

	panel.destroy();
	testWindow.close();
});

test('does not apply capture or import results after destruction', async () => {
	const testWindow = installDom();
	let resolveCapture!: (snapshot: ReturnType<typeof toSnapshot>) => void;
	const panel = new FrameGraphInspector({
		captureSnapshot: () => new Promise((resolve) => { resolveCapture = resolve; }),
	});
	const pending = panel.captureSnapshot();
	panel.destroy();
	resolveCapture(toSnapshot(createGroupedCapture()));
	await pending;
	assert.equal(panel.getSnapshot(), undefined);
	testWindow.close();
});

test('renders graph controls in a dedicated toolbar with a semantic legend', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    panel.setSnapshot(toSnapshot(createGroupedCapture()));

    const graphPanel = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph-view');
    const toolbar = graphPanel?.querySelector<HTMLElement>('.zenfg-inspector-graph-toolbar');
    const graph = graphPanel?.querySelector<HTMLElement>('.zenfg-inspector-graph');
    const legend = toolbar?.querySelector<HTMLElement>('.zenfg-inspector-graph-legend');
    assert.ok(graphPanel && toolbar && graph && legend);
    assert.equal(graphPanel.firstElementChild, toolbar);
    assert.equal(graphPanel.lastElementChild, graph);
    assert.equal(toolbar.getAttribute('role'), 'toolbar');
    assert.match(legend.textContent, /Render/);
    assert.match(legend.textContent, /Group/);
    assert.ok(toolbar.querySelector('[aria-label="Relayout graph"] svg'));
    assert.ok(toolbar.querySelector('[aria-label="Fit graph to view"] svg'));

    panel.destroy();
    testWindow.close();
});

test('keeps tabular and raw views available when graph layout exceeds its budget', () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector({ maxGraphElements: 0 });
	panel.setSnapshot(toSnapshot(createGroupedCapture()));

	const notice = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph-status');
	assert.ok(notice);
	assert.match(notice.textContent ?? '', /Automatic layout disabled/);
	assert.match(notice.textContent ?? '', /Passes, Resources, Memory, Diagnostics, and raw data remain available/);

	const tabs = panel.dom.querySelector<HTMLElement>('[role="tablist"]')!;
	tabButton(tabs, 'Passes').click();
	assert.ok(panel.dom.querySelector('.zenfg-inspector-workbench-table'));
	panel.destroy();
	testWindow.close();
});

test('normalizes resource reads and writes with produced or discarded results', () => {
    const capture: LegacyFrameGraphCapture = {
        ...createEmptyCapture(),
        compilation: {
            nodes: [{ id: 1, kind: 'render', label: 'pass', sideEffect: true }],
            culledNodes: [],
            resources: [{ id: 1, kind: 'texture', label: 'color', origin: 'imported', usage: 0x10 }],
            accesses: [
                {
                    id: 1,
                    nodeId: 1,
                    resourceId: 1,
                    access: TextureAccess.Sampled,
                    mode: 'read',
                    producesValue: false,
                },
                {
                    id: 2,
                    nodeId: 1,
                    resourceId: 1,
                    access: TextureAccess.ColorAttachmentWrite,
                    mode: 'write',
                    contents: 'preserve',
                    producesValue: false,
                },
            ],
            dependencies: [],
            roots: [{ reason: 'side-effect', nodeId: 1 }],
            allocations: [],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1] }],
        },
    };

    const snapshot = createLegacyDebugViewModel(capture);
    assert.deepEqual(snapshot.accessEdges.map((access) => ({
        mode: access.mode,
        contents: access.contents,
        producesValue: access.producesValue,
    })), [
        { mode: 'read', contents: undefined, producesValue: false },
        { mode: 'write', contents: 'preserve', producesValue: false },
    ]);

	assert.equal(snapshot.accessesByResourceId.get('resource:1')?.filter((access) => access.mode === 'read').length, 1);
	assert.equal(snapshot.accessesByResourceId.get('resource:1')?.filter((access) => access.mode === 'write').length, 1);
});

test('normalizes debug group paths and derives retained summaries', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    assert.deepEqual(snapshot.debugGroups.map((group) => [group.path, group.summary.retainedNodeCount, group.summary.culledNodeCount]), [
        [['PostFX'], 1, 1],
        [['PostFX', 'Bloom'], 1, 0],
        [['PostFX', 'Culled Only'], 0, 1],
    ]);
    const bloom = snapshot.debugGroups[1]!;
    assert.deepEqual(bloom.summary.inputResources.map((resource) => resource.label), ['scene-color']);
    assert.deepEqual(bloom.summary.outputResources.map((resource) => resource.label), ['postfx-color']);
    assert.equal(bloom.summary.registeredTransientResourceCount, 1);
    assert.equal(bloom.summary.accessedTransientResourceCount, 1);
    assert.equal(bloom.summary.physicalAllocationCount, 1);
    assert.equal(bloom.summary.gpuWorkDurationMicros, 25);
    assert.equal(bloom.summary.timedNodeCount, 1);
    assert.equal(bloom.summary.timingEligibleNodeCount, 1);
});


test('builds timing, access, segment, and memory indexes while preserving legacy Unknown fields', () => {
	const grouped = createLegacyDebugViewModel(createGroupedCapture());
	assert.equal(grouped.metrics.timingEligibleNodeCount, 3);
	assert.equal(grouped.metrics.timedNodeCount, 3);
	assert.equal(grouped.metrics.slowestNode?.label, 'bloom');
	assert.equal(grouped.accessesByResourceId.get('resource:1')?.length, 2);
	assert.equal(grouped.segmentByNodeId.get('node:2')?.index, 0);
	assert.equal(grouped.nodeById.get('node:3')?.label, 'present');

	const aliasCapture: LegacyFrameGraphCapture = {
		...createEmptyCapture(),
		compilation: {
			...createEmptyCapture().compilation,
			nodes: [
				{ id: 1, kind: 'compute', sideEffect: true },
				{ id: 2, kind: 'compute', sideEffect: true },
			],
			resources: [
				{
					id: 1, kind: 'buffer', label: 'first', origin: 'transient', usage: 0x80,
					descriptor: { size: 70 }, estimatedByteSize: 70,
					lifetime: { firstUse: 0, lastUse: 0 }, physicalAllocationId: 1,
				},
				{
					id: 2, kind: 'buffer', label: 'second', origin: 'transient', usage: 0x80,
					descriptor: { size: 70 }, estimatedByteSize: 70,
					lifetime: { firstUse: 1, lastUse: 1 }, physicalAllocationId: 1,
				},
			],
			allocations: [{ id: 1, kind: 'buffer', compatibilityClassId: 1, estimatedByteSize: 128 }],
			roots: [
				{ reason: 'side-effect', nodeId: 1 },
				{ reason: 'side-effect', nodeId: 2 },
			],
			executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2] }],
		},
	};
	const alias = createLegacyDebugViewModel(aliasCapture);
	assert.equal(alias.metrics.transientEstimatedByteSize, 140);
	assert.equal(alias.metrics.logicalCapacityBytes, 256);
	assert.equal(alias.metrics.physicalEstimatedBytes, 128);
	assert.equal(alias.metrics.aliasReuseBytes, 128);
	assert.equal(alias.metrics.aliasedAllocationCount, 1);

	const legacy = createLegacyDebugViewModel(createEmptyCapture());
	assert.equal(legacy.metrics.transientEstimatedByteSize, 0);
	assert.equal(legacy.metrics.physicalEstimatedBytes, 0);
	assert.deepEqual(legacy.availability, {
		groups: false,
		textureViews: false,
		recordingOrder: false,
		accessRegions: true,
	});
});

test('renders persistent workbench tabs and Inspector Summary, Relations, and Raw panes', () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	panel.setSnapshot(toSnapshot(createGroupedCapture()));

	const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs');
	assert.ok(tabs);
	assert.equal(tabButton(tabs, 'Graph').getAttribute('aria-selected'), 'true');
	const resourcesTab = tabButton(tabs, 'Resources');
	resourcesTab.click();
	assert.equal(resourcesTab.getAttribute('aria-selected'), 'true');
	assert.equal(tabButton(tabs, 'Graph').getAttribute('aria-selected'), 'false');
	assert.match(panel.dom.querySelector('.zenfg-inspector-resources-view')?.textContent ?? '', /Unknown/);
	assert.ok(panel.dom.querySelector('.zenfg-inspector-resources-view th[data-column="numeric"]'));
	assert.ok(panel.dom.querySelector('.zenfg-inspector-resources-view td[data-column="code"]'));
	assert.ok(panel.dom.querySelector('.zenfg-inspector-kind-label[data-kind="texture"]'));

	const sceneResource = Array.from(panel.dom.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-resources-view .zenfg-inspector-relation-button'))
		.find((button) => button.textContent === 'scene-color');
	assert.ok(sceneResource);
	sceneResource.click();
	assert.equal(resourcesTab.getAttribute('aria-selected'), 'true');
	assert.equal(panel.dom.querySelector('.zenfg-inspector-inspector > header strong')?.textContent, 'scene-color');

	const inspectorTabs = panel.dom.querySelector('.zenfg-inspector-inspector-tabs');
	assert.ok(inspectorTabs);
	tabButton(inspectorTabs, 'Relations').click();
	assert.match(panel.dom.querySelector('.zenfg-inspector-inspector-content')?.textContent ?? '', /Pass accesses/);
	tabButton(inspectorTabs, 'Raw').click();
	assert.match(panel.dom.querySelector('.zenfg-inspector-raw-detail')?.textContent ?? '', /scene-color/);
	assert.equal(tabButton(inspectorTabs, 'Raw').getAttribute('aria-selected'), 'true');

	tabButton(tabs, 'Memory').click();
	const ticks = panel.dom.querySelectorAll('.zenfg-inspector-memory-axis-track > span');
	assert.ok(ticks.length > 0);
	assert.ok(ticks.length <= 6);
	panel.destroy();
	testWindow.close();
});
test('filters clear-buffer passes, searches labels, and sorts timed passes by GPU duration', () => {
	const testWindow = installDom();
	const capture: LegacyFrameGraphCapture = {
		...createEmptyCapture(),
		compilation: {
			...createEmptyCapture().compilation,
			nodes: [
				{ id: 1, kind: 'render', label: 'slow-pass', sideEffect: true },
				{ id: 2, kind: 'clear-buffer', label: 'clear-pass', sideEffect: true },
				{ id: 3, kind: 'compute', label: 'fast-pass', sideEffect: true },
			],
			roots: [
				{ reason: 'side-effect', nodeId: 1 },
				{ reason: 'side-effect', nodeId: 2 },
				{ reason: 'side-effect', nodeId: 3 },
			],
			executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2, 3] }],
		},
		gpuTiming: {
			status: 'available',
			frameIndex: 3,
			frameDurationMicros: 30,
			nodes: [
				{ nodeId: 1, kind: 'render', durationMicros: 30 },
				{ nodeId: 3, kind: 'compute', durationMicros: 10 },
			],
		},
	};
	const panel = new FrameGraphInspector();
	panel.setSnapshot(toSnapshot(capture));
	const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs');
	assert.ok(tabs);
	tabButton(tabs, 'Passes').click();

	const kind = panel.dom.querySelector<HTMLSelectElement>('[aria-label="Pass kind"]');
	assert.ok(kind);
	assert.ok(Array.from(kind.options).some((option) => option.value === 'clear-buffer'));
	kind.value = 'clear-buffer';
	kind.dispatchEvent(new Event('change'));
	assert.deepEqual(passListLabels(panel.dom), ['clear-pass']);

	kind.value = 'all';
	kind.dispatchEvent(new Event('change'));
	const sort = panel.dom.querySelector<HTMLSelectElement>('[aria-label="Sort passes"]');
	assert.ok(sort);
	sort.value = 'gpu';
	sort.dispatchEvent(new Event('change'));
	assert.deepEqual(passListLabels(panel.dom), ['slow-pass', 'fast-pass', 'clear-pass']);

	const search = panel.dom.querySelector<HTMLInputElement>('.zenfg-inspector-passes-view input[type="search"]');
	assert.ok(search);
	search.value = 'fast';
	search.dispatchEvent(new Event('input'));
	assert.deepEqual(passListLabels(panel.dom), ['fast-pass']);

	panel.destroy();
	testWindow.close();
});

test('keeps active view, filters, Inspector state, and list scroll across selection and capture refresh', () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	panel.setSnapshot(toSnapshot(createLongCapture(80)));
	const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs');
	assert.ok(tabs);
	tabButton(tabs, 'Passes').click();
	const scroller = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-passes-view .zenfg-inspector-table-scroller');
	assert.ok(scroller);
	scroller.scrollTop = 240;
	const lastPass = Array.from(panel.dom.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-passes-view .zenfg-inspector-relation-button'))
		.find((button) => button.textContent === 'pass-80');
	assert.ok(lastPass);
	lastPass.click();
	assert.equal(panel.dom.querySelector('.zenfg-inspector-passes-view .zenfg-inspector-table-scroller'), scroller);
	assert.equal(scroller.scrollTop, 240);

	tabButton(tabs, 'Resources').click();
	const search = panel.dom.querySelector<HTMLInputElement>('.zenfg-inspector-resources-view input[type="search"]');
	assert.ok(search);
	search.value = 'scene';
	search.dispatchEvent(new Event('input'));
	const close = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-inspector-close');
	assert.ok(close);
	close.click();
	panel.setSnapshot(toSnapshot(createGroupedCapture()));
	assert.equal(tabButton(tabs, 'Resources').getAttribute('aria-selected'), 'true');
	assert.equal(search.value, 'scene');
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-inspector')?.hidden, true);
	assert.match(panel.dom.querySelector('.zenfg-inspector-resources-view')?.textContent ?? '', /scene-color/);
	assert.doesNotMatch(panel.dom.querySelector('.zenfg-inspector-resources-view')?.textContent ?? '', /postfx-color/);
	assert.equal(panel.dom.querySelector('.zenfg-inspector-inspector > header strong')?.textContent, 'scene');

	const sceneResource = Array.from(panel.dom.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-resources-view .zenfg-inspector-relation-button'))
		.find((button) => button.textContent === 'scene-color');
	assert.ok(sceneResource);
	sceneResource.click();
	panel.setSnapshot(toSnapshot(createGroupedCapture()));
	assert.equal(panel.dom.querySelector('.zenfg-inspector-inspector > header strong')?.textContent, 'scene-color');

	panel.destroy();
	testWindow.close();
});

test('rejects malformed debug group hierarchy while accepting legacy captures', () => {
    assert.doesNotThrow(() => createLegacyDebugViewModel(createEmptyCapture()));
    const capture = createGroupedCapture();
    assert.throws(() => createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            debugGroups: [{ id: 1, label: 'A' }, { id: 1, label: 'B' }],
        },
    }), /already declared/);
    assert.throws(() => createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            debugGroups: [{ id: 1, parentId: 99, label: 'A' }],
        },
    }), /group:99/);
    assert.throws(() => createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            debugGroups: [{ id: 1, parentId: 2, label: 'A' }, { id: 2, parentId: 1, label: 'B' }],
        },
    }), /cycle/);
    assert.throws(() => createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            nodes: [{ id: 1, kind: 'render', sideEffect: true, debugGroupId: 99 }],
            debugGroups: [],
        },
    }), /group:99/);
});

function createEmptyCapture(): LegacyFrameGraphCapture {
    return {
        compilation: {
            nodes: [],
            culledNodes: [],
            resources: [],
            accesses: [],
            dependencies: [],
            roots: [],
            allocations: [],
            executionSegments: [],
        },
        gpuTiming: { status: 'unavailable', frameIndex: 1, reason: 'unsupported' },
        resourcePool: {
            acquireCount: 0,
            reuseCount: 0,
            createdCount: 0,
            retainedCount: 0,
            estimatedRetainedBytes: 0,
        },
    };
}

function createGroupedCapture(): LegacyFrameGraphCapture {
    return {
        compilation: {
            debugGroups: [
                { id: 1, label: 'PostFX' },
                { id: 2, parentId: 1, label: 'Bloom' },
                { id: 3, parentId: 1, label: 'Culled Only' },
            ],
            nodes: [
                { id: 1, kind: 'render', label: 'scene', sideEffect: false },
                { id: 2, kind: 'render', label: 'bloom', sideEffect: false, debugGroupId: 2 },
                { id: 3, kind: 'render', label: 'present', sideEffect: true },
            ],
            culledNodes: [
                { id: 4, kind: 'compute', label: 'unused', sideEffect: false, debugGroupId: 3, reason: 'not-reachable-from-root' },
            ],
            resources: [
                { id: 1, kind: 'texture', label: 'scene-color', origin: 'imported', usage: 0x14 },
                { id: 2, kind: 'texture', label: 'postfx-color', origin: 'transient', usage: 0x14, debugGroupId: 2, physicalAllocationId: 1 },
                { id: 3, kind: 'buffer', label: 'unused-buffer', origin: 'transient', usage: 0x80, debugGroupId: 3 },
            ],
            accesses: [
                { id: 1, nodeId: 1, resourceId: 1, access: TextureAccess.ColorAttachmentWrite, mode: 'write', contents: 'overwrite', producesValue: true, order: 0 },
                { id: 2, nodeId: 2, resourceId: 1, access: TextureAccess.Sampled, mode: 'read', producesValue: false, order: 1 },
                { id: 3, nodeId: 2, resourceId: 2, access: TextureAccess.ColorAttachmentWrite, mode: 'write', contents: 'overwrite', producesValue: true, order: 1 },
                { id: 4, nodeId: 3, resourceId: 2, access: TextureAccess.Sampled, mode: 'read', producesValue: false, order: 2 },
                { id: 5, nodeId: 4, resourceId: 3, access: BufferAccess.StorageWrite, mode: 'write', contents: 'overwrite', producesValue: true },
            ],
            dependencies: [
                { fromNodeId: 1, toNodeId: 2, resourceId: 1, kind: 'value' },
                { fromNodeId: 2, toNodeId: 3, resourceId: 2, kind: 'value' },
            ],
            roots: [{ reason: 'side-effect', nodeId: 3 }],
            allocations: [{ id: 1, kind: 'texture', compatibilityClassId: 1 }],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2, 3] }],
        },
        gpuTiming: {
            status: 'available',
            frameIndex: 2,
            frameDurationMicros: 55,
            nodes: [
                { nodeId: 1, kind: 'render', durationMicros: 20 },
                { nodeId: 2, kind: 'render', durationMicros: 25 },
                { nodeId: 3, kind: 'render', durationMicros: 10 },
            ],
        },
        resourcePool: {
            acquireCount: 1,
            reuseCount: 0,
            createdCount: 1,
            retainedCount: 1,
            estimatedRetainedBytes: 64,
        },
    };
}


function tabButton(root: ParentNode, label: string): HTMLButtonElement {
	const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
		.find((candidate) => candidate.textContent === label);
	assert.ok(button, `Expected tab ${label}`);
	return button;
}

function passListLabels(root: ParentNode): string[] {
	return Array.from(
		root.querySelectorAll<HTMLButtonElement>('#zenfg-inspector-pass-list-panel .zenfg-inspector-relation-button'),
		(button) => button.textContent ?? '',
	);
}

function createLongCapture(count: number): LegacyFrameGraphCapture {
	const ids = Array.from({ length: count }, (_, index) => index + 1);
	return {
		...createEmptyCapture(),
		compilation: {
			...createEmptyCapture().compilation,
			nodes: ids.map((id) => ({ id, kind: 'render' as const, label: `pass-${id}`, sideEffect: true })),
			roots: ids.map((id) => ({ reason: 'side-effect' as const, nodeId: id })),
			executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: ids }],
		},
	};
}

function captureAction(root: ParentNode): HTMLButtonElement {
	const action = root.querySelector<HTMLButtonElement>('.zenfg-inspector-capture-action');
	assert.ok(action);
	return action;
}

function copyAction(root: ParentNode): HTMLButtonElement {
	const action = root.querySelector<HTMLButtonElement>('.zenfg-inspector-copy-action');
	assert.ok(action);
	return action;
}

async function flushAsync(): Promise<void> {
	await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function readWorkspaceJson(path: string): unknown {
	return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as unknown;
}

function installDom(): Window {
    const testWindow = new Window({ url: 'http://localhost/' });
    Reflect.set(globalThis, 'window', testWindow);
    Reflect.set(globalThis, 'document', testWindow.document);
    Reflect.set(globalThis, 'navigator', testWindow.navigator);
    Reflect.set(globalThis, 'Event', testWindow.Event);
    return testWindow;
}
