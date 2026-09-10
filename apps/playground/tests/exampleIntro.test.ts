import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { renderExampleText } from '../src/exampleIntro.ts';

test('intro renders inline emphasis and links without interpreting markup or unsafe URLs', () => {
	const browser = new Window();
	try {
		const host = browser.document.createElement('p') as unknown as HTMLElement;
		renderExampleText(host, ['Inspect ', { text: 'dependencies', emphasis: 'strong' },
			{ text: 'source', href: 'https://example.com/source', emphasis: 'code' },
			{ text: '<img src=x>', href: 'javascript:alert(1)' }]);
		assert.equal(host.querySelector('strong')?.textContent, 'dependencies');
		assert.equal(host.querySelectorAll('a').length, 1);
		assert.equal(host.querySelector('a code')?.textContent, 'source');
		assert.equal(host.querySelector('a')?.rel, 'noopener noreferrer');
		assert.equal(host.querySelector('img'), null);
		assert.ok(host.textContent.includes('<img src=x>'));
		renderExampleText(host, 'Plain description');
		assert.equal(host.textContent, 'Plain description');
		assert.equal(host.children.length, 0);
	} finally { browser.happyDOM.abort(); }
});
