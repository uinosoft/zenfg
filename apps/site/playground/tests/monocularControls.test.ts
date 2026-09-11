import assert from 'node:assert/strict';
import test from 'node:test';
import { typeGpuMonocularLightInjectionExample } from '../src/catalog/typeGpuMonocularLightInjection.ts';
import { assertPending, deferred, hostEnvironment, until } from '../../examples/typegpu-monocular-light-injection/tests/hostEnvironment.ts';
import { FrameGraphInspector } from '../../../../packages/inspector/src/FrameGraphInspector.ts';

test('Inspector opened during Monocular initialization automatically displays the first frame', async () => {
    const env = hostEnvironment();
    const download = deferred<void>();
    const fetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => { await download.promise; return fetch(url, init); }) as typeof fetch;
    const abort = new AbortController();
    let panel: FrameGraphInspector | undefined;
    try {
        const runtime = await typeGpuMonocularLightInjectionExample.mount({
            canvas: env.canvas, controlsHost: env.controlsHost, signal: abort.signal,
            onReady() {}, onError(error) { throw error; },
        });
        assert.ok(runtime);
        let captureCalls = 0;
        let capture!: ReturnType<typeof runtime.captureSnapshot>;
        panel = new FrameGraphInspector({ captureSnapshot: () => {
            captureCalls++;
            capture = runtime.captureSnapshot();
            return capture;
        } });
        await until(() => captureCalls === 1);
        assert.equal(panel.dom.querySelector<HTMLElement>('.zenfg-inspector-workbench-empty')?.dataset.state, 'capturing');
        await assertPending(capture);
        download.resolve();
        await until(() => env.bitmaps.length > 0);
        env.frame();
        await until(() => Boolean(panel!.dom.querySelector('.zenfg-inspector-capture-summary')));
        assert.equal(captureCalls, 1);
        assert.equal((await capture)!.graph.nodes.length, 2);
        assert.doesNotMatch(panel.dom.textContent ?? '', /No snapshot was produced/);
    } finally { panel?.destroy(); abort.abort(); env.restore(); }
});

test('Monocular adapter shows retryable failures, resumes rendering and cleans up controls on abort', async () => {
    const env = hostEnvironment();
    env.failModels(true);
    const errors: Error[] = [];
    try {
        const abort = new AbortController();
        const runtime = await typeGpuMonocularLightInjectionExample.mount({
            canvas: env.canvas, controlsHost: env.controlsHost, signal: abort.signal,
            onReady() {}, onError(error) { errors.push(error); },
        });
        await until(() => errors.length > 0);
        const buttons = Array.from(env.controlsHost.querySelectorAll('button'));
        const retry = buttons.find((button) => button.textContent?.includes('Reload / retry model'))!;
        assert.ok(retry);
        assert.equal(retry.disabled, false);
        env.failModels(false); retry.click();
        await until(() => !retry.disabled && env.bitmaps.length > 0);
        env.frame();
        assert.equal(env.submits, 1);
        const source = Array.from(env.controlsHost.querySelectorAll('select')).find((select) =>
            Array.from(select.options).some((option) => option.textContent === 'Upload'))!;
        source.value = Array.from(source.options).find((option) => option.textContent === 'Upload')!.value;
        source.dispatchEvent(new env.browser.Event('change') as never);
        await until(() => errors.some((error) => error.message === 'Choose an image first.'));
        assert.equal(source.selectedOptions[0]!.textContent, 'Demo photo');
        assert.equal(env.controlsHost.querySelectorAll('textarea').length, 0, 'runtime feedback is owned by the shell');
        const capture = runtime!.captureSnapshot();
        abort.abort();
        assert.equal(await capture, undefined);
        assert.equal(env.controlsHost.childElementCount, 0);
        assert.equal(env.destroyed, 1);
    } finally { env.restore(); }
});
