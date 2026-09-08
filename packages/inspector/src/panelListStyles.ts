/** Content-width layout and message styles for the diagnostic workbench lists. */
export const PANEL_LIST_CSS = `
.zenfg-inspector-view-toolbar[hidden],
.zenfg-inspector-subview[hidden],
.zenfg-inspector-list-context[hidden] { display: none; }
.zenfg-inspector-result-count {
	color: var(--fgd-muted);
	white-space: nowrap;
	font: 12px/1.4 var(--fgd-font-ui);
}
.zenfg-inspector-list-context {
	flex: 0 0 auto;
	margin: 0;
	padding: 7px 10px;
	border-bottom: 1px solid var(--fgd-border-subtle);
	color: var(--fgd-muted);
	font: 12px/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-view-toolbar button {
	min-height: 28px;
	padding: 4px 8px;
	border: 1px solid var(--fgd-border);
	border-radius: 5px;
	background: var(--fgd-panel);
	color: var(--fgd-text-secondary);
	font: 12px/1.3 var(--fgd-font-ui);
	cursor: pointer;
}
.zenfg-inspector-view-toolbar button:hover { background: var(--fgd-surface-hover); }
.zenfg-inspector-view-toolbar input,
.zenfg-inspector-view-toolbar select { font-size: 12px; }
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table {
	min-width: 580px;
	border-collapse: separate;
	border-spacing: 0;
	font: 12px/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table [data-column='numeric'],
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table [data-column='numeric'] {
	font-family: var(--fgd-font-mono);
}
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table th:first-child,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table th:first-child,
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table td:first-child,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:first-child {
	position: sticky;
	left: 0;
	max-width: 290px;
	background: var(--fgd-canvas);
	z-index: 1;
}
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table th:first-child,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table th:first-child {
	z-index: 3;
	background: var(--fgd-panel);
}
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table tr.selected td:first-child,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table tr.selected td:first-child {
	background: color-mix(in srgb, var(--fgd-accent) 12%, var(--fgd-canvas));
}
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table tbody tr:hover td:first-child,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table tbody tr:hover td:first-child {
	background: var(--fgd-surface-hover);
}
.zenfg-inspector-passes-view .zenfg-inspector-group-toggle { margin-right: 5px; }
.zenfg-inspector-diagnostics-view { display: flex; flex-direction: column; }
.zenfg-inspector-diagnostics-view .zenfg-inspector-diagnostics-scroller {
	flex: 1 1 auto;
	min-height: 0;
	height: auto;
}
.zenfg-inspector-diagnostics-sections {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding: 14px;
	min-width: 0;
}
.zenfg-inspector-diagnostic-messages > h2 { margin: 0; font: 600 14px/1.5 var(--fgd-font-ui); }
.zenfg-inspector-diagnostic-messages > p,
.zenfg-inspector-diagnostic-section > p {
	margin: 5px 0 10px;
	color: var(--fgd-muted);
	font: 12px/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-message {
	--diagnostic-color: var(--fgd-accent);
	margin-top: 9px;
	padding: 10px 12px;
	border-left: 3px solid var(--diagnostic-color);
	background: var(--fgd-surface);
	overflow-wrap: anywhere;
}
.zenfg-inspector-diagnostic-message[data-severity='error'] { --diagnostic-color: var(--fgd-danger); }
.zenfg-inspector-diagnostic-message[data-severity='warning'] { --diagnostic-color: var(--fgd-warning); }
.zenfg-inspector-diagnostic-message h3 {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin: 0;
	font: 600 12px/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-severity { color: var(--diagnostic-color); text-transform: capitalize; }
.zenfg-inspector-diagnostic-message code { font: 12px/1.5 var(--fgd-font-mono); }
.zenfg-inspector-diagnostic-message p { margin: 6px 0; white-space: pre-wrap; font: 13px/1.55 var(--fgd-font-ui); }
.zenfg-inspector-diagnostic-links {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: 5px 12px;
	min-width: 0;
	margin-top: 4px;
}
.zenfg-inspector-diagnostic-links .zenfg-inspector-relation-button {
	min-width: 0;
	max-width: 100%;
	white-space: normal;
	overflow-wrap: anywhere;
	text-align: left;
	font: 12px/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-reveal { color: var(--fgd-muted); }
.zenfg-inspector-diagnostic-section {
	min-width: 0;
	padding: 10px 0 0;
	border-top: 1px solid var(--fgd-border-subtle);
	overflow-wrap: anywhere;
}
.zenfg-inspector-diagnostic-section > summary {
	padding: 3px 0;
	font: 600 13px/1.5 var(--fgd-font-ui);
	cursor: pointer;
}
.zenfg-inspector-diagnostic-section > .zenfg-inspector-diagnostic-section { margin: 8px 0 0 12px; }
.zenfg-inspector-diagnostic-section .zenfg-inspector-diagnostic-list { overflow: visible; padding: 4px 0; }
.zenfg-inspector-diagnostic-section ul { padding-left: 20px; }
.zenfg-inspector-diagnostic-section > .zenfg-inspector-relation-button { margin: 5px 0; }
.zenfg-inspector-diagnostic-links .selected { background: var(--fgd-accent-soft); }
.zenfg-inspector-diagnostic-section summary:focus-visible,
.zenfg-inspector-view-toolbar button:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
@container zenfg-inspector-main (max-width: 640px) {
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table { min-width: 420px; }
	.zenfg-inspector-passes-view [id$='pass-list-panel'] tr > :nth-child(3),
	.zenfg-inspector-passes-view [id$='pass-list-panel'] tr > :nth-child(6),
	.zenfg-inspector-passes-view [id$='group-list-panel'] tr > :nth-child(5),
	.zenfg-inspector-passes-view [id$='group-list-panel'] tr > :nth-child(6),
	.zenfg-inspector-resources-view tr > :nth-child(4),
	.zenfg-inspector-resources-view tr > :nth-child(5) { display: none; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table td:first-child,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:first-child { max-width: 190px; }
}
`;
