import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeBackground } from '../src/background.ts';
import type { ThemeMode } from '../shared/theme/index.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
	const requests: Array<{ initial: ThemeMode; ready(): void; fail(error: unknown): void; finish(): void; disposals: number; themes: ThemeMode[]; activity: boolean[] }> = [];
	const ready: boolean[] = [], errors: unknown[] = [];
	const background = createHomeBackground({
		start: (initial, callbacks) => new Promise(resolve => {
			const request = {
				initial, ready: callbacks.onReady, fail: callbacks.onError, disposals: 0, themes: [] as ThemeMode[], activity: [] as boolean[],
				finish: () => resolve({ setTheme: mode => request.themes.push(mode), setActive: active => request.activity.push(active), dispose: () => { request.disposals++; } }),
			};
			requests.push(request);
		}),
		onReady: value => ready.push(value), onError: error => errors.push(error),
	});
	return { background, requests, ready, errors };
}

test('both initial themes start GPU and show only a submitted frame', async () => {
	for (const mode of ['light', 'dark'] as const) {
		const f = fixture(); f.background.setTheme(mode);
		assert.equal(f.requests[0]!.initial, mode);
		f.requests[0]!.finish(); await flush();
		assert.equal(f.ready.at(-1), false);
		f.requests[0]!.ready(); assert.equal(f.ready.at(-1), true);
		f.background.setTheme(mode === 'light' ? 'dark' : 'light');
		assert.equal(f.requests.length, 1); assert.equal(f.requests[0]!.disposals, 0);
		f.background.destroy(); assert.equal(f.requests[0]!.disposals, 1);
	}
});

test('theme and visibility changes during initialization are applied to the single device', async () => {
	const f = fixture(); f.background.setTheme('dark');
	f.background.setTheme('light'); f.background.setTheme('dark'); f.background.setTheme('light');
	f.background.setActive(false);
	f.requests[0]!.ready(); assert.equal(f.ready.at(-1), false);
	f.requests[0]!.finish(); await flush();
	assert.equal(f.requests.length, 1);
	assert.deepEqual(f.requests[0]!.themes, ['light']);
	assert.deepEqual(f.requests[0]!.activity, [false]);
	assert.equal(f.ready.at(-1), true);
	f.background.setActive(true); assert.deepEqual(f.requests[0]!.activity, [false, true]);
	f.background.destroy();
});

test('discard during initialization releases late resources and suppresses stale callbacks', async () => {
	const f = fixture(); f.background.setTheme('light'); f.background.destroy();
	f.requests[0]!.ready(); f.requests[0]!.fail(Error('stale')); f.requests[0]!.finish(); await flush();
	assert.equal(f.requests[0]!.disposals, 1); assert.equal(f.ready.at(-1), false); assert.deepEqual(f.errors, []);
	f.background.setTheme('dark'); assert.equal(f.requests.length, 1);
});

test('device loss falls back and never retries on theme changes', async () => {
	const f = fixture(); f.background.setTheme('dark'); f.requests[0]!.finish(); await flush();
	f.requests[0]!.ready(); f.requests[0]!.fail(Error('device lost')); f.requests[0]!.ready();
	f.background.setTheme('light'); f.background.setTheme('dark');
	assert.equal(f.ready.at(-1), false); assert.equal(f.requests[0]!.disposals, 1);
	assert.equal(f.requests.length, 1); assert.equal(f.errors.length, 1); f.background.destroy();
});

test('initialization failures preserve fallback and release late ownership', async () => {
	const f = fixture(); f.background.setTheme('light'); f.requests[0]!.fail(Error('startup')); f.requests[0]!.finish(); await flush();
	assert.equal(f.requests[0]!.disposals, 1); assert.equal(f.ready.at(-1), false); f.background.destroy();
	for (const reject of [false, true]) {
		const ready: boolean[] = [], errors: unknown[] = [];
		const background = createHomeBackground({
			start: async (_theme, callbacks) => { if (reject) throw Error('initialization'); callbacks.onError(Error('unavailable')); return undefined; },
			onReady: value => ready.push(value), onError: error => errors.push(error),
		});
		background.setTheme('light'); await flush();
		assert.equal(ready.at(-1), false); assert.equal(errors.length, 1); background.destroy();
	}
});
