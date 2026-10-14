// VitePress serializes this standalone function for both the build-time index
// and browser queries. Han characters also support partial technical terms.
export function tokenize(text) {
    return text.match(/[\p{Script=Han}]|[A-Za-z0-9_@./:-]+/gu) ?? [];
}
