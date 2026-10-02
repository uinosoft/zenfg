export const PANEL_DIAGNOSTICS_CSS = `
.zenfg-inspector-diagnostic-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	min-width: 0;
}
.zenfg-inspector-diagnostic-filters button { white-space: nowrap; }
.zenfg-inspector-diagnostic-filters button[aria-pressed='true'] {
	border-color: var(--fgd-accent);
	color: var(--fgd-accent);
	background: var(--fgd-accent-soft);
}
.zenfg-inspector-diagnostic-filters button[data-severity='error'] { color: var(--fgd-danger); }
.zenfg-inspector-diagnostic-filters button[data-severity='warning'] { color: var(--fgd-warning); }
.zenfg-inspector-diagnostics-sections { gap: 20px; }
.zenfg-inspector-diagnostics-sections h2 { margin: 0 0 12px; font-size: var(--fgd-font-size); }
.zenfg-inspector-diagnostic-compilation {
	border-top: 1px solid var(--fgd-border-subtle);
	padding-top: 16px;
}
.zenfg-inspector-diagnostic-message { margin-top: 8px; padding: 12px; }
.zenfg-inspector-diagnostic-message h3 { gap: 8px; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-diagnostic-message h3 code { overflow-wrap: anywhere; }
.zenfg-inspector-diagnostic-message p { margin: 8px 0; }
.zenfg-inspector-diagnostic-links {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 30px;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding-top: 6px;
	max-width: 100%;
}
.zenfg-inspector-diagnostic-object { display: grid; gap: 2px; min-width: 0; }
.zenfg-inspector-diagnostic-object .zenfg-inspector-relation-button {
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	max-width: 100%;
	text-align: left;
	white-space: normal;
	overflow-wrap: anywhere;
}
.zenfg-inspector-diagnostic-object small { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-diagnostic-links .zenfg-inspector-diagnostic-reveal { flex: 0 0 30px; }
.zenfg-inspector-diagnostic-compilation .zenfg-inspector-diagnostic-section:first-of-type { margin-top: 0; }
@container zenfg-inspector-main (max-width: 599px) {
	.zenfg-inspector-diagnostics-sections { padding: 12px; }
	.zenfg-inspector-diagnostics-view .zenfg-inspector-view-toolbar { align-items: flex-start; }
	.zenfg-inspector-diagnostic-filters { flex-basis: 100%; }
}
`;
