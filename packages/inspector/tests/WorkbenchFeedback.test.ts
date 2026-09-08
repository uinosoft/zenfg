import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseFrameGraphSnapshot, type FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { FrameGraphInspector } from '../src/FrameGraphInspector.ts';

function installDom(): Window {
	const window = new Window({ url: 'http://localhost/' });
	Reflect.set(globalThis, 'window', window);
	Reflect.set(globalThis, 'document', window.document);
	Reflect.set(globalThis, 'navigator', window.navigator);
	Reflect.set(globalThis, 'Event', window.Event);
	Reflect.set(globalThis, 'HTMLElement', window.HTMLElement);
	return window;
}

function element<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
	const found = root.querySelector<T>(selector);
	assert.ok(found, `Missing ${selector}`);
	return found;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === text);
	assert.ok(found, `Missing button ${text}`);
	return found;
}

function snapshot(): FrameGraphSnapshot {
	return JSON.parse(readFileSync(resolve('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json'), 'utf8')) as FrameGraphSnapshot;
}

test('expanded import feedback includes every validation error and preserves the previous snapshot', async () => {
	const window = installDom();
	const panel = new FrameGraphInspector({ maxGraphElements: 1 });
	document.body.append(panel.dom);
	try {
		panel.setSnapshot(snapshot());
		const previous = panel.getSnapshot();
		const tabs = element(panel.dom, '.zenfg-inspector-workbench-tabs');
		button(tabs, 'Resources').click();
		button(element(panel.dom, '.zenfg-inspector-resources-view'), 'scene-color').click();
		const invalid = readFileSync(resolve('packages/snapshot/conformance/invalid/semantic-missing-references.json'), 'utf8');
		const decoded = parseFrameGraphSnapshot(invalid);
		assert.equal(decoded.ok, false);
		if (decoded.ok) assert.fail('The fixture must produce validation errors.');
		assert.ok(decoded.issues.length > 3);
		await panel.importSnapshot(new window.File([invalid], 'invalid.fgsnapshot.json', { type: 'application/json' }) as unknown as File);
		const feedback = element<HTMLDetailsElement>(panel.dom, '.zenfg-inspector-feedback');
		assert.equal(feedback.hidden, false);
		// Expanding this native details element exposes the complete text.
		feedback.open = true;
		const messages = element(feedback, '.zenfg-inspector-command-status').textContent!;
		for (const issue of decoded.issues) assert.ok(messages.includes(`${issue.path || '/'}: ${issue.message}`), `Missing validation issue ${issue.path}`);
		assert.equal(messages.split('\n').length, decoded.issues.length);
		assert.strictEqual(panel.getSnapshot(), previous);
		assert.equal(button(tabs, 'Resources').getAttribute('aria-selected'), 'true');
		assert.equal(element(panel.dom, '.zenfg-inspector-inspector > header strong').textContent, 'scene-color');
	} finally { panel.destroy(); window.close(); }
});

test('failed Graph reveal exits a drawer into actionable feedback and successful recovery clears it', () => {
	const window = installDom();
	const panel = new FrameGraphInspector({ maxGraphElements: 1 });
	document.body.append(panel.dom);
	try {
		const workspace = element(panel.dom, '.zenfg-inspector-workspace');
		workspace.getBoundingClientRect = () => ({ width: 800, height: 600, x: 0, y: 0, left: 0, right: 800, top: 0, bottom: 600, toJSON: () => ({}) });
		panel.setSnapshot(snapshot());
		const tabs = element(panel.dom, '.zenfg-inspector-workbench-tabs');
		button(tabs, 'Memory').click();
		const unused = button(element(panel.dom, '.zenfg-inspector-memory-view'), 'unused-data');
		unused.focus(); unused.click();
		const aside = element(panel.dom, '.zenfg-inspector-inspector');
		assert.equal(aside.getAttribute('aria-modal'), 'true');
		button(aside, 'Locate in Graph').click();
		const feedback = element<HTMLDetailsElement>(panel.dom, '.zenfg-inspector-feedback');
		assert.equal(aside.hidden, true);
		assert.equal(feedback.hidden, false);
		assert.equal(feedback.open, true);
		assert.equal(feedback.inert, false);
		assert.equal(feedback.closest('[inert]'), null);
		const recovery = button(feedback, 'Show in resources');
		assert.strictEqual(document.activeElement, recovery);
		recovery.click();
		const resourcesTab = button(tabs, 'Resources');
		assert.equal(resourcesTab.getAttribute('aria-selected'), 'true');
		assert.equal(feedback.hidden, true);
		assert.equal(aside.hidden, true);
		assert.strictEqual(document.activeElement, resourcesTab);
		assert.equal(element(panel.dom, '.zenfg-inspector-main').inert, false);
		assert.ok(button(element(panel.dom, '.zenfg-inspector-resources-view'), 'unused-data').closest('tr')?.classList.contains('selected'));
	} finally { panel.destroy(); window.close(); }
});
