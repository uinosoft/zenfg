import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

import { wireSnapshotFileInputs } from '../src/fileInputs.ts';

test('routes native file selection and resets the input', () => {
	const testWindow = new Window();
	const input = testWindow.document.createElement('input') as unknown as HTMLInputElement;
	input.type = 'text';
	const dropZone = testWindow.document.createElement('main') as unknown as HTMLElement;
	const fixture = new testWindow.File(['{}'], 'fixture.fgsnapshot.json', { type: 'application/json' }) as unknown as File;
	Object.defineProperty(input, 'files', { configurable: true, value: [fixture] });
	input.value = 'C:\\fakepath\\fixture.fgsnapshot.json';
	const opened: File[] = [];
	const cleanup = wireSnapshotFileInputs(input, dropZone, (file) => {
		if (file) opened.push(file);
	});

	input.dispatchEvent(new testWindow.Event('change') as unknown as Event);
	assert.deepEqual(opened, [fixture]);
	assert.equal(input.value, '');

	cleanup();
	testWindow.close();
});

test('accepts a dropped file, exposes drag feedback, and can be unwired', () => {
	const testWindow = new Window();
	const input = testWindow.document.createElement('input') as unknown as HTMLInputElement;
	const dropZone = testWindow.document.createElement('main') as unknown as HTMLElement;
	const fixture = new testWindow.File(['{}'], 'legacy.json', { type: 'application/json' }) as unknown as File;
	const opened: File[] = [];
	const cleanup = wireSnapshotFileInputs(input, dropZone, (file) => {
		if (file) opened.push(file);
	});

	const dragOver = new testWindow.Event('dragover', { cancelable: true }) as unknown as DragEvent;
	dropZone.dispatchEvent(dragOver);
	assert.equal(dragOver.defaultPrevented, true);
	assert.equal(dropZone.classList.contains('dragging'), true);

	const drop = new testWindow.Event('drop', { cancelable: true }) as unknown as DragEvent;
	Object.defineProperty(drop, 'dataTransfer', { value: { files: [fixture] } });
	dropZone.dispatchEvent(drop);
	assert.equal(drop.defaultPrevented, true);
	assert.equal(dropZone.classList.contains('dragging'), false);
	assert.deepEqual(opened, [fixture]);

	cleanup();
	dropZone.dispatchEvent(drop);
	assert.deepEqual(opened, [fixture]);
	testWindow.close();
});
