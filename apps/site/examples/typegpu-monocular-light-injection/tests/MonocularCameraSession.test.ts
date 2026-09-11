import assert from 'node:assert/strict';
import test from 'node:test';
import { MonocularCameraSession } from '../src/camera-session.ts';

interface FakeStream extends MediaStream {
    readonly stopped: () => boolean;
}

function fakeStream(): FakeStream {
    let didStop = false;
    const track = {
        stop() { didStop = true; },
        addEventListener() {},
    };
    return {
        getTracks: () => [track],
        getVideoTracks: () => [track],
        stopped: () => didStop,
    } as unknown as FakeStream;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function installCameraGlobals(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>): () => void {
    const target = globalThis as Record<string, unknown>;
    const previous = {
        navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
        screen: Object.getOwnPropertyDescriptor(globalThis, 'screen'),
        requestAnimationFrame: target.requestAnimationFrame,
        cancelAnimationFrame: target.cancelAnimationFrame,
    };
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { userAgent: '', mediaDevices: { getUserMedia } },
    });
    Object.defineProperty(globalThis, 'screen', {
        configurable: true,
        value: { orientation: { type: 'landscape-primary' } },
    });
    target.requestAnimationFrame = () => 1;
    target.cancelAnimationFrame = () => undefined;
    return () => {
        if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
        else delete target.navigator;
        if (previous.screen) Object.defineProperty(globalThis, 'screen', previous.screen);
        else delete target.screen;
        target.requestAnimationFrame = previous.requestAnimationFrame;
        target.cancelAnimationFrame = previous.cancelAnimationFrame;
    };
}

function fakeVideo(play: () => Promise<void> = async () => undefined): HTMLVideoElement {
    return {
        srcObject: null,
        videoWidth: 1280,
        videoHeight: 720,
        play,
        pause() {},
    } as unknown as HTMLVideoElement;
}

test('camera replacement keeps the old stream until the candidate is ready', async () => {
    const first = fakeStream();
    const second = fakeStream();
    const candidate = deferred<MediaStream>();
    let calls = 0;
    const restore = installCameraGlobals(async () => ++calls === 1 ? first : candidate.promise);
    try {
        const session = new MonocularCameraSession(fakeVideo(), { onFrame() {} }, 'user');
        assert.equal(await session.start('user'), true);
        const replacing = session.start('environment');
        assert.equal(first.stopped(), false);
        assert.equal(session.facingMode, 'user');
        candidate.resolve(second);
        assert.equal(await replacing, true);
        assert.equal(first.stopped(), true);
        assert.equal(second.stopped(), false);
        assert.equal(session.facingMode, 'environment');
        session.destroy();
        assert.equal(second.stopped(), true);
    } finally {
        restore();
    }
});

test('failed camera replacement restores the old stream and facing mode', async () => {
    const first = fakeStream();
    const second = fakeStream();
    let calls = 0;
    const video = fakeVideo(async () => {
        if (video.srcObject === second) throw new Error('play failed');
    });
    const restore = installCameraGlobals(async () => ++calls === 1 ? first : second);
    try {
        const session = new MonocularCameraSession(video, { onFrame() {} }, 'user');
        assert.equal(await session.start('user'), true);
        await assert.rejects(session.start('environment'), /play failed/);
        assert.equal(first.stopped(), false);
        assert.equal(second.stopped(), true);
        assert.equal(video.srcObject, first);
        assert.equal(session.facingMode, 'user');
        session.destroy();
    } finally {
        restore();
    }
});

test('only the latest camera request can commit its candidate stream', async () => {
    const firstRequest = deferred<MediaStream>();
    const secondRequest = deferred<MediaStream>();
    const first = fakeStream();
    const second = fakeStream();
    let calls = 0;
    const restore = installCameraGlobals(() => ++calls === 1 ? firstRequest.promise : secondRequest.promise);
    try {
        const session = new MonocularCameraSession(fakeVideo(), { onFrame() {} }, 'user');
        const firstStart = session.start('user');
        const secondStart = session.start('environment');
        firstRequest.resolve(first);
        assert.equal(await firstStart, false);
        assert.equal(first.stopped(), true);
        secondRequest.resolve(second);
        assert.equal(await secondStart, true);
        assert.equal(session.facingMode, 'environment');
        session.destroy();
    } finally {
        restore();
    }
});
