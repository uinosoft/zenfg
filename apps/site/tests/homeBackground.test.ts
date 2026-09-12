import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeBackground } from '../src/background.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
	const requests: Array<{ ready(): void; fail(error: unknown): void; finish(): void; disposals: number }> = [];
	const ready: boolean[] = [];
	const errors: unknown[] = [];
	const background = createHomeBackground({
		start: callbacks => new Promise(resolve => {
			const request = { ready: callbacks.onReady, fail: callbacks.onError,
				finish: () => resolve({ dispose: () => { request.disposals++; } }), disposals: 0 };
			requests.push(request);
		}),
		onReady: value => ready.push(value), onError: error => errors.push(error),
	});
	return { background, requests, ready, errors };
}

test('light never starts GPU, dark becomes visible only when ready, and light releases it', async () => {
	const f = fixture();
	f.background.setTheme('light');
	assert.equal(f.requests.length, 0);
	f.background.setTheme('dark');
	f.requests[0]!.finish();
	await flush();
	assert.equal(f.ready.at(-1), false);
	f.requests[0]!.ready();
	assert.equal(f.ready.at(-1), true);
	f.background.setTheme('light');
	assert.equal(f.requests[0]!.disposals, 1);
	assert.equal(f.ready.at(-1), false);
	f.background.destroy();
});

test('rapid toggles serialize canvas ownership and suppress stale ready and error callbacks', async () => {
	const f = fixture();
	f.background.setTheme('dark');
	f.background.setTheme('light');
	f.background.setTheme('dark');
	assert.equal(f.requests.length, 1);
	f.requests[0]!.ready();
	f.requests[0]!.fail(Error('stale'));
	assert.equal(f.ready.at(-1), false);
	assert.deepEqual(f.errors, []);
	f.requests[0]!.finish();
	await flush();
	assert.equal(f.requests[0]!.disposals, 1);
	assert.equal(f.requests.length, 2);
	f.requests[1]!.finish();
	await flush();
	f.requests[1]!.ready();
	assert.equal(f.ready.at(-1), true);
	f.background.destroy();
	assert.equal(f.requests[1]!.disposals, 1);
});

test('discard during initialization releases late resources and never starts again', async () => {
	const f = fixture();
	f.background.setTheme('dark');
	f.background.destroy();
	f.requests[0]!.ready();
	f.requests[0]!.finish();
	await flush();
	assert.equal(f.requests[0]!.disposals, 1);
	assert.equal(f.ready.at(-1), false);
	f.background.setTheme('dark');
	assert.equal(f.requests.length, 1);
});

test('device loss falls back, disposes ownership and does not enter an automatic retry loop', async () => {
	const f = fixture();
	f.background.setTheme('dark');
	f.requests[0]!.finish();
	await flush();
	f.requests[0]!.ready();
	f.requests[0]!.fail(Error('device lost'));
	await flush();
	assert.equal(f.ready.at(-1), false);
	assert.equal(f.requests[0]!.disposals, 1);
	assert.equal(f.errors.length, 1);
	assert.equal(f.requests.length, 1);
	f.background.destroy();
});

test('unsupported WebGPU or rejected initialization keeps the static background', async () => {
	for (const reject of [false, true]) {
		const ready: boolean[] = [];
		const errors: unknown[] = [];
		const background = createHomeBackground({
			start: async callbacks => {
				if (reject) throw Error('initialization');
				callbacks.onError(Error('WebGPU unavailable'));
				return undefined;
			},
			onReady: value => ready.push(value), onError: error => errors.push(error),
		});
		background.setTheme('dark');
		await flush();
		assert.equal(ready.at(-1), false);
		assert.equal(errors.length, 1);
		background.destroy();
	}
});
