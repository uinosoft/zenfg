import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createSourceView, orderedSourceFiles } from '../src/sourceView.ts';
import type { PlaygroundSourceFile } from '../src/types.ts';

function file(id: string, loadSource = async () => `/** Source: ${id} */\nexport {};`): PlaygroundSourceFile {
	return { id, label: `${id}.ts`, path: `examples/test/src/${id}.ts`, role: 'example', language: 'typescript', loadSource };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(files: readonly PlaygroundSourceFile[], highlight = async (source: string) => `<pre>${source}</pre>`) {
	const browser = new Window();
	const document = browser.document as unknown as Document;
	const list = document.createElement('nav');
	const path = document.createElement('span');
	const content = document.createElement('div');
	const copy = document.createElement('button');
	const copied: string[] = [];
	const view = createSourceView({
		definition: { id: 'test', entrySourceId: 'main', sourceFiles: files },
		files: list, path, content, copy, highlight,
		copyText: async source => { copied.push(source); },
	});
	return { ...view, list, path, content, copy, copied,
		select: (id: string) => list.querySelector<HTMLButtonElement>(`[data-source-id="${id}"]`)!.click(),
		destroy() { view.destroy(); browser.happyDOM.abort(); },
	};
}

test('the declared entry is first independently of catalog order; invalid identities fail explicitly', () => {
	const sourceFiles = [file('workload'), file('main'), file('shader')];
	const definition = { id: 'test', entrySourceId: 'main', sourceFiles };
	assert.deepEqual(orderedSourceFiles(definition).map(file => file.id), ['main', 'workload', 'shader']);
	assert.deepEqual(sourceFiles.map(file => file.id), ['workload', 'main', 'shader']);
	assert.throws(() => orderedSourceFiles({ ...definition, entrySourceId: 'missing' }), /exactly one/);
	assert.throws(() => orderedSourceFiles({ ...definition, sourceFiles: [...sourceFiles, file('main')] }), /exactly one/);
	assert.throws(() => orderedSourceFiles({ ...definition, sourceFiles: [...sourceFiles, file('shader')] }), /duplicate/);
});

test('all files are rendered before entry loading; real source including its introduction is copied', async t => {
	let loaded = false;
	const source = '/** Source: Original showcase.\n * Demonstrates: graph execution. */\nexport {};';
	const f = fixture([file('workload'), file('main', async () => { loaded = true; return source; })]);
	t.after(() => f.destroy());
	assert.equal(loaded, true);
	assert.equal(f.list.querySelectorAll('button').length, 2);
	assert.equal(f.list.firstElementChild?.getAttribute('data-source-id'), 'main');
	assert.equal(f.list.querySelector('.source-files__entry')?.textContent, 'Entry');
	await f.ready;
	assert.equal(f.path.textContent, 'examples/test/src/main.ts');
	assert.equal(f.path.title, f.path.textContent);
	assert.equal(f.content.textContent, source);
	f.copy.click();
	await flush();
	assert.deepEqual(f.copied, [source]);
	assert.equal(f.copy.textContent, 'Copied');
});

test('a slow entry never overwrites a file selected while it loads', async t => {
	let resolveEntry!: (source: string) => void;
	const f = fixture([file('main', () => new Promise(resolve => { resolveEntry = resolve; })), file('workload')]);
	t.after(() => f.destroy());
	assert.equal(f.list.querySelectorAll('button').length, 2);
	f.select('workload');
	await flush();
	resolveEntry('stale main');
	await f.ready;
	assert.match(f.content.textContent!, /Source: workload/);
	assert.equal(f.path.textContent, 'examples/test/src/workload.ts');
	assert.equal(f.list.querySelector('[aria-pressed="true"]')?.getAttribute('data-source-id'), 'workload');
});

test('a slow highlighter cannot overwrite a newer selection', async t => {
	let finishHighlight!: (html: string) => void;
	const f = fixture([file('main'), file('workload')], source => source.includes('main')
		? new Promise(resolve => { finishHighlight = resolve; }) : Promise.resolve(`<pre>${source}</pre>`));
	t.after(() => f.destroy());
	await flush();
	f.select('workload');
	await flush();
	finishHighlight('<pre>stale highlight</pre>');
	await f.ready;
	assert.match(f.content.textContent!, /Source: workload/);
});

test('switching resets both scroll axes and source failure disables stale copying', async t => {
	const f = fixture([file('main'), file('broken', async () => { throw new Error('offline'); })]);
	t.after(() => f.destroy());
	await f.ready;
	f.content.scrollTop = 200;
	f.content.scrollLeft = 150;
	f.select('broken');
	assert.equal(f.content.scrollTop, 0);
	assert.equal(f.content.scrollLeft, 0);
	assert.equal(f.copy.disabled, true);
	await flush();
	assert.match(f.content.textContent!, /Could not load source: offline/);
	f.copy.click();
	assert.deepEqual(f.copied, []);
	f.select('main');
	await flush();
	assert.equal(f.copy.disabled, false);
});

test('hiding the view retains selection and disposal ignores outstanding loads', async () => {
	let finish!: (source: string) => void;
	const f = fixture([file('main'), file('workload'), file('slow', () => new Promise(resolve => { finish = resolve; }))]);
	await f.ready;
	f.select('workload');
	await flush();
	f.list.hidden = true;
	f.list.hidden = false;
	assert.equal(f.list.querySelector('[aria-pressed="true"]')?.getAttribute('data-source-id'), 'workload');
	f.select('slow');
	f.destroy();
	finish('discarded');
	await flush();
	assert.notEqual(f.content.textContent, 'discarded');
	assert.equal(f.copy.disabled, true);
});
