import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createExamplePicker, type ExamplePickerEntry } from '../src/examplePicker.ts';

const examples: readonly ExamplePickerEntry[] = [
	{ id: 'interactive-background', title: 'Interactive FrameGraph Background', group: 'Showcases' },
	{ id: 'typegpu-slime-mold', title: 'TypeGPU · Slime Mold', group: 'Showcases' },
	{ id: 'minimal-frame', title: 'Minimal Frame', group: '@zenfg/webgpu basics' },
	{ id: 'compute-output', title: 'Compute Output', group: '@zenfg/webgpu basics' },
];

test('custom example picker preserves grouping, selection, and keyboard navigation', () => {
	const browser = new Window({ url: 'https://zenfg.test/playground/' });
	try {
		const host = browser.document.createElement('div') as unknown as HTMLElement;
		const outside = browser.document.createElement('button');
		browser.document.body.append(host as unknown as Node, outside);
		const selections: string[] = [];
		const picker = createExamplePicker({
			host,
			examples,
			selectedId: 'typegpu-slime-mold',
			onSelect: (id) => selections.push(id),
		});
		const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
		const listbox = host.querySelector<HTMLElement>('[role="listbox"]');
		const options = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
		assert.ok(trigger);
		assert.ok(listbox);
		assert.equal(trigger.textContent?.trim(), 'TypeGPU · Slime Mold');
		assert.equal(trigger.getAttribute('aria-expanded'), 'false');
		assert.equal(listbox.hidden, true);
		assert.deepEqual(
			[...host.querySelectorAll('[role="group"]')].map((group) => (
				group.querySelector('.example-picker__group-label')?.textContent
			)),
			['Showcases', '@zenfg/webgpu basics'],
		);
		assert.deepEqual(
			options.map((option) => option.getAttribute('aria-selected')),
			['false', 'true', 'false', 'false'],
		);

		trigger.dispatchEvent(new browser.KeyboardEvent('keydown', {
			key: 'ArrowDown',
			bubbles: true,
		}));
		assert.equal(listbox.hidden, false);
		assert.equal(trigger.getAttribute('aria-expanded'), 'true');
		assert.equal(browser.document.activeElement?.textContent, 'TypeGPU · Slime Mold');

		options[1]?.dispatchEvent(new browser.KeyboardEvent('keydown', {
			key: 'ArrowDown',
			bubbles: true,
		}));
		assert.equal(browser.document.activeElement?.textContent, 'Minimal Frame');
		options[2]?.dispatchEvent(new browser.KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
		}));
		assert.deepEqual(selections, ['minimal-frame']);
		assert.equal(listbox.hidden, true);
		assert.equal(browser.document.activeElement, trigger);

		trigger.dispatchEvent(new browser.KeyboardEvent('keydown', {
			key: 'c',
			bubbles: true,
		}));
		assert.equal(listbox.hidden, false);
		assert.equal(browser.document.activeElement?.textContent, 'Compute Output');
		outside.dispatchEvent(new browser.Event('pointerdown', { bubbles: true }));
		assert.equal(listbox.hidden, true);

		trigger.click();
		assert.equal(listbox.hidden, false);
		browser.document.dispatchEvent(new browser.KeyboardEvent('keydown', {
			key: 'Escape',
			bubbles: true,
		}));
		assert.equal(listbox.hidden, true);
		assert.equal(browser.document.activeElement, trigger);

		picker.destroy();
		picker.destroy();
		assert.equal(host.childElementCount, 0);
		assert.equal(host.classList.contains('example-picker'), false);
	} finally {
		browser.close();
	}
});

test('custom example picker exposes unavailable routes without hiding valid choices', () => {
	const browser = new Window({ url: 'https://zenfg.test/playground/' });
	try {
		const host = browser.document.createElement('div') as unknown as HTMLElement;
		browser.document.body.appendChild(host as unknown as Node);
		const picker = createExamplePicker({
			host,
			examples,
			unavailableLabel: 'Unavailable · removed-example',
			onSelect: () => undefined,
		});
		const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
		assert.ok(trigger);
		assert.equal(trigger.textContent?.trim(), 'Unavailable · removed-example');
		assert.equal(trigger.disabled, false);
		trigger.click();
		assert.equal(host.querySelectorAll('[role="option"]').length, examples.length);
		picker.destroy();
	} finally {
		browser.close();
	}
});
