import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { initializeInspectorWorkspace } from '../src/inspectorWorkspace.ts';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import type { ExamplesRuntime } from '../src/types.ts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
const runtime: ExamplesRuntime = { captureSnapshot: async () => undefined, dispose() {} };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

for (const fails of [false, true]) {
    test(`discard during Inspector import ignores late ${fails ? 'failure' : 'success'}`, async t => {
        const dom = new Window();
        t.after(() => dom.happyDOM.abort());
        const loading = dom.document.createElement('div') as unknown as HTMLElement;
        const abort = new AbortController();
        const pending = deferred<(runtime: ExamplesRuntime) => void>();
        let mounts = 0;
        const task = initializeInspectorWorkspace({ signal: abort.signal, loading, runtime: Promise.resolve(runtime), load: () => pending.promise });
        await flush();
        assert.equal(loading.textContent, 'Loading FrameGraph Inspector…');
        abort.abort();
        loading.textContent = 'new page state';
        loading.hidden = true;
        if (fails) pending.reject(new Error('late network failure'));
        else pending.resolve(() => { mounts++; });
        await task;
        assert.equal(loading.textContent, 'new page state');
        assert.equal(loading.hidden, true);
        assert.equal(mounts, 0);
    });
}

test('discard while awaiting runtime does not start the Inspector import', async t => {
    const dom = new Window();
    t.after(() => dom.happyDOM.abort());
    const loading = dom.document.createElement('div') as unknown as HTMLElement;
    const abort = new AbortController();
    const pending = deferred<ExamplesRuntime | undefined>();
    let imports = 0;
    const task = initializeInspectorWorkspace({ signal: abort.signal, loading, runtime: pending.promise, load: async () => { imports++; return () => {}; } });
    abort.abort();
    const text = loading.textContent;
    pending.resolve(runtime);
    await task;
    assert.equal(imports, 0);
    assert.equal(loading.textContent, text);
});

test('BFCache retains a pending Inspector import and discard cancels only once', async t => {
    const dom = new Window();
    t.after(() => dom.happyDOM.abort());
    const loading = dom.document.createElement('div') as unknown as HTMLElement;
    const target = new EventTarget();
    const abort = new AbortController();
    let discards = 0;
    let mounts = 0;
    const uninstall = installAppPageLifecycle(target as unknown as globalThis.Window, { onDiscard: () => { discards++; abort.abort(); } });
    t.after(uninstall);
    const pending = deferred<(runtime: ExamplesRuntime) => void>();
    const task = initializeInspectorWorkspace({ signal: abort.signal, loading, runtime: Promise.resolve(runtime), load: () => pending.promise });
    await flush();
    for (const name of ['pagehide', 'pageshow']) {
        const event = new Event(name);
        Object.defineProperty(event, 'persisted', { value: true });
        target.dispatchEvent(event);
    }
    pending.resolve(() => { mounts++; });
    await task;
    assert.equal(abort.signal.aborted, false);
    assert.equal(mounts, 1);
    assert.equal(loading.hidden, true);
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(new Event('pagehide'));
    assert.equal(discards, 1);
});

test('active Inspector import failures remain visible', async t => {
    const dom = new Window();
    t.after(() => dom.happyDOM.abort());
    const loading = dom.document.createElement('div') as unknown as HTMLElement;
    await initializeInspectorWorkspace({ signal: new AbortController().signal, loading, runtime: Promise.resolve(runtime), load: async () => { throw new Error('network failure'); } });
    assert.match(loading.textContent!, /Could not load the Inspector: network failure/);
    assert.equal(loading.hidden, false);
});
