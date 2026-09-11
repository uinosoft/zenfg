import assert from 'node:assert/strict';
import test from 'node:test';
import {
    cachingEnabled,
    clearDownloads,
    fetchModel,
    isModelCached,
    modelVariant,
    setCachingEnabled,
} from '../src/model-store.ts';

const variant = modelVariant('small', true)!;

function bytes(...values: number[]): ArrayBuffer {
    return new Uint8Array(values).buffer;
}

function response(body: ArrayBuffer): Response {
    return {
        ok: true,
        status: 200,
        arrayBuffer: async () => body,
        clone: () => response(body.slice(0)),
    } as Response;
}

function installGlobals(options: {
    readonly cache: Partial<Cache>;
    readonly fetch?: typeof fetch;
    readonly cacheDisabled?: boolean;
    readonly openError?: unknown;
    readonly deleteError?: unknown;
}): () => void {
    const target = globalThis as Record<string, unknown>;
    const previous = {
        caches: target.caches,
        fetch: target.fetch,
        localStorage: target.localStorage,
    };
    target.localStorage = {
        getItem: () => options.cacheDisabled ? '1' : null,
        setItem() {},
        removeItem() {},
    };
    target.caches = {
        async open() {
            if (options.openError) throw options.openError;
            return options.cache;
        },
        async delete() {
            if (options.deleteError) throw options.deleteError;
            return true;
        },
    };
    target.fetch = options.fetch ?? (async () => { throw new Error('unexpected network request'); });
    return () => Object.assign(target, previous);
}

test('disabled cache still serves existing hits but does not write downloads', async () => {
    let putCount = 0;
    const hit = bytes(1, 2, 3);
    const restore = installGlobals({
        cacheDisabled: true,
        cache: {
            match: async () => response(hit),
            put: async () => { putCount += 1; },
        },
    });
    try {
        assert.equal(cachingEnabled(), false);
        assert.deepEqual(new Uint8Array(await fetchModel(variant, new AbortController().signal)), new Uint8Array(hit));
        assert.equal(putCount, 0);
    } finally {
        restore();
    }
});

test('cache read failures fall back to the network', async () => {
    const downloaded = bytes(4, 5, 6);
    let fetchCount = 0;
    const restore = installGlobals({
        cacheDisabled: true,
        cache: {
            match: async () => ({ arrayBuffer: async () => { throw new Error('broken body'); } }) as unknown as Response,
        },
        fetch: async () => {
            fetchCount += 1;
            return response(downloaded);
        },
    });
    try {
        assert.deepEqual(new Uint8Array(await fetchModel(variant, new AbortController().signal)), new Uint8Array(downloaded));
        assert.equal(fetchCount, 1);
    } finally {
        restore();
    }
});

test('cache open and put failures remain best-effort', async () => {
    const downloaded = bytes(7, 8, 9);
    let fetchCount = 0;
    let restore = installGlobals({
        cache: {},
        openError: new Error('cache unavailable'),
        fetch: async () => {
            fetchCount += 1;
            return response(downloaded);
        },
    });
    try {
        assert.deepEqual(new Uint8Array(await fetchModel(variant, new AbortController().signal)), new Uint8Array(downloaded));
    } finally {
        restore();
    }

    restore = installGlobals({
        cache: {
            match: async () => undefined,
            put: async () => { throw new Error('quota exceeded'); },
        },
        fetch: async () => {
            fetchCount += 1;
            return response(downloaded);
        },
    });
    try {
        assert.deepEqual(new Uint8Array(await fetchModel(variant, new AbortController().signal)), new Uint8Array(downloaded));
        assert.equal(fetchCount, 2);
    } finally {
        restore();
    }
});

test('cache status and clear tolerate unavailable Cache Storage', async () => {
    const restore = installGlobals({
        cache: {},
        openError: new Error('unavailable'),
        deleteError: new Error('unavailable'),
    });
    try {
        assert.equal(await isModelCached(variant), false);
        await assert.doesNotReject(clearDownloads());
        assert.doesNotThrow(() => setCachingEnabled(false));
    } finally {
        restore();
    }
});
