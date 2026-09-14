import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createExampleDirectory } from '../src/exampleDirectory.ts';

const examples = [
	{ id: 'showcase', title: 'Live showcase', group: 'Showcases' as const },
	{ id: 'minimal-frame', title: 'Minimal Frame', group: '@zenfg/webgpu basics' as const },
];
test('directory groups, real links and current entry survive panel changes', () => {
	const browser = new Window({ url: 'https://zenfg.test/playground/' });
	try {
		const host = browser.document.createElement('nav') as unknown as HTMLElement;
		const directory = createExampleDirectory({ host, examples, selectedId: 'showcase', panel: 'inspector' });
		const groups = host.querySelectorAll('details');
		assert.equal(groups[0]!.open, true);
		assert.equal(groups[1]!.open, false);
		assert.equal(host.querySelector('[aria-current=page]')?.textContent, 'Live showcase');
		assert.equal(host.querySelector('a')?.getAttribute('href'), '?example=showcase&panel=inspector');
		groups[1]!.open = true;
		directory.setPanel('code');
		assert.equal(groups[1]!.open, true);
		assert.equal(host.querySelector('a')?.getAttribute('href'), '?example=showcase&panel=code');
		directory.destroy();
		assert.equal(host.children.length, 0);
		createExampleDirectory({ host, examples, selectedId: 'minimal-frame', panel: 'inspector' });
		assert.equal(host.querySelectorAll('details')[1]!.open, true);
		assert.equal(host.querySelector('[aria-current=page]')?.getAttribute('href'), '?example=minimal-frame&panel=inspector');
	} finally { browser.happyDOM.abort(); }
});

test('filter searches across groups without changing selection and restores expansion', () => {
	const browser = new Window();
	try {
		const host = browser.document.createElement('nav') as unknown as HTMLElement;
		const directory = createExampleDirectory({ host, examples, selectedId: 'showcase', panel: 'inspector' });
		const input = host.querySelector('input')!;
		const filter = (text: string) => { input.value = text; input.dispatchEvent(new browser.Event('input') as unknown as Event); };
		filter('  MINIMAL frame ');
		assert.equal(host.querySelectorAll('a:not([hidden])').length, 1);
		assert.equal(host.querySelectorAll('details')[1]!.open, true);
		assert.equal(host.querySelector('[aria-current=page]')?.getAttribute('data-example-id'), 'showcase');
		directory.setPanel('code');
		assert.equal(host.querySelector('a:not([hidden])')?.getAttribute('href'), '?example=minimal-frame&panel=code');
		filter('not found');
		assert.equal(host.querySelector<HTMLElement>('[role=status]')!.hidden, false);
		input.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as KeyboardEvent);
		assert.equal(input.value, '');
		assert.equal(host.querySelectorAll('a:not([hidden])').length, 2);
		assert.equal(host.querySelectorAll('details')[1]!.open, false);
		filter('webgpu');
		assert.equal(host.querySelectorAll('a:not([hidden])').length, 1);
		directory.destroy();
		filter('showcase');
		assert.equal(host.children.length, 0);
	} finally { browser.happyDOM.abort(); }
});
