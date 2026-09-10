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
.zenfg-inspector-inline-action,
.zenfg-inspector-copy-id button,
.zenfg-inspector-raw-toolbar button,
.zenfg-inspector-capture-summary section > button,
.zenfg-inspector-graph-search-results > button {
	padding: 5px var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text-secondary); background: var(--fgd-surface);
	font: var(--fgd-font-size)/1.4 var(--fgd-font-ui); cursor: pointer;
}
.zenfg-inspector-inline-action:hover,
.zenfg-inspector-copy-id button:hover,
.zenfg-inspector-raw-toolbar button:hover,
.zenfg-inspector-capture-summary section > button:hover,
.zenfg-inspector-graph-search-results > button:hover { color: var(--fgd-text); background: var(--fgd-surface-hover); }
.zenfg-inspector-raw-toolbar input {
	padding: 6px var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text); background: var(--fgd-panel); font: var(--fgd-font-size) var(--fgd-font-ui);
}
.zenfg-inspector-inspector-summary dd,
.zenfg-inspector-relation-entry,
.zenfg-inspector-detail-diagnostics { min-width: 0; overflow-wrap: anywhere; }
.zenfg-inspector-inspector-summary { grid-template-columns: 108px minmax(0, 1fr); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-inspector-summary dd { font-family: var(--fgd-font-ui); }
.zenfg-inspector-inspector-relations .zenfg-inspector-relation-button,
.zenfg-inspector-relation-entry > span { font: var(--fgd-font-size)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-relation-links .zenfg-inspector-relation-button { flex: 1 1 130px; min-width: 0; }
.zenfg-inspector-relation-links .zenfg-inspector-inline-action { flex: 0 0 auto; }
.zenfg-inspector-copy-id code { overflow-wrap: anywhere; }
.zenfg-inspector-inspector-content > details { margin-top: 14px; }
.zenfg-inspector-inspector-content summary { cursor: pointer; }
.zenfg-inspector-inspector-content h3 { font-size: var(--fgd-font-size-small); margin: 14px 0 6px; }
.zenfg-inspector-detail-diagnostics article { padding: var(--fgd-space-2) 0; border-bottom: 1px solid var(--fgd-border); }
.zenfg-inspector-detail-diagnostics p { margin: 6px 0; white-space: pre-wrap; }
.zenfg-inspector-detail-diagnostics article[data-severity="error"] > strong { color: var(--fgd-danger); }
.zenfg-inspector-detail-diagnostics article[data-severity="warning"] > strong { color: var(--fgd-warning); }
.zenfg-inspector-raw-view { min-width: 0; display: grid; gap: 10px; }
.zenfg-inspector-raw-path { overflow-wrap: anywhere; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-raw-toolbar input { flex: 1 1 170px; min-width: 0; }
.zenfg-inspector-inspector .zenfg-inspector-raw-detail { white-space: normal; overflow: visible; overflow-wrap: anywhere; font: var(--fgd-font-size-small)/1.55 var(--fgd-font-mono); }
.zenfg-inspector-raw-children { padding-left: var(--fgd-space-3); border-left: 1px solid var(--fgd-border); }
.zenfg-inspector-raw-detail summary, .zenfg-inspector-raw-leaf { padding: 3px 0; }
.zenfg-inspector-inspector-content :is(button, input, summary):focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
`;
