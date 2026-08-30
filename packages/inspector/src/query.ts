export const ZENFG_INSPECTOR_QUERY_PARAM = 'fg';

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
