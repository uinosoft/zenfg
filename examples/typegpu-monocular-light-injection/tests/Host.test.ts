import assert from 'node:assert/strict';
import test from 'node:test';
import { startMonocularLightInjection } from '../src/startMonocularLightInjection.ts';
import { assertPending, deferred, hostEnvironment, until } from './hostEnvironment.ts';
import { deferPipelineCreation } from './fakeWebGpu.ts';

test('capture waits across download, model compilation, photo preparation and the first real frame', async () => {
    const env = hostEnvironment();
    const download = deferred<void>();
    const photo = deferred<void>();
    const decode = deferred<void>();
    const fetch = globalThis.fetch;
    const createBitmap = globalThis.createImageBitmap;
    let decoding = false;
    globalThis.fetch = (async (url, init) => {
        await (String(url).endsWith('.depthart') ? download.promise : photo.promise);
        return fetch(url, init);
    }) as typeof fetch;
    globalThis.createImageBitmap = (async (...args: Parameters<typeof createBitmap>) => {
        decoding = true;
        await decode.promise;
        return createBitmap(...args);
    }) as typeof createBitmap;
    const host = await startMonocularLightInjection(env.canvas);
    try {
        const pending = host.captureSnapshot();
        assert.equal(host.captureSnapshot(), pending);
        await assertPending(pending);
        const compile = deferPipelineCreation(env.device);
        download.resolve();
        await until(() => host.getState().status.startsWith('Compiling'));
        await assertPending(pending);
        compile();
        await until(() => host.getState().status === 'Preparing demo…');
        await assertPending(pending);
        photo.resolve();
        await until(() => decoding);
        await assertPending(pending);
        decode.resolve();
        await until(() => !host.getState().busy);
        await assertPending(pending);
        env.frame();
        assert.deepEqual((await pending)!.graph.nodes.map((node) => node.label), [
            'monocular-light-injection.depth', 'monocular-light-injection.relight',
        ]);
        const stable = host.captureSnapshot();
        env.frame();
        assert.deepEqual((await stable)!.graph.nodes.map((node) => node.label), ['monocular-light-injection.relight']);
    } finally { host.dispose(); env.restore(); }
});

test('waiting captures follow the latest source and ignore stale upload failures', async () => {
    const env = hostEnvironment();
    const host = await startMonocularLightInjection(env.canvas);
    try {
        await until(() => !host.getState().busy && host.getState().ready);
        env.frame();
        const stale = deferred<ImageBitmap>();
        const latest = deferred<ImageBitmap>();
        const createBitmap = globalThis.createImageBitmap;
        const nextBitmap = await createBitmap(new Blob());
        globalThis.createImageBitmap = (() => stale.promise) as typeof createBitmap;
        const oldUpload = host.uploadImage(new Blob());
        const pending = host.captureSnapshot();
        env.frame(); // The previous image may render, but must not fulfill this request.
        await assertPending(pending);
        await host.selectSource('demo');
        globalThis.createImageBitmap = (() => latest.promise) as typeof createBitmap;
        const newUpload = host.uploadImage(new Blob());
        stale.reject(new Error('obsolete decode failure'));
        await oldUpload;
        env.frame();
        await assertPending(pending);
        latest.resolve(nextBitmap);
        await newUpload;
        env.frame();
        assert.ok(await pending);
        assert.equal(host.getState().source, 'upload');
        assert.doesNotMatch(host.getState().status, /obsolete/);
    } finally { host.dispose(); env.restore(); }
});

test('upload preparation excludes model replacement and releases the previous image', async () => {
    const env = hostEnvironment();
    const host = await startMonocularLightInjection(env.canvas);
    try {
        await until(() => host.getState().ready && !host.getState().busy);
        await host.uploadImage(new Blob());
        env.frame();
        const previous = env.bitmaps.at(-1)!;
        const bitmap = await createImageBitmap(new Blob());
        const decode = deferred<ImageBitmap>();
        globalThis.createImageBitmap = (() => decode.promise) as typeof createImageBitmap;
        const upload = host.uploadImage(new Blob());
        assert.equal(host.getState().busy, true);
        const requests = env.requests.length;
        await host.selectModel('base');
        assert.equal(env.requests.length, requests);
        decode.resolve(bitmap);
        await upload;
        assert.equal(host.getState().busy, false);
        assert.equal(host.getState().model, 'small');
        assert.equal(previous.closeCount, 1);
        host.dispose();
        assert.ok(env.bitmaps.every((image) => image.closeCount === 1));
    } finally { host.dispose(); env.restore(); }
});

test('preparation failure settles capture and a retry can capture its first frame', async () => {
    const env = hostEnvironment();
    const download = deferred<void>();
    const fetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => { await download.promise; return fetch(url, init); }) as typeof fetch;
    env.failModels(true);
    const host = await startMonocularLightInjection(env.canvas);
    try {
        const failed = host.captureSnapshot();
        download.resolve();
        await until(() => !host.getState().busy);
        assert.equal(await failed, undefined);
        assert.equal(await host.captureSnapshot(), undefined);
        env.failModels(false);
        const retry = host.selectModel('small');
        const captured = host.captureSnapshot();
        await retry;
        env.frame();
        assert.ok(await captured);
    } finally { host.dispose(); env.restore(); }
});

test('suspension and disposal settle captures even while preparation is pending', async () => {
    const env = hostEnvironment();
    const download = deferred<void>();
    const fetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => { await download.promise; return fetch(url, init); }) as typeof fetch;
    const host = await startMonocularLightInjection(env.canvas);
    try {
        const hidden = host.captureSnapshot();
        env.browser.dispatchEvent(Object.assign(new env.browser.Event('pagehide'), { persisted: true }));
        assert.equal(await hidden, undefined);
        assert.equal(await host.captureSnapshot(), undefined);
        env.browser.dispatchEvent(Object.assign(new env.browser.Event('pageshow'), { persisted: true }));
        const pending = host.captureSnapshot();
        await assertPending(pending);
        host.dispose();
        assert.equal(await pending, undefined);
        download.resolve();
        await until(() => env.requests.length > 0);
        assert.equal(env.submits, 0);
        assert.equal(env.destroyed, 1);
    } finally { host.dispose(); env.restore(); }
});

for (const stage of ['compilation', 'photo', 'submission'] as const) {
    test(`${stage} failure settles the first capture and retains retry behavior`, async () => {
        const env = hostEnvironment();
        const download = deferred<void>();
        const fetch = globalThis.fetch;
        globalThis.fetch = (async (url, init) => { await download.promise; return fetch(url, init); }) as typeof fetch;
        const host = await startMonocularLightInjection(env.canvas);
        const compile = env.device.createComputePipelineAsync;
        try {
            if (stage === 'compilation') env.device.createComputePipelineAsync = async () => { throw new Error('Compile failed'); };
            if (stage === 'photo') env.failPhoto(true);
            const pending = host.captureSnapshot();
            download.resolve();
            await until(() => !host.getState().busy);
            if (stage === 'submission') { env.failNextSubmit(); env.frame(); }
            assert.equal(await pending, undefined);
            env.device.createComputePipelineAsync = compile;
            env.failPhoto(false);
            const retry = stage === 'compilation' ? host.selectModel('small')
                : stage === 'photo' ? host.selectSource('demo') : Promise.resolve();
            const captured = host.captureSnapshot();
            await retry;
            env.frame();
            assert.equal((await captured)!.graph.nodes.length, 2);
        } finally { host.dispose(); env.restore(); }
    });
}

test('camera preparation holds capture and obsolete camera failure cannot cancel it', async () => {
    const env = hostEnvironment();
    const permission = deferred<MediaStream>();
    Object.defineProperty(env.browser.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => permission.promise } });
    const host = await startMonocularLightInjection(env.canvas);
    try {
        await until(() => host.getState().ready && !host.getState().busy);
        env.frame();
        const camera = host.selectSource('camera');
        const pending = host.captureSnapshot();
        env.frame();
        await assertPending(pending);
        await host.selectSource('demo');
        permission.reject(new Error('obsolete permission denial'));
        await camera;
        await assertPending(pending);
        env.frame();
        assert.ok(await pending);
        assert.equal(host.getState().source, 'demo');
    } finally { host.dispose(); env.restore(); }
});

test('camera capture waits through permission and playback until a real video frame', async () => {
    const env = hostEnvironment();
    const permission = deferred<MediaStream>();
    const playback = deferred<void>();
    Object.defineProperty(env.browser.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => permission.promise } });
    const host = await startMonocularLightInjection(env.canvas);
    let stopped = 0;
    try {
        await until(() => host.getState().ready && !host.getState().busy);
        env.frame();
        const video = env.browser.document.querySelector('video')!;
        Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: null });
        let videoFrame: VideoFrameRequestCallback | undefined;
        Object.assign(video, {
            play: () => playback.promise, pause() {},
            requestVideoFrameCallback(callback: VideoFrameRequestCallback) { videoFrame = callback; return 1; },
            cancelVideoFrameCallback() { videoFrame = undefined; },
        });
        const camera = host.selectSource('camera');
        const pending = host.captureSnapshot();
        await assertPending(pending);
        const track = { stop() { stopped++; }, addEventListener() {} };
        permission.resolve({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream);
        await assertPending(pending);
        playback.resolve();
        await camera;
        await assertPending(pending);
        assert.ok(videoFrame);
        videoFrame(0, { width: 320, height: 180 } as VideoFrameCallbackMetadata);
        assert.equal((await pending)!.graph.nodes.length, 2);
        host.dispose();
        assert.equal(stopped, 1);
    } finally { host.dispose(); env.restore(); }
});

test('host submits depth once, retries discarded depth, captures real stable frames and disposes', async () => {
    const env = hostEnvironment();
    const errors: Error[] = [];
    try {
        const host = await startMonocularLightInjection(env.canvas, { onError: (error) => errors.push(error) });
        await until(() => host.getState().ready && !host.getState().busy);
        env.failNextSubmit(); env.frame();
        assert.match(errors[0]!.message, /Submission failed/);
        env.frame();
        assert.equal(env.canvas.dataset.frameGraphPasses, '2');
        assert.equal(env.submits, 1);
        const snapshot = host.captureSnapshot();
        env.frame();
        const captured = await snapshot;
        assert.ok(captured);
        assert.equal(env.canvas.dataset.frameGraphPasses, '1');
        assert.equal(env.closedFrames, 3);
        const hiddenCapture = host.captureSnapshot();
        env.browser.dispatchEvent(Object.assign(new env.browser.Event('pagehide'), { persisted: true }));
        assert.equal(await hiddenCapture, undefined);
        env.browser.dispatchEvent(Object.assign(new env.browser.Event('pageshow'), { persisted: true }));
        env.frame();
        assert.equal(env.submits, 3);
        const pending = host.captureSnapshot();
        host.dispose(); host.dispose();
        assert.equal(await pending, undefined);
        assert.equal(env.destroyed, 1);
        assert.equal(env.unconfigured, 1);
        assert.ok(env.bitmaps.every((bitmap) => bitmap.closeCount === 1));
    } finally { env.restore(); }
});

test('model and photo errors remain recoverable, f32 fallback and atomic replacement are retained', async () => {
    const env = hostEnvironment();
    env.failModels(true);
    try {
        const host = await startMonocularLightInjection(env.canvas);
        await until(() => !host.getState().busy);
        assert.equal(host.getState().ready, false);
        assert.match(host.getState().status, /503/);
        assert.equal(await host.captureSnapshot(), undefined);
        env.failModels(false); env.failPhoto(true);
        await host.selectModel('small');
        assert.match(host.getState().status, /404/);
        assert.ok(env.requests[0]!.includes('-f32.depthart'));
        env.failPhoto(false);
        await host.selectSource('demo'); env.frame();
        env.failModels(true);
        await host.selectModel('base');
        assert.equal(host.getState().model, 'small');
        assert.equal(host.getState().ready, true);
        env.frame();
        assert.equal(env.submits, 2);
        assert.match(host.getState().status, /503/);
        await host.selectModel('large');
        assert.match(host.getState().status, /shader-f16/);
        host.dispose();
    } finally { env.restore(); }
});

test('abort during download cancels network and releases initialized resources', async () => {
    const env = hostEnvironment();
    let networkAborted = false;
    let networkStarted = false;
    globalThis.fetch = ((_url, init) => new Promise((_resolve, reject) => {
        networkStarted = true;
        init!.signal!.addEventListener('abort', () => { networkAborted = true; reject(new Error('aborted')); });
    })) as typeof fetch;
    try {
        const abort = new AbortController();
        const host = await startMonocularLightInjection(env.canvas, { signal: abort.signal });
        await until(() => networkStarted);
        abort.abort();
        assert.equal(networkAborted, true);
        assert.equal(env.destroyed, 1);
        assert.equal(await host.captureSnapshot(), undefined);
    } finally { env.restore(); }
});

test('stale decoded uploads cannot replace a newer source or survive disposal', async () => {
    const env = hostEnvironment();
    try {
        const host = await startMonocularLightInjection(env.canvas);
        await until(() => host.getState().ready && !host.getState().busy);
        let resolve!: (value: ImageBitmap) => void;
        globalThis.createImageBitmap = (() => new Promise<ImageBitmap>((done) => { resolve = done; })) as typeof createImageBitmap;
        let closed = 0;
        const bitmap = { close() { closed++; } } as ImageBitmap;
        const upload = host.uploadImage(new Blob(['image']));
        await host.selectSource('demo');
        resolve(bitmap); await upload;
        assert.equal(closed, 1);
        assert.equal(host.getState().source, 'demo');
        const second = host.uploadImage(new Blob(['image']));
        host.dispose(); resolve(bitmap); await second;
        assert.equal(closed, 2);
    } finally { env.restore(); }
});
