/** Cancel preparation promptly; dispose any resource that arrives after cancellation. */
export function prepare<T>(promise: Promise<T>, signal: AbortSignal | undefined,
    releaseLate: (value: T) => void, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown, value?: T) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error !== undefined) reject(error); else resolve(value as T);
        };
        const abort = () => finish(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('PlayCanvas preparation timed out. Retry the example.')), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        promise.then(value => { if (settled) releaseLate(value); else finish(undefined, value); }, error => finish(error));
        if (signal?.aborted) abort();
    });
}
