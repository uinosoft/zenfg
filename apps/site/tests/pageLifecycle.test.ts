import assert from 'node:assert/strict';
import test from 'node:test';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';

test('keeps persisted pages alive and restores them after back-forward navigation', () => {
	const target = new EventTarget();
	let discards = 0;
	let restores = 0;
	let reloads = 0;
	const uninstall = installAppPageLifecycle(target as unknown as Window, {
		onDiscard: () => { discards += 1; },
		onRestore: () => { restores += 1; },
		reloadOnRestore: () => { reloads += 1; },
	});

	target.dispatchEvent(pageTransition('pagehide', true));
	target.dispatchEvent(pageTransition('pageshow', true));
	assert.deepEqual({ discards, restores, reloads }, { discards: 0, restores: 1, reloads: 1 });

	target.dispatchEvent(pageTransition('pagehide', false));
	target.dispatchEvent(pageTransition('pageshow', false));
	assert.deepEqual({ discards, restores, reloads }, { discards: 1, restores: 1, reloads: 1 });

	uninstall();
	target.dispatchEvent(pageTransition('pagehide', false));
	assert.equal(discards, 1);
});

function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
	const event = new Event(type);
	Object.defineProperty(event, 'persisted', { value: persisted });
	return event;
}
