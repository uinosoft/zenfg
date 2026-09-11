import assert from 'node:assert/strict';
import test from 'node:test';
import { particles4AllDeviceDescriptor, resolveCanvasBackingSize, startParticles4All } from '../src/startParticles4All.ts';
import { browserEnvironment, deferred } from './browserEnvironment.ts';

test('initial and paused snapshot captures execute the next real frame and commit only after submission', async () => {
    const env = browserEnvironment();
    let frames = 0;
    const host = env.start({ onFrame: () => { frames++; assert.equal(env.submits, frames); throw new Error('telemetry consumer failed'); } });
    try {
        const pending = host.captureSnapshot();
        assert.equal(host.captureSnapshot(), pending);
        assert.equal(env.submits, 0);
        env.frame();
        assert.equal(env.submits, 1); assert.equal(env.state.commits, 1); assert.equal(frames, 1);
        assert.deepEqual((await pending)!.graph.nodes.map((node) => node.label), ['test-fluid-render']);
        host.setSettings({ paused: true });
        assert.equal(host.getState().paused, true);
        const paused = host.captureSnapshot(); env.frame(1080);
        assert.ok(await paused); assert.equal(env.state.commits, 2);
        assert.deepEqual(env.state.deltaTimes, [0, 0.05]);
    } finally { host.dispose(); env.restore(); }
});

for (const failure of ['record', 'compile', 'submit'] as const) {
    test(`${failure} failure ends snapshot waits, disposes resources and does not commit`, async () => {
        const env = browserEnvironment();
        const errors: Error[] = [];
        let frames = 0;
        const host = env.start({ onError: (error) => errors.push(error), onFrame: () => { frames++; } });
        try {
            if (failure === 'record') env.state.failRecording = true;
            if (failure === 'compile') env.state.invalidGraph = true;
            if (failure === 'submit') env.failSubmit();
            const pending = host.captureSnapshot(); env.frame();
            assert.equal(await pending, undefined);
            assert.equal(env.state.commits, 0);
            assert.equal(frames, 0, 'failed submissions never increment FPS');
            assert.equal(env.state.discards, failure === 'record' ? 0 : 1);
            assert.equal(env.state.disposed, 1); assert.equal(env.destroyed, 1);
            assert.equal(errors.length, 1); assert.equal(env.frames, 0);
            host.dispose(); assert.equal(env.destroyed, 1);
        } finally { host.dispose(); env.restore(); }
    });
}

test('page suspension settles captures, resets time and resumes without stale captures blocking the next one', async () => {
    const env = browserEnvironment(); const host = env.start();
    try {
        const waiting = host.captureSnapshot(); env.hidden(true);
        assert.equal(await waiting, undefined); assert.equal(await host.captureSnapshot(), undefined);
        assert.equal(env.frames, 0);
        env.hidden(false); const resumed = host.captureSnapshot(); env.frame(10000);
        assert.ok(await resumed); assert.equal(env.state.deltaTimes[0], 0);
        const inFlight = host.captureSnapshot(); env.frame(10010); env.hidden(true);
        assert.equal(await inFlight, undefined);
        env.hidden(false); const next = host.captureSnapshot(); env.frame(20000);
        assert.ok(await next); assert.equal(env.state.deltaTimes.at(-1), 0);
    } finally { host.dispose(); env.restore(); }
});

test('abort disposes once, settles waiting capture and ignores late environment completion', async () => {
    const env = browserEnvironment(); const abort = new AbortController(); const load = deferred<void>();
    env.workload.loadEnvironment = () => load.promise;
    const states: string[] = [];
    const host = env.start({ signal: abort.signal, onStateChange: (state) => states.push(state.status) });
    try {
        const upload = host.loadEnvironment(new Blob()); const capture = host.captureSnapshot();
        abort.abort(); assert.equal(await capture, undefined);
        load.resolve(); await upload;
        assert.deepEqual(states, ['Loading environment…']);
        host.dispose(); assert.equal(env.destroyed, 1); assert.equal(env.unconfigured, 1);
        assert.equal(env.frames, 0);
    } finally { host.dispose(); env.restore(); }
});

test('the default panorama loads in the background while the first real frame remains capturable', async () => {
    const env = browserEnvironment(); const environment = deferred<void>();
    env.workload.loadEnvironment = () => environment.promise;
    const host = env.start({ loadDefaultEnvironment: true });
    try {
        assert.equal(host.getState().status, 'Loading environment…');
        const capture = host.captureSnapshot(); env.frame();
        assert.ok(await capture); assert.equal(host.getState().ready, true);
        environment.resolve();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(host.getState().status, 'Environment loaded');
    } finally { host.dispose(); env.restore(); }
});

test('Space pauses on the canvas but leaves editable controls untouched', () => {
    const env = browserEnvironment(); const host = env.start();
    try {
        env.browser.dispatchEvent(new env.browser.KeyboardEvent('keydown', { code: 'Space' }));
        assert.equal(host.getSettings().paused, true);
        const input = env.browser.document.createElement('input'); env.browser.document.body.append(input);
        input.dispatchEvent(new env.browser.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
        assert.equal(host.getSettings().paused, true);
        env.browser.dispatchEvent(new env.browser.KeyboardEvent('keydown', { code: 'Space', repeat: true }));
        assert.equal(host.getSettings().paused, true);
        env.browser.dispatchEvent(new env.browser.KeyboardEvent('keydown', { code: 'Space' }));
        assert.equal(host.getSettings().paused, false);
    } finally { host.dispose(); env.restore(); }
});

test('latest environment notifications win and clearing a pending upload preserves procedural sky status', async () => {
    const env = browserEnvironment(); const first = deferred<void>(); const second = deferred<void>();
    let index = 0;
    env.workload.loadEnvironment = () => ++index === 1 ? first.promise : second.promise;
    const warnings: (string | undefined)[] = []; const host = env.start({ onWarning: (warning) => warnings.push(warning) });
    try {
        const stale = host.loadEnvironment('old.hdr'); const current = host.loadEnvironment('new.hdr');
        second.resolve(); await current; first.reject(new Error('old failure')); await stale;
        assert.equal(host.getState().status, 'Environment loaded'); assert.deepEqual(warnings.filter(Boolean), []);
        const pending = deferred<void>(); env.workload.loadEnvironment = () => pending.promise;
        const upload = host.loadEnvironment(new Blob()); host.clearEnvironment(); pending.resolve(); await upload;
        assert.equal(host.getState().status, 'Procedural sky'); assert.equal(env.state.clearEnvironment, 1);
        env.workload.loadEnvironment = async () => { throw new Error('invalid panorama'); };
        await host.loadEnvironment(new Blob()); assert.match(warnings.at(-1)!, /invalid panorama/);
        env.frame(); assert.equal(env.submits, 1);
        env.workload.loadEnvironment = async () => {};
        await host.loadEnvironment('valid.hdr');
        assert.equal(warnings.at(-1), undefined, 'successful recovery clears the warning');
    } finally { host.dispose(); env.restore(); }
});

test('invalid imported settings preserve the current scene; missing assets stay local and warn', () => {
    const env = browserEnvironment(); const host = env.start();
    try {
        const previous = host.getSettings();
        assert.throws(() => host.importSettings('[simulation]\nsubsteps=NaN'), /finite/);
        assert.deepEqual(host.getSettings(), previous);
        const result = host.importSettings('[environment]\ncubemap=folder/sky.hdr\n[unknown]\nvalue=1');
        assert.equal(result.missingPanorama, 'sky.hdr');
        assert.match(host.getState().status, /sky.hdr/);
    } finally { host.dispose(); env.restore(); }
});

test('resizes preserve the aspect ratio under texture limits and invalidate retained transient resources only on spec changes', () => {
    const env = browserEnvironment(); const host = env.start(); let cleared = 0;
    const clear = env.graph.clearResourcePool.bind(env.graph);
    env.graph.clearResourcePool = () => { cleared++; clear(); };
    try {
        env.frame();
        host.setSettings({ gravity: 2 }); assert.equal(cleared, 0);
        host.setSettings({ displayMode: 'particles' }); env.frame(); assert.equal(cleared, 1);
        host.reset(); assert.equal(cleared, 2);
        env.canvas.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;
        env.frame(); assert.deepEqual(env.state.resizes.at(-1), [640, 360]); assert.equal(cleared, 3);
        assert.deepEqual(resolveCanvasBackingSize(env.canvas, 4, 640), { width: 640, height: 360 });
    } finally { host.dispose(); env.restore(); }
});

test('prepared transient spec changes clear the pool before each changed frame without clearing stable frames', () => {
    const env = browserEnvironment(); const host = env.start(); let cleared = 0;
    const clear = env.graph.clearResourcePool.bind(env.graph);
    env.graph.clearResourcePool = () => { cleared++; clear(); };
    try {
        env.frame(); assert.equal(cleared, 0);
        // Represents successive box dimensions or poured particle counts, without another UI change.
        env.state.resourceRevision++; env.frame(); assert.equal(cleared, 1);
        env.state.resourceRevision++; env.frame(); assert.equal(cleared, 2);
        env.frame(); assert.equal(cleared, 2);
    } finally { host.dispose(); env.restore(); }
});

test('eight, ten and sixteen storage-buffer adapters request only eight plus bounded buffer capacity', () => {
    const env = browserEnvironment();
    try {
        for (const count of [8, 10, 16]) {
            Object.assign(env.device.limits, { maxStorageBuffersPerShaderStage: count, maxBufferSize: 2 ** 32, maxStorageBufferBindingSize: 2 ** 31 });
            const descriptor = particles4AllDeviceDescriptor(env.adapter as GPUAdapter);
            assert.equal(descriptor.requiredLimits!.maxStorageBuffersPerShaderStage, 8);
            assert.equal(descriptor.requiredLimits!.maxBufferSize, 2 ** 30);
            assert.equal(descriptor.requiredLimits!.maxStorageBufferBindingSize, 2 ** 30);
            assert.deepEqual(descriptor.requiredFeatures, []);
        }
        Object.assign(env.device.limits, { maxComputeWorkgroupSizeX: 128 });
        assert.throws(() => particles4AllDeviceDescriptor(env.adapter as GPUAdapter), /256-thread/);
    } finally { env.graph.destroy(); env.restore(); }
});

test('initialization cancellation while a device request is pending destroys the late device', async () => {
    const env = browserEnvironment(); const abort = new AbortController(); const request = deferred<GPUDevice>();
    env.adapter.requestDevice = () => request.promise;
    try {
        const starting = startParticles4All(env.canvas, { signal: abort.signal });
        await new Promise((resolve) => setImmediate(resolve));
        abort.abort(); request.resolve(env.device);
        await assert.rejects(starting, /abort/i);
        assert.equal(env.destroyed, 1); assert.equal(env.unconfigured, 0); assert.equal(env.frames, 0);
    } finally { env.graph.destroy(); env.restore(); }
});

test('fatal error notification may synchronously abort and dispose the host without duplicate cleanup', async () => {
    const env = browserEnvironment(); const abort = new AbortController(); let errors = 0;
    const host = env.start({ signal: abort.signal, onError() {
        errors++; abort.abort(); host.dispose();
    } });
    try {
        const capture = host.captureSnapshot(); env.failSubmit(); env.frame();
        assert.equal(await capture, undefined); assert.equal(errors, 1);
        assert.equal(env.state.disposed, 1); assert.equal(env.destroyed, 1); assert.equal(env.unconfigured, 1);
        assert.equal(env.frames, 0);
        abort.abort(); host.dispose();
        assert.equal(env.state.disposed, 1); assert.equal(env.destroyed, 1);
    } finally { host.dispose(); env.restore(); }
});
