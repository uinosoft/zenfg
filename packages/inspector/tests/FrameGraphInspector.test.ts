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

test('starts with declarations hidden unless explicitly enabled through construction or mounting', () => {
	const testWindow = installDom();
	try {
		for (const mounted of [false, true]) {
			for (const showResourceDeclarations of [undefined, false, true]) {
				const options = showResourceDeclarations === undefined ? {} : { showResourceDeclarations };
				const panel = mounted ? mountFrameGraphInspector(document.body, options) : new FrameGraphInspector(options);
				try {
					const expected = showResourceDeclarations ?? false;
					const graph = (panel as unknown as { graphView: GraphViewState }).graphView;
					const control = tabButton(graph.toolbar, 'Declarations');
					assert.equal(control.getAttribute('aria-pressed'), String(expected));
					assert.equal(panel.dom.isConnected, mounted);
					let request: GraphRenderRequest | undefined;
					graph.renderer = {
						render: (next) => { request = next; }, destroy: () => undefined,
						resize: () => undefined, fit: () => undefined, relayout: () => undefined,
					};
					panel.setSnapshot(toSnapshot(createGroupedCapture()));
					assert.equal(control.getAttribute('aria-pressed'), String(expected));
					assert.ok(request);
					assert.equal(request.scene.nodes.some((node) => node.kind === 'resource'), expected);
					assert.equal(request.scene.edges.some((edge) => edge.relations.some((relation) => relation.role === 'declaration')), expected);
					assert.ok(request.scene.nodes.some((node) => node.kind === 'pass'));
					assert.ok(request.scene.edges.some((edge) => edge.relations.some((relation) => relation.role === 'value')));
					assert.equal(graph.legend?.textContent?.includes('Declaration'), expected);
				} finally {
					panel.destroy();
				}
			}
		}
	} finally {
		testWindow.close();
	}
});

test('preserves the declaration toggle across programmatic, imported and live snapshots without filtering snapshot data', async () => {
	const testWindow = installDom();
	const panel = new FrameGraphInspector();
	try {
		const graph = (panel as unknown as { graphView: GraphViewState }).graphView;
		let request: GraphRenderRequest | undefined;
		graph.renderer = {
			render: (next) => { request = next; }, destroy: () => undefined,
			resize: () => undefined, fit: () => undefined, relayout: () => undefined,
		};
		const source = toSnapshot(createGroupedCapture());
		panel.setSnapshot(source);
		const control = tabButton(graph.toolbar, 'Declarations');
		const assertDeclarations = (shown: boolean) => {
			assert.equal(control.getAttribute('aria-pressed'), String(shown));
			assert.equal(request?.scene.nodes.some((node) => node.kind === 'resource'), shown);
			assert.equal(graph.legend?.textContent?.includes('Declaration'), shown);
		};
		assertDeclarations(false);
		control.click();
		assertDeclarations(true);
		assert.deepEqual(panel.getSnapshot(), source);

		const nextCapture = createGroupedCapture();
		nextCapture.gpuTiming.frameIndex = 12;
		const next = toSnapshot(nextCapture);
		panel.setSnapshot(next);
		assertDeclarations(true);
		assert.deepEqual(panel.getSnapshot(), next);
		await panel.importSnapshot(new testWindow.File([JSON.stringify(source)], 'declarations.fgsnapshot.json') as unknown as File);
		assertDeclarations(true);
		assert.deepEqual(panel.getSnapshot(), source);
		panel.setCaptureSnapshotProvider(async () => next);
		await panel.captureSnapshot();
		assertDeclarations(true);
		assert.deepEqual(panel.getSnapshot(), next);

		control.click();
		assertDeclarations(false);
		assert.deepEqual(panel.getSnapshot(), next);
		const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs')!;
		tabButton(tabs, 'Resources').click();
		assert.deepEqual(Array.from(panel.dom.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-resources-view .zenfg-inspector-relation-button'),
			(button) => button.textContent), ['postfx-color', 'scene-color', 'unused-buffer']);
		tabButton(tabs, 'Passes').click();
		const passList = panel.dom.querySelector('.zenfg-inspector-passes-view .zenfg-inspector-subview')!;
		assert.deepEqual(Array.from(passList.querySelectorAll<HTMLButtonElement>('.zenfg-inspector-relation-button'),
			(button) => button.textContent), ['scene', 'bloom', 'present', 'unused']);
		tabButton(tabs, 'Graph').click();
		await panel.captureSnapshot();
		assertDeclarations(false);
		assert.deepEqual(panel.getSnapshot(), next);
	} finally {
		panel.destroy();
		testWindow.close();
	}
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
	assert.match(css, /--fgd-canvas: var\(--zfgi-canvas, #24283b\)/);
	assert.match(css, /--fgd-accent: var\(--zfgi-accent, var\(--zenfg-inspector-accent, #7aa2f7\)\)/);
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
	assert.deepEqual(JSON.parse(copiedText), structuredClone(toSnapshot(capture)));

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
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /legacy-v0 → canonical v1\.2/);
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
	assert.match(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent ?? '', /legacy-v0 → canonical v1\.2/);
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
	assert.match(status?.textContent ?? '', /Imported Legacy Candidate V1 and migrated it to ZenFG Snapshot 1\.2/);
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

test('renders graph controls in a dedicated toolbar and a fixed canvas legend trigger', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    panel.setSnapshot(toSnapshot(createGroupedCapture()));

    const graphPanel = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph-view');
    const toolbar = graphPanel?.querySelector<HTMLElement>('.zenfg-inspector-graph-toolbar');
    const graph = graphPanel?.querySelector<HTMLElement>('.zenfg-inspector-graph');
    const viewport = graphPanel?.querySelector<HTMLElement>('.zenfg-inspector-graph-viewport');
    const trigger = viewport?.querySelector<HTMLButtonElement>('.zenfg-inspector-graph-legend-toggle');
    const popover = viewport?.querySelector<HTMLElement>('.zenfg-inspector-graph-legend-popover');
    const legend = popover?.querySelector<HTMLElement>('.zenfg-inspector-graph-legend');
    assert.ok(graphPanel && toolbar && graph && viewport && trigger && popover && legend);
    assert.equal(toolbar.parentElement, viewport);
    assert.equal(graphPanel.lastElementChild, viewport);
    assert.equal(viewport.firstElementChild, graph);
    assert.equal(popover.hidden, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.getAttribute('aria-controls'), popover.id);
    assert.equal(toolbar.getAttribute('role'), 'toolbar');
    assert.match(legend.textContent, /Render/);
    assert.match(legend.textContent, /Group/);
	assert.equal(toolbar.querySelector('[aria-label="Relayout graph"]'), null);
	assert.equal(toolbar.querySelector('[aria-label="Fit graph to view"]'), null);
	const zoomControls = viewport.querySelector<HTMLElement>('.zenfg-inspector-graph-zoom-controls');
	assert.ok(zoomControls);
	assert.equal(zoomControls.parentElement, viewport);
	assert.ok(zoomControls.querySelector('[aria-label="Fit graph to view"] svg'));

    panel.destroy();
    testWindow.close();
});

test('legend supports stable toggling, scrolling focus and Escape without reaching outer handlers', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    document.body.append(panel.dom);
    const snapshot = toSnapshot(createGroupedCapture());
    panel.setSnapshot(snapshot);
    const trigger = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-graph-legend-toggle')!;
    const popover = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph-legend-popover')!;
    const content = popover.querySelector<HTMLElement>('.zenfg-inspector-graph-legend')!;
    const close = popover.querySelector<HTMLButtonElement>('[aria-label="Close legend"]')!;
    trigger.focus(); trigger.click();
    assert.equal(popover.hidden, false);
    assert.equal(document.activeElement, trigger, 'opening leaves focus on the stable toggle');
    assert.equal(content.tabIndex, 0, 'keyboard users can focus and scroll the legend');
    panel.setSnapshot(snapshot);
    assert.equal(popover.hidden, false, 'capture refresh keeps the open legend');
    assert.equal(panel.dom.querySelector('.zenfg-inspector-graph-legend-toggle'), trigger);
    let outerEscapes = 0;
    panel.dom.addEventListener('keydown', (event) => { if (event.key === 'Escape') outerEscapes++; });
    content.focus();
    const escape = new testWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    content.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(outerEscapes, 0);
    assert.equal(popover.hidden, true);
    assert.equal(document.activeElement, trigger);
    trigger.click(); close.click();
    assert.equal(popover.hidden, true);
    assert.equal(document.activeElement, trigger);
    trigger.click(); trigger.click();
    assert.equal(popover.hidden, true, 'same trigger closes the panel');
    panel.destroy(); testWindow.close();
});

test('legend dismisses outside without taking focus, closes on navigation and unwires on destruction', () => {
    const testWindow = installDom();
    const panel = new FrameGraphInspector();
    document.body.append(panel.dom);
    panel.setSnapshot(toSnapshot(createGroupedCapture()));
    const trigger = panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-graph-legend-toggle')!;
    const popover = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph-legend-popover')!;
    const zoom = panel.dom.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!;
    trigger.focus(); trigger.click(); zoom.focus();
    assert.equal(popover.hidden, true);
    assert.equal(document.activeElement, zoom);
    trigger.click(); panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph')!.click();
    assert.equal(popover.hidden, true);
    trigger.click(); tabButton(panel.dom, 'Passes').click();
    assert.equal(popover.hidden, true);
    tabButton(panel.dom, 'Graph').click(); trigger.click();
    assert.equal(popover.hidden, false);
    panel.destroy();
    document.body.click();
    assert.equal(popover.hidden, false, 'destroy removed the outside-click listener');
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
    const panel = new FrameGraphInspector({ showResourceDeclarations: true });
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
	const displayPopover = button.closest<HTMLElement>('.zenfg-inspector-graph-display-popover');
	if (displayPopover?.hidden) root.querySelector<HTMLButtonElement>('[aria-label="Display"]')?.click();
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

test('graph Display options preserve toggles and close with Escape or outside clicks', () => {
	const testWindow = installDom();
	const panel = mountFrameGraphInspector(document.body);
	try {
		panel.setSnapshot(toSnapshot(createGroupedCapture()));
		const toolbar = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-graph-toolbar')!;
		const display = toolbar.querySelector<HTMLButtonElement>('[aria-label="Display"]')!;
		const popover = toolbar.querySelector<HTMLElement>('.zenfg-inspector-graph-display-popover')!;
		const declarations = tabButton(popover, 'Declarations');
		assert.equal(popover.hidden, true);
		display.click();
		assert.equal(popover.hidden, false);
		assert.equal(display.getAttribute('aria-expanded'), 'true');
		assert.equal(document.activeElement, declarations);
		declarations.click();
		assert.equal(declarations.getAttribute('aria-pressed'), 'true');
		assert.equal(popover.hidden, false, 'a display toggle keeps the options open');
		declarations.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
		assert.equal(popover.hidden, true);
		assert.equal(display.getAttribute('aria-expanded'), 'false');
		assert.equal(document.activeElement, display);
		display.click();
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();
		outside.click();
		assert.equal(popover.hidden, true);
		assert.equal(document.activeElement, outside, 'outside dismissal preserves the clicked target focus');
		assert.equal(declarations.getAttribute('aria-pressed'), 'true');
		panel.setSnapshot(toSnapshot(createEmptyCapture()));
		assert.equal(tabButton(popover, 'Groups').hidden, true);
		assert.equal(tabButton(popover, 'Collapse All').hidden, true);
	} finally { panel.destroy(); testWindow.close(); }
});

test('keyboard focus from Display to Search closes only the active graph popover', () => {
	const testWindow = installDom();
	const panel = mountFrameGraphInspector(document.body);
	try {
		const graph = (panel as unknown as { graphView: GraphViewState }).graphView;
		let request: GraphRenderRequest | undefined;
		graph.renderer = {
			render: (next) => { request = next; }, destroy: () => undefined, resize: () => undefined,
			fit: () => undefined, relayout: () => undefined,
		};
		panel.setSnapshot(toSnapshot(createGroupedCapture()));
		const group = request!.scene.nodes.find((node) => node.kind === 'group')!;
		request!.onSelect(request!.scene.interaction.selectionByElementId.get(group.id)!);
		const inspector = panel.dom.querySelector<HTMLElement>('.zenfg-inspector-inspector')!;
		assert.equal(inspector.hidden, false);
		const display = graph.toolbar.querySelector<HTMLButtonElement>('[aria-label="Display"]')!;
		const displayPopover = graph.toolbar.querySelector<HTMLElement>('.zenfg-inspector-graph-display-popover')!;
		const search = graph.toolbar.querySelector<HTMLButtonElement>('[aria-label="Search"]')!;
		const searchPopover = graph.toolbar.querySelector<HTMLElement>('.zenfg-inspector-graph-search-popover')!;
		const searchInput = searchPopover.querySelector<HTMLInputElement>('input')!;
		display.click();
		assert.equal(displayPopover.hidden, false);
		search.focus();
		assert.equal(displayPopover.hidden, true, 'keyboard focus leaving Display dismisses its options');
		assert.equal(display.getAttribute('aria-expanded'), 'false');
		assert.equal(document.activeElement, search);
		search.click();
		assert.equal(searchPopover.hidden, false);
		assert.equal(document.activeElement, searchInput);
		searchInput.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
		assert.equal(searchPopover.hidden, true);
		assert.equal(displayPopover.hidden, true);
		assert.equal(document.activeElement, search);
		assert.equal(inspector.hidden, false, 'closing Search leaves the selected details open');
	} finally { panel.destroy(); testWindow.close(); }
});

test('graph focus and viewport actions keep selection and projection independent', () => {
	const testWindow = installDom();
	const panel = mountFrameGraphInspector(document.body);
	try {
		const graph = (panel as unknown as { graphView: GraphViewState }).graphView;
		let request: GraphRenderRequest | undefined;
		const zoomFactors: number[] = [];
		let resets = 0;
		let fits = 0;
		const fittedSelections: unknown[] = [];
		graph.renderer = {
			render: (next) => { request = next; }, destroy: () => undefined, resize: () => undefined,
			fit: () => { fits++; }, relayout: () => undefined,
			zoomBy: (factor) => { zoomFactors.push(factor); }, resetZoom: () => { resets++; },
			fitSelection: (selection) => { fittedSelections.push(selection); },
		};
		panel.setSnapshot(toSnapshot(createGroupedCapture()));
		const focus = graph.toolbar.querySelector<HTMLButtonElement>('[aria-label="Focus relations"]')!;
		const viewport = graph.viewportControls!;
		assert.equal(focus.disabled, true);
		assert.equal(viewport.querySelector<HTMLButtonElement>('[aria-label="Fit selection to view"]')!.disabled, true);
		const group = request!.scene.nodes.find((node) => node.kind === 'group')!;
		assert.equal(group.kind, 'group');
		const selected = request!.scene.interaction.selectionByElementId.get(group.id)!;
		request!.onSelect(selected);
		assert.equal(focus.disabled, false);
		focus.click();
		assert.equal(graph.focusRelations, true);
		assert.equal(request!.focusRelations, true);
		assert.equal(request!.fit, false);
		assert.deepEqual(request!.selected, selected);
		assert.equal(graph.expandedGroupPaths.size, 0);
		assert.equal(focus.getAttribute('aria-pressed'), 'true');
		focus.click();
		assert.equal(request!.focusRelations, false);
		assert.equal(focus.getAttribute('aria-pressed'), 'false');
		const expand = tabButton(graph.toolbar, 'Expand group');
		assert.equal(expand.hidden, false);
		expand.click();
		assert.equal(graph.expandedGroupPaths.size, 1);
		assert.equal(tabButton(graph.toolbar, 'Collapse group').hidden, false);
		tabButton(graph.toolbar, 'Collapse group').click();
		assert.equal(graph.expandedGroupPaths.size, 0);
		viewport.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click();
		viewport.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
		viewport.querySelector<HTMLButtonElement>('[aria-label="Reset graph zoom to 100%"]')!.click();
		viewport.querySelector<HTMLButtonElement>('[aria-label="Fit selection to view"]')!.click();
		viewport.querySelector<HTMLButtonElement>('[aria-label="Fit graph to view"]')!.click();
		assert.deepEqual(zoomFactors, [1 / 1.2, 1.2]);
		assert.equal(resets, 1);
		assert.equal(fits, 1);
		assert.deepEqual(fittedSelections, [selected]);
		graph.onViewportChange!(1.58);
		assert.equal(viewport.querySelector('output')!.textContent, '158%');
		assert.deepEqual(request!.selected, selected);
		assert.equal(graph.expandedGroupPaths.size, 0);
	} finally { panel.destroy(); testWindow.close(); }
});


test('capture always requests both timing families without a mode selector', async () => {
 const win=installDom();
 const modes:string[]=[];let finish!:(value:ReturnType<typeof toSnapshot>)=>void;
 const panel=new FrameGraphInspector({captureSnapshot:request=>{modes.push(request.timing);return new Promise(resolve=>{finish=resolve;});}});
 document.body.append(panel.dom);
 assert.equal(panel.dom.querySelector('select[aria-label="Capture timing"]'),null);
 const button=panel.dom.querySelector<HTMLButtonElement>('.zenfg-inspector-capture-action')!;
 const capturing=panel.captureSnapshot();assert.equal(button.disabled,true);assert.deepEqual(modes,['both']);
 await panel.captureSnapshot();assert.deepEqual(modes,['both']);
 finish(toSnapshot(createEmptyCapture()));await capturing;assert.equal(button.disabled,false);
 panel.setCaptureSnapshotProvider(undefined);assert.equal(button.hidden,true);
 panel.destroy();win.close();
});

test('replacing a pending provider ignores its result, error, and cleanup in either completion order', async () => {
	const testWindow = installDom();
	try {
		for (const oldFirst of [true, false]) {
			for (const oldFails of [true, false]) {
				let finishA!: (snapshot: ReturnType<typeof toSnapshot>) => void;
				let failA!: (error: Error) => void;
				let finishB!: (snapshot: ReturnType<typeof toSnapshot>) => void;
				let callsB = 0;
				const panel = new FrameGraphInspector({
					captureSnapshot: () => new Promise((resolve, reject) => { finishA = resolve; failA = reject; }),
				});
				try {
					const pendingA = panel.captureSnapshot();
					panel.setCaptureSnapshotProvider(() => {
						callsB++;
						return new Promise((resolve) => { finishB = resolve; });
					});
					assert.equal(callsB, 1);
					const settleA = () => oldFails ? failA(new Error('obsolete provider failure')) : finishA(toSnapshot(createEmptyCapture()));
					if (oldFirst) {
						settleA();
						await pendingA;
						assert.equal(panel.getSnapshot(), undefined);
						assert.equal(captureAction(panel.dom).disabled, true);
						assert.equal(captureAction(panel.dom).textContent, 'Capturing…');
						await panel.captureSnapshot();
						assert.equal(callsB, 1, 'obsolete cleanup must not release the new capture lock');
						finishB(toSnapshot(createGroupedCapture()));
						await flushAsync();
					} else {
						finishB(toSnapshot(createGroupedCapture()));
						await flushAsync();
						settleA();
						await pendingA;
					}
					assert.equal(panel.getSnapshot()?.capture.frameIndex, 2);
					assert.equal(captureAction(panel.dom).disabled, false);
					assert.doesNotMatch(panel.dom.textContent ?? '', /obsolete provider failure/);
				} finally {
					panel.destroy();
				}
			}
		}
	} finally {
		testWindow.close();
	}
});

test('removing a pending provider leaves an empty workbench and ignores late success or failure', async () => {
	const testWindow = installDom();
	try {
		for (const fails of [false, true]) {
			let finish!: (snapshot: ReturnType<typeof toSnapshot>) => void;
			let fail!: (error: Error) => void;
			const panel = new FrameGraphInspector({
				captureSnapshot: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }),
			});
			try {
				const pending = panel.captureSnapshot();
				panel.setCaptureSnapshotProvider(undefined);
				assert.equal(captureAction(panel.dom).hidden, true);
				assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'empty');
				if (fails) fail(new Error('removed provider failure'));
				else finish(toSnapshot(createEmptyCapture()));
				await pending;
				assert.equal(panel.getSnapshot(), undefined);
				assert.doesNotMatch(panel.dom.textContent ?? '', /removed provider failure/);
				assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'empty');
			} finally {
				panel.destroy();
			}
		}
	} finally {
		testWindow.close();
	}
});

test('setting the same provider preserves its pending capture and setting after destroy does nothing', async () => {
	const testWindow = installDom();
	let finish!: (snapshot: ReturnType<typeof toSnapshot>) => void;
	let calls = 0;
	const provider = () => {
		calls++;
		return new Promise<ReturnType<typeof toSnapshot>>((resolve) => { finish = resolve; });
	};
	const panel = new FrameGraphInspector({ captureSnapshot: provider });
	try {
		const pending = panel.captureSnapshot();
		panel.setCaptureSnapshotProvider(provider);
		await flushAsync();
		assert.equal(calls, 1);
		finish(toSnapshot(createEmptyCapture()));
		await pending;
		assert.equal(panel.getSnapshot()?.capture.frameIndex, 1);
		panel.destroy();
		panel.setCaptureSnapshotProvider(() => { assert.fail('destroyed provider must not run'); });
	} finally {
		panel.destroy();
		testWindow.close();
	}
});

test('replacing a pending provider preserves the displayed snapshot until the next explicit capture', async () => {
	const testWindow = installDom();
	let finishA!: (snapshot: ReturnType<typeof toSnapshot>) => void;
	let callsB = 0;
	const panel = new FrameGraphInspector({
		captureSnapshot: () => new Promise((resolve) => { finishA = resolve; }),
	});
	try {
		panel.setSnapshot(toSnapshot(createGroupedCapture()));
		const current = panel.getSnapshot();
		const pending = panel.captureSnapshot();
		panel.setCaptureSnapshotProvider(() => { callsB++; return toSnapshot(createEmptyCapture()); });
		finishA(toSnapshot(createEmptyCapture()));
		await pending;
		assert.equal(panel.getSnapshot(), current);
		assert.equal(callsB, 0);
		assert.equal(captureAction(panel.dom).disabled, false);
		await panel.captureSnapshot();
		assert.equal(callsB, 1);
		assert.equal(panel.getSnapshot()?.capture.frameIndex, 1);
	} finally {
		panel.destroy();
		testWindow.close();
	}
});

test('provider replacement or removal does not invalidate a pending file import', async () => {
	const testWindow = installDom();
	try {
		for (const remove of [false, true]) {
			let finishImport!: (text: string) => void;
			let calls = 0;
			const panel = new FrameGraphInspector({ captureSnapshot: () => { calls++; return undefined; } });
			try {
				const pending = panel.importSnapshot({
					name: 'pending.fgsnapshot.json',
					size: 1,
					text: () => new Promise<string>((resolve) => { finishImport = resolve; }),
				} as File);
				const before = panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent;
				panel.setCaptureSnapshotProvider(remove ? undefined : () => { calls++; return undefined; });
				assert.equal(panel.dom.querySelector('.zenfg-inspector-workbench-empty')?.textContent, before);
				finishImport(JSON.stringify(toSnapshot(createGroupedCapture())));
				await pending;
				assert.equal(panel.getSnapshot()?.capture.frameIndex, 2);
				assert.equal(calls, 0);
			} finally {
				panel.destroy();
			}
		}
	} finally {
		testWindow.close();
	}
});

test('migration summaries and import feedback use the real source and canonical version', async () => {
	const testWindow = installDom();
	try {
		for (const [file, source, label] of [
			['packages/snapshot/tests/fixtures/snapshot-1.1.json', 'snapshot-v1.1', 'Snapshot 1.1'],
			['packages/snapshot/fixtures/legacy-v0.json', 'legacy-v0', 'Legacy V0'],
			['packages/snapshot/fixtures/legacy-candidate-v1-canonical.json', 'legacy-candidate-v1', 'Legacy Candidate V1'],
		] as const) {
			const panel = new FrameGraphInspector();
			try {
				const text = JSON.stringify(readWorkspaceJson(file));
				await panel.importSnapshot(new testWindow.File([text], 'historical.json') as unknown as File);
				const snapshot = panel.getSnapshot();
				assert.ok(snapshot);
				const version = snapshot.version.major + '.' + snapshot.version.minor;
				assert.equal(version, '1.2');
				const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs');
				assert.ok(tabs);
				tabButton(tabs, 'Overview').click();
				const summary = panel.dom.querySelector('.zenfg-inspector-capture-summary');
				assert.ok(summary?.textContent?.includes(source + ' → canonical v' + version));
				const status = panel.dom.querySelector('.zenfg-inspector-command-status');
				assert.equal(status?.textContent, 'Imported ' + label + ' and migrated it to ZenFG Snapshot ' + version + '.');
				await panel.importSnapshot(new testWindow.File([JSON.stringify(snapshot)], 'canonical.json') as unknown as File);
				assert.equal(status?.textContent, 'Imported Snapshot ' + version + ' with ' + label + ' migration provenance.');
				assert.ok(summary?.textContent?.includes(source + ' → canonical v' + version));
			} finally {
				panel.destroy();
			}
		}
	} finally {
		testWindow.close();
	}
});

test('import feedback distinguishes Snapshot 1.1 input from its older migration provenance', async () => {
	const testWindow = installDom();
	try {
		for (const [source, label] of [['legacy-v0', 'Legacy V0'], ['legacy-candidate-v1', 'Legacy Candidate V1']] as const) {
			const panel = new FrameGraphInspector();
			try {
				const input = readWorkspaceJson('packages/snapshot/tests/fixtures/snapshot-1.1.json') as {
					capture: { migration?: { sourceFormat: string; unavailableFacts: string[] } };
				};
				input.capture.migration = { sourceFormat: source, unavailableFacts: [] };
				await panel.importSnapshot(new testWindow.File([JSON.stringify(input)], 'snapshot-1.1.json') as unknown as File);
				const snapshot = panel.getSnapshot();
				assert.ok(snapshot);
				assert.equal(snapshot.capture.migration?.sourceFormat, source);
				const status = panel.dom.querySelector('.zenfg-inspector-command-status');
				assert.equal(status?.textContent, 'Imported Snapshot 1.1 and migrated it to ZenFG Snapshot 1.2.');
				const tabs = panel.dom.querySelector('.zenfg-inspector-workbench-tabs');
				assert.ok(tabs);
				tabButton(tabs, 'Overview').click();
				assert.ok(panel.dom.querySelector('.zenfg-inspector-capture-summary')?.textContent?.includes(source + ' → canonical v1.2'));
				await panel.importSnapshot(new testWindow.File([JSON.stringify(snapshot)], 'canonical.json') as unknown as File);
				assert.equal(status?.textContent, 'Imported Snapshot 1.2 with ' + label + ' migration provenance.');
			} finally {
				panel.destroy();
			}
		}
	} finally {
		testWindow.close();
	}
});
