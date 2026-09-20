import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { parseFrameGraphSnapshot } from '@zenfg/snapshot';

import { downloadSnapshotJson } from '../src/catalog/webgpu/snapshotExport.ts';

test('Snapshot Export downloads canonical JSON with the requested filename', async () => {
	const target = globalThis as Record<string, unknown>;
	const previousDocument = Object.getOwnPropertyDescriptor(target, 'document');
	const previousUrl = Object.getOwnPropertyDescriptor(target, 'URL');
	let downloadedName = '';
	let downloadedBlob: Blob | undefined;
	let revokedUrl = '';
	Object.defineProperties(target, {
		document: {
			configurable: true,
			value: {
				createElement(tag: string) {
					assert.equal(tag, 'a');
					return {
						href: '',
						download: '',
						click() { downloadedName = this.download; },
					};
				},
			},
		},
		URL: {
			configurable: true,
			value: {
				createObjectURL(blob: Blob) {
					downloadedBlob = blob;
					return 'blob:snapshot-export';
				},
				revokeObjectURL(url: string) { revokedUrl = url; },
			},
		},
	});
	try {
		const json = readFileSync(resolve('packages/snapshot/fixtures/minimal.fgsnapshot.json'), 'utf8');
		downloadSnapshotJson(json, 'frame-graph-7.fgsnapshot.json');
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.equal(downloadedName, 'frame-graph-7.fgsnapshot.json');
		assert.ok(downloadedBlob);
		assert.equal(downloadedBlob.type, 'application/json;charset=utf-8');
		const decoded = parseFrameGraphSnapshot(await downloadedBlob.text());
		assert.ok(decoded.ok);
		assert.equal(decoded.snapshot.version.minor, 2);
		assert.equal(revokedUrl, 'blob:snapshot-export');
	} finally {
		if (previousDocument) Object.defineProperty(target, 'document', previousDocument);
		else delete target.document;
		if (previousUrl) Object.defineProperty(target, 'URL', previousUrl);
		else delete target.URL;
	}
});
