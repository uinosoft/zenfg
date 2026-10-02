export const PANEL_DETAIL_CSS = `
.zenfg-inspector-detail-actions,
.zenfg-inspector-relation-links,
.zenfg-inspector-copy-id,
.zenfg-inspector-raw-toolbar {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px 10px;
	min-width: 0;
}
.zenfg-inspector-detail-actions { margin-bottom: var(--fgd-space-3); }
.zenfg-inspector-detail-actions:empty { display: none; }
.zenfg-inspector-detail-actions > .zenfg-inspector-inline-action {
	display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.zenfg-inspector-detail-identity { display: grid; gap: 6px; min-width: 0; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-detail-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.zenfg-inspector-detail-tag { padding: 2px 6px; border: 1px solid var(--fgd-border-subtle); border-radius: var(--fgd-radius-sm); color: var(--fgd-text-secondary); background: var(--fgd-surface); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-detail-tag[data-tone='culled'] { color: var(--fgd-muted); }
.zenfg-inspector-detail-summary { display: grid; gap: 12px; min-width: 0; }
.zenfg-inspector-detail-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.zenfg-inspector-detail-metric { min-width: 0; display: grid; align-content: start; gap: 5px; padding: 10px; border: 1px solid var(--fgd-border-subtle); border-radius: var(--fgd-radius-sm); background: var(--fgd-surface); }
.zenfg-inspector-detail-metric:only-child { grid-column: 1 / -1; }
.zenfg-inspector-detail-metric-label { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-detail-metric > strong { color: var(--fgd-text); font: 600 20px/1.3 var(--fgd-font-mono); overflow-wrap: anywhere; }
.zenfg-inspector-detail-metric[data-state='unavailable'] > strong { font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-detail-metric-unit { color: var(--fgd-text-secondary); font: 400 var(--fgd-font-size-small)/1.3 var(--fgd-font-ui); }
.zenfg-inspector-detail-metric > small { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-inline-action,
.zenfg-inspector-capture-summary section > button,
.zenfg-inspector-graph-search-results > button {
	padding: 5px var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text-secondary); background: var(--fgd-surface);
	font: var(--fgd-font-size)/1.4 var(--fgd-font-ui); cursor: pointer;
}
.zenfg-inspector-inline-action:hover,
.zenfg-inspector-capture-summary section > button:hover,
.zenfg-inspector-graph-search-results > button:hover { color: var(--fgd-text); background: var(--fgd-surface-hover); }
.zenfg-inspector-raw-toolbar input {
	padding: 6px var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text); background: var(--fgd-panel); font: var(--fgd-font-size) var(--fgd-font-ui);
}
.zenfg-inspector-inspector-summary dd,
.zenfg-inspector-relation-entry,
.zenfg-inspector-detail-diagnostics { min-width: 0; overflow-wrap: anywhere; }
.zenfg-inspector-inspector-summary { grid-template-columns: 88px minmax(0, 1fr); gap: 5px 10px; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-inspector-summary dd { font-family: var(--fgd-font-ui); }
.zenfg-inspector-inspector-relations .zenfg-inspector-relation-button,
.zenfg-inspector-relation-entry > span { font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-relation-entry { width: 100%; min-width: 0; padding: 5px 0; gap: 3px; }
.zenfg-inspector-relation-links { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px; width: 100%; }
.zenfg-inspector-relation-links .zenfg-inspector-relation-button {
	min-width: 0; width: 100%; text-align: left;
	display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.zenfg-inspector-copy-id { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; }
.zenfg-inspector-copy-id code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); }
.zenfg-inspector-detail-copy-status { grid-column: 1 / -1; color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-detail-copy-status:empty { display: none; }
.zenfg-inspector-detail-section { min-width: 0; border-top: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-detail-section > summary { padding: 8px 0; color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-detail-section > .zenfg-inspector-inspector-summary { margin-top: 4px; }
.zenfg-inspector-inspector-content summary { cursor: pointer; }
.zenfg-inspector-inspector-content h3 { font-size: var(--fgd-font-size-small); margin: 14px 0 6px; }
.zenfg-inspector-inspector-relations h3 { margin: 0 0 2px; text-transform: none; letter-spacing: 0; }
.zenfg-inspector-detail-section .zenfg-inspector-relation-links { gap: 6px; }
.zenfg-inspector-detail-diagnostics { min-width: 0; }
.zenfg-inspector-detail-diagnostics > h3 { margin: 0 0 6px; }
.zenfg-inspector-detail-diagnostics article { padding: var(--fgd-space-2) 0; border-bottom: 1px solid var(--fgd-border); }
.zenfg-inspector-detail-diagnostics p { margin: 6px 0; white-space: pre-wrap; }
.zenfg-inspector-detail-diagnostics article[data-severity="error"] > strong { color: var(--fgd-danger); }
.zenfg-inspector-detail-diagnostics article[data-severity="warning"] > strong { color: var(--fgd-warning); }
.zenfg-inspector-raw-view { min-width: 0; display: grid; gap: 10px; }
.zenfg-inspector-raw-path { overflow-wrap: anywhere; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-raw-toolbar { flex-wrap: nowrap; gap: 8px; }
.zenfg-inspector-raw-toolbar input { flex: 1 1 0; min-width: 0; width: 100%; }
.zenfg-inspector-inspector .zenfg-inspector-raw-detail { white-space: normal; overflow: visible; overflow-wrap: anywhere; font: var(--fgd-font-size-small)/1.55 var(--fgd-font-mono); }
.zenfg-inspector-raw-children { padding-left: var(--fgd-space-3); border-left: 1px solid var(--fgd-border); }
.zenfg-inspector-raw-detail summary, .zenfg-inspector-raw-leaf { padding: 3px 0; }
.zenfg-inspector-raw-match { color: var(--fgd-text); background: var(--fgd-accent-soft); border-radius: 2px; }
.zenfg-inspector-inspector-content :is(button, input, summary):focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
`;
