import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { DiagnosticsView } from '../src/panelDiagnosticsView.ts';
import type { WorkbenchCallbacks } from '../src/panelWorkbenchHelpers.ts';

function setup(t: test.TestContext): { view: DiagnosticsView; snapshot: FrameGraphSnapshot } {
	const win = new Window();
	Reflect.set(globalThis, 'document', win.document);
	Reflect.set(globalThis, 'window', win);
	Reflect.set(globalThis, 'Event', win.Event);
	t.after(() => win.close());
	const handlers: WorkbenchCallbacks = {
		onSelect: () => {}, onHover: () => {}, onGroupToggle: () => {}, isGroupExpanded: () => false,
	};
	const snapshot = JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
	const view = new DiagnosticsView(handlers, 'diagnostics');
	document.body.appendChild(view.root);
	return { view, snapshot };
}

test('Diagnostic severity counts stay snapshot-wide while search filters messages and retains compilation details', (t) => {
	const { view, snapshot } = setup(t);
	const capture: FrameGraphSnapshot = { ...snapshot, diagnostics: [
		{ severity: 'error', code: 'repeated', message: 'Error one' },
		{ severity: 'warning', code: 'repeated', message: 'Warning one' },
		{ severity: 'warning', code: 'repeated', message: 'Warning two' },
		{ severity: 'info', code: 'info', message: 'Info one' },
	] };
	view.setSnapshot(createDebugViewModel(capture));
	const warning = view.root.querySelector<HTMLButtonElement>('button[data-severity="warning"]')!;
	assert.equal(warning.textContent, 'Warning · 2');
	warning.focus(); warning.click();
	assert.equal(warning.getAttribute('aria-pressed'), 'true');
	assert.equal(document.activeElement, warning, 'filter button survives rendering');
	const search = view.root.querySelector<HTMLInputElement>('input[type="search"]')!;
	search.value = 'two'; search.dispatchEvent(new Event('input'));
	assert.equal(view.root.querySelectorAll('.zenfg-inspector-diagnostic-message').length, 1);
	assert.equal(warning.textContent, 'Warning · 2');
	assert.equal(view.root.querySelector('[data-severity="all"]')!.textContent, 'All · 4');
	assert.equal(view.root.querySelector('.zenfg-inspector-result-count')!.textContent, '1 / 4 diagnostics');
	assert.equal(view.root.querySelectorAll('.zenfg-inspector-diagnostic-compilation > details').length, 3);
	view.setSnapshot(createDebugViewModel({ ...capture, capture: { ...capture.capture, frameIndex: capture.capture.frameIndex + 1 } }));
	assert.equal(warning.getAttribute('aria-pressed'), 'true');
	assert.equal(search.value, 'two');
	assert.equal(view.root.querySelectorAll('.zenfg-inspector-diagnostic-message').length, 1);
});

test('Diagnostic compile folds survive refresh and explicit reveal expands the target without claiming health', (t) => {
	const { view, snapshot } = setup(t);
	view.setSnapshot(createDebugViewModel({ ...snapshot, diagnostics: [] }));
	const roots = view.root.querySelector<HTMLDetailsElement>('[data-section="roots"]')!;
	roots.open = true;
	view.setSnapshot(createDebugViewModel({ ...snapshot, diagnostics: [] }));
	assert.equal(view.root.querySelector<HTMLDetailsElement>('[data-section="roots"]')!.open, true);
	view.reveal({ kind: 'segment', index: 1 });
	assert.equal(view.root.querySelector<HTMLDetailsElement>('[data-section="segments"]')!.open, true);
	assert.equal(view.root.querySelector<HTMLDetailsElement>('[data-section="segment:1"]')!.open, true);
	assert.match(view.root.textContent!, /No diagnostic messages in this snapshot/);
	assert.doesNotMatch(view.root.textContent!, /healthy|success/i);
});
