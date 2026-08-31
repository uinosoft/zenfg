/** Query-string flag recognized by {@link isZenFGInspectorRequested}. */
export const ZENFG_INSPECTOR_QUERY_PARAM = 'fg';

/**
 * Reports whether a URL contains the `fg` inspector opt-in parameter.
 *
 * @param href - Absolute URL accepted by `URL`; defaults to the current page
 * URL when a browser location is available.
 * @returns `false` when no URL is available or the supplied URL is invalid.
 */
export function isZenFGInspectorRequested(href = globalThis.location?.href): boolean {
    if (!href) {
        return false;
    }

    try {
        return new URL(href).searchParams.has(ZENFG_INSPECTOR_QUERY_PARAM);
    }
    catch {
        return false;
    }
}
