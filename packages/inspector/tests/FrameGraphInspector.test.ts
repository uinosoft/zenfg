import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { Window } from 'happy-dom';

import { FrameGraphInspector, mountFrameGraphInspector } from '../src/FrameGraphInspector.ts';
import type { GraphRenderRequest } from '../src/panelGraphRenderer.ts';
import type { GraphViewState } from '../src/panelTypes.ts';
import { BufferAccess, TextureAccess } from './accessKinds.ts';
import { createLegacyDebugViewModel, toSnapshot, type LegacyFrameGraphCapture } from './legacySnapshotFixture.ts';
import { createFrameFlowVisualFixture } from '../../webgpu/tests/frameFlowVisualFixture.ts';

test('renders an always-visible branded workbench with commands outside the tablist', () => {
	const testWindow = installDom();
	const panel = mountFrameGraphInspector(document.body);

	assert.equal(panel.dom.classList.contains('zenfg-inspector'), true);
	assert.equal(panel.dom.querySelector('.zenfg-inspector-shell-header'), null);
	assert.equal(panel.dom.querySelector('.zenfg-inspector-brand')?.textContent, 'ZenFG Inspector');
	const commandBar = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-command-bar');
	const tabs = commandBar?.querySelector<HTMLElement>('[role="tablist"]');
	const actions = commandBar?.querySelector<HTMLElement>('[role="toolbar"]');
	assert.ok(commandBar && tabs && actions);
	assert.equal(actions.getAttribute('aria-label'), 'FrameGraph commands');
	assert.equal(tabs.contains(actions), false);
	assert.equal(tabs.contains(panel.dom.querySelector('.zenfg-inspector-open-inspector')), false);
	assert.equal(actions.contains(panel.dom.querySelector('.zenfg-inspector-open-inspector')), true);
	assert.equal(captureAction(panel.dom).disabled, true);
	assert.equal(captureAction(panel.dom).hidden, true);
	assert.equal(copyAction(panel.dom).disabled, true);
	assert.equal(tabButton(tabs, 'Graph').disabled, true);
	assert.match(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent ?? '', /Drop a ZenFG Snapshot/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent ?? '', /processed locally/);

	panel.setSnapshot(toSnapshot(createEmptyCapture()));
	assert.equal(copyAction(panel.dom).disabled, false);
	assert.equal(tabButton(tabs, 'Graph').disabled, false);
	const overview = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-overview-view');
	const summary = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-capture-summary');
	assert.ok(overview && summary);
	assert.equal(overview.hidden, true);
	tabButton(tabs, 'Overview').click();
	assert.equal(overview.hidden, false);
	assert.match(summary.textContent, /Capture/);

	const exportButton = commandBar.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
	const exportMenu = commandBar.querySelector<HTMLElement>('.zenfg-inspector-export-menu');
	assert.ok(exportButton && exportMenu);
	assert.equal(exportMenu.parentElement, commandBar);
	assert.equal(actions.contains(exportMenu), false);
	exportButton.click();
	assert.equal(exportMenu.hidden, false);
	assert.equal(exportButton.getAttribute('aria-expanded'), 'true');
	tabButton(tabs, 'Graph').click();
	assert.equal(exportMenu.hidden, true);
	assert.equal(exportButton.getAttribute('aria-expanded'), 'false');

	panel.destroy();
	assert.equal(panel.dom.isConnected, false);
	testWindow.close();
});

test('supports configurable branding and unique accessible ids across instances', () => {
	const testWindow = installDom();
	const first = new FrameGraphInspector({ branding: 'Custom Inspector' });
	const second = new FrameGraphInspector({ branding: false });

	assert.equal(first.dom.querySelector('.zenfg-inspector-brand')?.textContent, 'Custom Inspector');
	assert.equal(first.dom.getAttribute('aria-label'), 'Custom Inspector');
	assert.equal(second.dom.querySelector('.zenfg-inspector-brand'), null);
	assert.equal(second.dom.getAttribute('aria-label'), 'ZenFG Inspector');
	const firstIds = new Set(Array.from(first.dom.querySelectorAll<HTMLElement>('[id]'), (element) => element.id));
	const secondIds = new Set(Array.from(second.dom.querySelectorAll<HTMLElement>('[id]'), (element) => element.id));
	assert.equal([...firstIds].some((id) => secondIds.has(id)), false);
	for (const panel of [first, second]) {
		for (const control of panel.dom.querySelectorAll<HTMLElement>('[aria-controls]')) {
			const targetId = control.getAttribute('aria-controls');
			assert.ok(targetId && panel.dom.querySelector(`[id="${targetId}"]`));
		}
		panel.destroy();
	}
	testWindow.close();
});

test('imports the first dropped file, ignores non-file drags, and unwires on destroy', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	const snapshot = toSnapshot(createEmptyCapture());
	const fixture = new testWindow.File(
		[JSON.stringify(snapshot)],
		'fixture.fgsnapshot.json',
		{ type: 'application/json' },
	) as unknown as File;
	const overlay = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-drop-overlay');
	assert.ok(overlay);

	const textDrag = new testWindow.Event('dragover', { cancelable: true }) as unknown as DragEvent;
	Object.defineProperty(textDrag, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
	panel.dom.dispatchEvent(textDrag);
	assert.equal(textDrag.defaultPrevented, false);
	assert.equal(overlay.hidden, true);

	const dragEnter = new testWindow.Event('dragenter', { cancelable: true }) as unknown as DragEvent;
	Object.defineProperty(dragEnter, 'dataTransfer', { value: { types: ['Files'], files: [fixture] } });
	panel.dom.dispatchEvent(dragEnter);
	assert.equal(dragEnter.defaultPrevented, true);
	assert.equal(overlay.hidden, false);

	const drop = new testWindow.Event('drop', { cancelable: true }) as unknown as DragEvent;
	Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [fixture] } });
	panel.dom.dispatchEvent(drop);
	await flushAsync();
	assert.equal(drop.defaultPrevented, true);
	assert.equal(overlay.hidden, true);
	assert.deepEqual(panel.getSnapshot(), snapshot);

	panel.destroy();
	const afterDestroy = new testWindow.Event('dragenter', { cancelable: true }) as unknown as DragEvent;
	Object.defineProperty(afterDestroy, 'dataTransfer', { value: { types: ['Files'], files: [fixture] } });
	panel.dom.dispatchEvent(afterDestroy);
	assert.equal(afterDestroy.defaultPrevented, false);
	assert.equal(overlay.hidden, true);
	testWindow.close();
});

test('imports a snapshot through the built-in file input', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	const snapshot = toSnapshot(createEmptyCapture());
	const fixture = new testWindow.File(
		[JSON.stringify(snapshot)],
		'fixture.fgsnapshot.json',
		{ type: 'application/json' },
	) as unknown as File;
	const input = panel.dom.querySelector<HTMLInputElement>('input[type="file"]');
	assert.ok(input);
	Object.defineProperty(input, 'files', { configurable: true, value: [fixture] });

	input.dispatchEvent(new testWindow.Event('change') as unknown as Event);
	await flushAsync();

	assert.deepEqual(panel.getSnapshot(), snapshot);
	assert.equal(input.value, '');
	panel.destroy();
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
	assert.match(css, /\.zenfg-inspector-body \{[^}]*border: 0;[^}]*border-radius: 0;/s);
	assert.match(css, /container-name: zenfg-inspector/);
	assert.match(css, /@container zenfg-inspector \(max-width: 840px\)/);
	assert.equal(css.includes('#zenfg-inspector'), false);
	assert.equal(css.includes('.zenfg-inspector-stats'), false);
	assert.equal(css.includes('.zenfg-inspector-timeline'), false);

	const capture = captureAction(panel.dom);
	const download = downloadAction(panel.dom);
	const copy = copyAction(panel.dom);
	const inspector = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-open-inspector');
	const close = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-inspector-close');
	assert.ok(inspector && close);
	for (const button of [capture, download, copy, inspector, close]) {
		const icon = button.querySelector<SVGElement>('.zenfg-inspector-control-icon');
		assert.ok(icon);
		assert.equal(icon.getAttribute('aria-hidden'), 'true');
	}
	assert.equal(capture.textContent, 'Capture');
	assert.equal(download.textContent, 'Download JSON');
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

	await flushAsync();
	assert.equal(calls, 1);
	assert.match(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent ?? '', /No snapshot was produced/);
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'error');
	assert.equal(captureAction(panel.dom).disabled, false);

	captureAction(panel.dom).click();
	await flushAsync();
	assert.equal(calls, 2);

	panel.destroy();
	testWindow.close();
});

test('starts the one-shot capture when a source is injected into the visible workbench', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	assert.match(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent ?? '', /Drop a ZenFG Snapshot/);
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'empty');
	assert.equal(captureAction(panel.dom).hidden, true);

	let calls = 0;
	let resolveCapture!: (snapshot: ReturnType<typeof toSnapshot> | undefined) => void;
	panel.setCaptureSnapshotProvider(() => {
		calls += 1;
		return new Promise((resolve) => {
			resolveCapture = resolve;
		});
	});
	assert.equal(calls, 1);
	assert.equal(captureAction(panel.dom).hidden, false);
	assert.equal(captureAction(panel.dom).textContent, 'Capturing…');
	assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'capturing');
	assert.equal(captureAction(panel.dom).querySelector('svg')?.dataset.icon, 'spinner');
	assert.equal(captureAction(panel.dom).disabled, true);

	resolveCapture(toSnapshot(createGroupedCapture()));
	await flushAsync();
	assert.equal(captureAction(panel.dom).textContent, 'Capture');
	assert.equal(captureAction(panel.dom).disabled, false);
	assert.equal(copyAction(panel.dom).disabled, false);
	assert.ok(panel.dom.querySelector('.zenfg-inspector-overview-view .zenfg-inspector-capture-summary'));

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
	tabButton(panel.dom.querySelector('.zenfg-inspector-workbench-tabs')!, 'Overview').click();
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /legacy-v0 → canonical v1\.1/);
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
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /legacy-v0 → canonical v1\.1/);
	assert.match(panel.dom.querySelector('.zenfg-inspector-command-status')?.textContent ?? '', /migration provenance/);

	await panel.captureSnapshot();
	assert.equal(liveCaptures, 1);
	assert.equal(panel.getSnapshot()?.capture.frameIndex, 1);
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /Live Capture/);

	panel.destroy();
	testWindow.close();
});

test('imports Legacy Candidate V1 with canonical migration provenance and feedback', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	const candidate = readWorkspaceJson('packages/snapshot/fixtures/legacy-candidate-v1.json');

	await panel.importSnapshot(new testWindow.File(
		[JSON.stringify(candidate)],
		'legacy-candidate-v1.json',
		{ type: 'application/json' },
	) as unknown as File);

	const snapshot = panel.getSnapshot();
	assert.equal(snapshot?.format, 'zenfg.frame-graph-snapshot');
	assert.equal(snapshot?.capture.frameIndex, 42);
	assert.equal(snapshot?.capture.migration?.sourceFormat, 'legacy-candidate-v1');
	const status = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-command-status');
	assert.match(status?.textContent ?? '', /Imported Legacy Candidate V1 and migrated it to ZenFG Snapshot V1/);
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
	const passRows = panel.dom.querySelectorAll<HTMLTableRowElement>('.zenfg-inspector-passes-view tbody tr');
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
	const selectedAfter = panel.dom.querySelector<HTMLTableRowElement>('.zenfg-inspector-passes-view tbody tr.selected');
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
	const selectedAfterDepth = panel.dom.querySelector<HTMLTableRowElement>('.zenfg-inspector-passes-view tbody tr.selected');
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
	assert.equal(toolbar.querySelector('[aria-label="Relayout graph"]'), null);
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
	const capture = createGroupedCapture();
	capture.compilation.resources[1]!.lifetime = { firstUse: 1, lastUse: 2 };
	panel.setSnapshot(toSnapshot(capture));

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
test('renders native-role shape swatches for external submissions and output roots', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector({ maxGraphElements: 1 });
    panel.setSnapshot(JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')));
    const legend = panel.dom.querySelector('.zenfg-inspector-graph-legend') ?? panel.dom.querySelector('[aria-label="Graph legend"]');
    assert.ok(legend);
    for (const shape of ['cut-rectangle', 'tag']) {
        const swatch = legend.querySelector(`[data-shape="${shape}"]`)!;
        assert.ok(swatch.querySelector('svg[aria-hidden="true"] polygon'));
        assert.ok(swatch.parentElement!.textContent?.includes(shape === 'tag' ? 'Output' : 'External'));
    }
    panel.destroy();
    testWindow.close();
});

test('resource navigation replaces selection in Summary without switching views or changing graph projection', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    const graphView = (panel as unknown as { graphView: GraphViewState }).graphView;
    let request: GraphRenderRequest;
    graphView.renderer = {
        render: (next) => { request = next; }, destroy: () => undefined,
        resize: () => undefined, fit: () => assert.fail('Resource navigation must not fit'), relayout: () => undefined,
    };
    const capture = createGroupedCapture();
    const snapshot = toSnapshot({ ...capture, compilation: { ...capture.compilation,
        roots: [...capture.compilation.roots, { reason: 'output', resourceId: 2 }],
    } });
    panel.setSnapshot(snapshot);
    const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs')!;
    const inspectorTabs = panel.dom.querySelector('.zenfg-inspector-inspector-tabs')!;
    const search = panel.dom.querySelector<HTMLInputElement>('.zenfg-inspector-resources-view input[type="search"]')!;
    search.value = 'no match';
    search.dispatchEvent(new testWindow.Event('input') as unknown as Event);
    const selectedResource = { kind: 'resource' as const, id: 'resource:2' };
    const selectionKey = 'resource:resource:2';
    const edge = request!.scene.edges.find((edge) => edge.resourceId === selectedResource.id)!;
    const edgeSelection = request!.scene.interaction.selectionByElementId.get(edge.id)!;
    assert.deepEqual(edgeSelection, selectedResource);
    request!.onSelect(edgeSelection);
    tabButton(inspectorTabs, 'Relations').click();
    request!.onSelect(edgeSelection);
    assert.equal(tabButton(inspectorTabs, 'Relations').getAttribute('aria-selected'), 'true');
    request!.onSelect({ kind: 'resource', id: 'resource:1' });
    assert.equal(tabButton(inspectorTabs, 'Summary').getAttribute('aria-selected'), 'true');
    const rootNode = request!.scene.nodes.find((node) => node.kind === 'root')!;
    const root = request!.scene.interaction.selectionByElementId.get(rootNode.id)!;
    for (const selection of [root]) {
        for (const tab of ['Summary', 'Relations']) {
            request!.onSelect(selection);
            tabButton(inspectorTabs, tab).click();
            const content = panel.dom.querySelector('.zenfg-inspector-inspector-content')!;
            const button = Array.from(content.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
                tab === 'Summary' ? button.textContent === 'View resource · postfx-color' : button.textContent === 'postfx-color');
            assert.ok(button);
            button.dispatchEvent(new testWindow.MouseEvent('mouseenter') as unknown as Event);
            assert.deepEqual(request!.hovered, selectedResource);
            assert.deepEqual(request!.selected, selection);
            assert.equal(tabButton(inspectorTabs, tab).getAttribute('aria-selected'), 'true');
            button.dispatchEvent(new testWindow.MouseEvent('mouseleave') as unknown as Event);
            assert.equal(request!.hovered, undefined);
            button.dispatchEvent(new testWindow.MouseEvent('mouseenter') as unknown as Event);
            button.click();
            assert.deepEqual(request!.selected, selectedResource);
            assert.equal(request!.hovered, undefined);
            assert.equal(request!.fit, false);
            assert.equal(request!.anchorElementId, undefined);
            assert.equal(tabButton(tabs, 'Graph').getAttribute('aria-selected'), 'true');
            assert.equal(tabButton(inspectorTabs, 'Summary').getAttribute('aria-selected'), 'true');
            assert.match(content.textContent ?? '', /Kind \/ origin/);
            assert.equal(search.value, 'no match');
            assert.equal(graphView.expandedGroupPaths.size, 0);
            assert.deepEqual(request!.scene.interaction.primaryElementIdsBySelection.get(selectionKey),
                request!.scene.edges.filter((edge) => edge.resourceId === selectedResource.id).map((edge) => edge.id));
        }
    }
    const groups = createLegacyDebugViewModel(capture).debugGroups;
    const legend = panel.dom.querySelector('.zenfg-inspector-graph-legend')!;
    const legendBefore = legend.innerHTML;
    assert.deepEqual(Array.from(legend.querySelectorAll('[role="group"]'), (group) => group.getAttribute('aria-label')),
        ['Execution', 'Resources', 'Relationships']);
    for (const group of groups.slice(0, 2)) request!.onToggleGroup(group.pathKey);
    assert.equal(legend.innerHTML, legendBefore);
    assert.deepEqual(request!.scene.interaction.primaryElementIdsBySelection.get(selectionKey), [
        'resource:resource:2', ...request!.scene.edges.filter((edge) => edge.resourceId === selectedResource.id).map((edge) => edge.id),
    ]);
    const summary = panel.dom.querySelector('.zenfg-inspector-inspector-content')!.textContent;
    request!.onHover(selectedResource);
    assert.deepEqual(request!.selected, selectedResource);
    assert.equal(panel.dom.querySelector('.zenfg-inspector-inspector-content')!.textContent, summary);
    request!.onToggleGroup(groups[0]!.pathKey);
    assert.equal(legend.innerHTML, legendBefore);
    assert.equal(request!.hovered, undefined);
    request!.onHover(selectedResource);
    panel.setSnapshot(snapshot);
    assert.equal(request!.hovered, undefined);
    assert.deepEqual(request!.selected, selectedResource);
    panel.destroy();
    testWindow.close();
});

test('detail link hover previews exact targets and clears on pane changes without turning access metadata into links', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    const graphView = (panel as unknown as { graphView: GraphViewState }).graphView;
    let request: GraphRenderRequest;
    graphView.renderer = {
        render: (next) => { request = next; }, destroy: () => undefined,
        resize: () => undefined, fit: () => assert.fail('Hover must not fit'), relayout: () => undefined,
    };
    const capture = createGroupedCapture();
    const snapshot = toSnapshot({ ...capture, compilation: { ...capture.compilation,
        roots: [...capture.compilation.roots, { reason: 'output', resourceId: 2 }],
        accesses: capture.compilation.accesses.map((access) => access.id === 3 ? { ...access,
            textureRegion: { baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, aspect: 'all' },
        } : access),
    } });
    panel.setSnapshot(snapshot);
    const tabs = panel.dom.querySelector('.zenfg-inspector-inspector-tabs')!;
    const content = panel.dom.querySelector('.zenfg-inspector-inspector-content')!;
    const enter = (element: HTMLElement) => element.dispatchEvent(new testWindow.MouseEvent('mouseenter') as unknown as Event);
    const leave = (element: HTMLElement) => element.dispatchEvent(new testWindow.MouseEvent('mouseleave') as unknown as Event);
    request!.onSelect({ kind: 'resource', id: 'resource:2' });
    tabButton(tabs, 'Relations').click();
    const passLink = tabButton(content, 'bloom');
    assert.equal(passLink.textContent, 'bloom');
    const accessFacts = passLink.closest('.zenfg-inspector-relation-entry')!.querySelector('span')!;
    assert.match(accessFacts.textContent!, /write.*color-attachment.*overwrite.*mip 0–0.*layers 0–0.*aspect all/);
    assert.equal(accessFacts.querySelector('button'), null);
    enter(passLink);
    assert.deepEqual(request!.hovered, { kind: 'node', id: 'node:2' });
    assert.deepEqual(request!.selected, { kind: 'resource', id: 'resource:2' });
    assert.deepEqual(request!.scene.interaction.hoverElementIdsBySelection.get('node:node:2') ?? [], []);
    assert.equal(request!.fit, false);
    assert.equal(request!.anchorElementId, undefined);
    leave(passLink);
    assert.equal(request!.hovered, undefined);
    enter(passLink);
    passLink.click();
    assert.deepEqual(request!.selected, { kind: 'node', id: 'node:2' });
    assert.equal(request!.hovered, undefined);
    const resourceLink = Array.from(content.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('postfx-color'))!;
    enter(resourceLink);
    assert.deepEqual(request!.hovered, { kind: 'resource', id: 'resource:2' });
    tabButton(tabs, 'Raw').click();
    assert.equal(request!.hovered, undefined);
    tabButton(tabs, 'Relations').click();
    const segment = tabButton(content, '#0 frame-graph');
    enter(segment);
    assert.deepEqual(request!.hovered, { kind: 'segment', index: 0 });
    assert.deepEqual(request!.scene.interaction.hoverElementIdsBySelection.get('segment:0') ?? [], []);
    panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-inspector-close')!.click();
    assert.equal(request!.hovered, undefined);
    panel.setSnapshot(JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')));
    const output = request!.scene.nodes.find((node) => node.kind === 'root')!;
    const outputEdge = request!.scene.edges.find((edge) => edge.to === output.id)!;
    request!.onSelect(request!.scene.interaction.selectionByElementId.get(outputEdge.id)!);
    tabButton(tabs, 'Relations').click();
    const outputLink = Array.from(content.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.startsWith('present · mip'))!;
    assert.ok(outputLink);
    enter(outputLink);
    assert.deepEqual(request!.hovered, request!.scene.interaction.selectionByElementId.get(output.id));
    assert.deepEqual(request!.scene.interaction.hoverElementIdsBySelection.get(output.id), [output.id]);
    panel.setSnapshot(snapshot);
    assert.equal(request!.hovered, undefined);
    panel.destroy();
    testWindow.close();
});

test('resource selection exposes exact access facts and distinct output roots without edge details', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    const graphView = (panel as unknown as { graphView: GraphViewState }).graphView;
    let request: GraphRenderRequest;
    graphView.renderer = {
        render: (next) => { request = next; }, destroy: () => undefined,
        resize: () => undefined, fit: () => assert.fail('Selection must not fit'), relayout: () => undefined,
    };
    const snapshot = createFrameFlowVisualFixture();
    panel.setSnapshot(snapshot);
    const history = snapshot.graph.resources.find((resource) => resource.label === 'Temporal history')!;
    const edge = request!.scene.edges.find((edge) => edge.resourceId === history.id)!;
    const selected = request!.scene.interaction.selectionByElementId.get(edge.id)!;
    request!.onSelect(selected);
    const tabs = panel.dom.querySelector('.zenfg-inspector-inspector-tabs')!;
    const content = panel.dom.querySelector('.zenfg-inspector-inspector-content')!;
    tabButton(tabs, 'Relations').click();
    const accessLink = tabButton(content, 'Update history 0');
    const facts = accessLink.closest('.zenfg-inspector-relation-entry')!.querySelector('span')!.textContent!;
    assert.match(facts, /write.*overwrite.*produces a value.*bytes 0–8/);
    accessLink.click();
    const historyLink = tabButton(content, 'Temporal history');
    assert.equal(historyLink.closest('.zenfg-inspector-relation-entry')!.querySelector('span')!.textContent, facts);
    historyLink.click();
    assert.equal(tabButton(tabs, 'Summary').getAttribute('aria-selected'), 'true');
    const expectedRoots = ['persistent-state · bytes 0–32', 'debug-capture · bytes 16–32'];
    for (const label of expectedRoots) {
        tabButton(tabs, 'Relations').click();
        assert.match(content.textContent!, /Output roots 2/);
        assert.doesNotMatch(content.textContent!, /Flow relationships|View resource/);
        tabButton(content, label).click();
        assert.equal(request!.selected?.kind, 'root');
        tabButton(tabs, 'Summary').click();
        assert.match(content.textContent!, /Initial contents/);
        tabButton(content, 'View resource · Temporal history').click();
        assert.deepEqual(request!.selected, selected);
        assert.equal(tabButton(tabs, 'Summary').getAttribute('aria-selected'), 'true');
    }
    tabButton(tabs, 'Relations').click();
    const workbenchTabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs')!;
    tabButton(workbenchTabs, 'Resources').click();
    tabButton(panel.dom.querySelector('.zenfg-inspector-resources-view')!, 'Temporal history').click();
    assert.equal(tabButton(tabs, 'Relations').getAttribute('aria-selected'), 'true');
    tabButton(workbenchTabs, 'Graph').click();
    assert.deepEqual(request!.selected, selected);
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
	assert.equal(panel.dom.querySelector('.zenfg-inspector-inspector > header strong')?.textContent, 'Inspector');
	assert.equal(panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-open-inspector')?.hidden, true);

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
		root.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-passes-view .zenfg-inspector-relation-button'),
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

function downloadAction(root: ParentNode): HTMLButtonElement {
	const action = root.querySelector<HTMLButtonElement>('.zenfg-inspector-download-action');
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
