/** Content-width layout and message styles for the diagnostic workbench lists. */
export const PANEL_LIST_CSS = `
.zenfg-inspector-view-toolbar[hidden],
.zenfg-inspector-subview[hidden],
.zenfg-inspector-list-context[hidden] { display: none; }
.zenfg-inspector-result-count {
	color: var(--fgd-muted);
	white-space: nowrap;
	font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui);
}
.zenfg-inspector-list-context {
	flex: 0 0 auto;
	max-height: 144px;
	overflow: auto;
	margin: 0;
	padding: 7px 10px;
	border-bottom: 1px solid var(--fgd-border-subtle);
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-list-coverage { display: flex; flex-wrap: wrap; gap: 5px 18px; }
.zenfg-inspector-list-notes { min-width: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-list-notes > summary { width: fit-content; padding: 3px 0; color: var(--fgd-text-secondary); cursor: pointer; }
.zenfg-inspector-list-notes > p { margin: 5px 0; max-width: 90ch; overflow-wrap: anywhere; }
.zenfg-inspector-resource-notes { flex: 0 0 auto; max-height: 110px; overflow: auto; padding: 4px 10px; border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-view-toolbar button {
	min-height: var(--fgd-control-height);
	padding: var(--fgd-space-1) var(--fgd-space-2);
	border: 1px solid var(--fgd-border);
	border-radius: var(--fgd-radius-sm);
	background: var(--fgd-panel);
	color: var(--fgd-text-secondary);
	font: var(--fgd-font-size)/1.3 var(--fgd-font-ui);
	cursor: pointer;
}
.zenfg-inspector-view-toolbar button:hover { background: var(--fgd-surface-hover); }
.zenfg-inspector-view-toolbar input,
.zenfg-inspector-view-toolbar select { font-size: var(--fgd-font-size); }
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table {
	min-width: 0;
	table-layout: fixed;
	border-collapse: separate;
	border-spacing: 0;
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-pass-table th:first-child { width: 29%; }
.zenfg-inspector-pass-table th:nth-child(3) { width: 7%; }
.zenfg-inspector-pass-table th:nth-child(7) { width: 8%; }
.zenfg-inspector-group-table th:first-child { width: 25%; }
.zenfg-inspector-passes-view .zenfg-inspector-group-table td:first-child { padding-left: min(calc(8px + var(--fgd-group-depth-offset, 0px)), 100px); }
.zenfg-inspector-group-table th:nth-child(4), .zenfg-inspector-group-table th:nth-child(5) { width: 21%; }
.zenfg-inspector-group-table th:last-child { width: 44px; }
.zenfg-inspector-resource-table th:first-child { width: 38%; }
.zenfg-inspector-resource-table th:nth-child(2) { width: 23%; }
.zenfg-inspector-resource-table th:last-child { width: 11%; }
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-meta,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-meta,
.zenfg-inspector-passes-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-extra,
.zenfg-inspector-resources-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-extra { display: none; }
.zenfg-inspector-passes-view .zenfg-inspector-list-measured,
.zenfg-inspector-resources-view .zenfg-inspector-list-measured { color: var(--fgd-text); font-weight: 600; }
.zenfg-inspector-passes-view .zenfg-inspector-list-unmeasured,
.zenfg-inspector-resources-view .zenfg-inspector-list-unmeasured { color: var(--fgd-muted); }
.zenfg-inspector-pass-table[data-sort='gpu'] [data-timing='gpu'],
.zenfg-inspector-pass-table[data-sort='cpu'] [data-timing='cpu'],
.zenfg-inspector-resource-table[data-sort='size'] td:nth-child(3) { background: color-mix(in srgb, var(--fgd-accent) 5%, var(--fgd-canvas)); }
.zenfg-inspector-group-table .zenfg-inspector-list-row-meta,
.zenfg-inspector-group-table [data-timing] small { font-weight: 400; white-space: normal; }
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
.zenfg-inspector-passes-view .zenfg-inspector-group-toggle,
.zenfg-inspector-group-toggle-spacer {
	display: inline-flex; align-items: center; justify-content: center;
	width: 24px; height: 24px; margin-right: 5px; padding: 0; vertical-align: middle;
}
.zenfg-inspector-passes-view .zenfg-inspector-group-toggle {
	border: 1px solid transparent; border-radius: var(--fgd-radius-sm); background: transparent; color: var(--fgd-text-secondary); cursor: pointer;
}
.zenfg-inspector-group-toggle:hover { border-color: var(--fgd-border); background: var(--fgd-surface-hover); }
.zenfg-inspector-group-toggle:disabled { cursor: default; opacity: 0.5; }
.zenfg-inspector-list-locate-cell { text-align: center !important; }
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
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-message {
	--diagnostic-color: var(--fgd-accent);
	margin-top: 9px;
	padding: 10px var(--fgd-space-3);
	border-left: 3px solid var(--diagnostic-color);
	background: var(--fgd-surface);
	overflow-wrap: anywhere;
}
.zenfg-inspector-diagnostic-message[data-severity='error'] { --diagnostic-color: var(--fgd-danger); }
.zenfg-inspector-diagnostic-message[data-severity='warning'] { --diagnostic-color: var(--fgd-warning); }
.zenfg-inspector-diagnostic-message h3 {
	display: flex;
	flex-wrap: wrap;
	gap: var(--fgd-space-2);
	margin: 0;
	font: 600 var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-severity { color: var(--diagnostic-color); text-transform: capitalize; }
.zenfg-inspector-diagnostic-message code { font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); }
.zenfg-inspector-diagnostic-message p { margin: 6px 0; white-space: pre-wrap; font: var(--fgd-font-size)/1.55 var(--fgd-font-ui); }
.zenfg-inspector-diagnostic-links {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: 5px var(--fgd-space-3);
	min-width: 0;
	margin-top: var(--fgd-space-1);
}
.zenfg-inspector-diagnostic-links .zenfg-inspector-relation-button {
	min-width: 0;
	max-width: 100%;
	white-space: normal;
	overflow-wrap: anywhere;
	text-align: left;
	font: var(--fgd-font-size)/1.5 var(--fgd-font-ui);
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
	font: 600 var(--fgd-font-size)/1.5 var(--fgd-font-ui);
	cursor: pointer;
}
.zenfg-inspector-diagnostic-section > .zenfg-inspector-diagnostic-section { margin: var(--fgd-space-2) 0 0 var(--fgd-space-3); }
.zenfg-inspector-diagnostic-section .zenfg-inspector-diagnostic-list { overflow: visible; padding: var(--fgd-space-1) 0; }
.zenfg-inspector-diagnostic-section ul { padding-left: 20px; }
.zenfg-inspector-diagnostic-section > .zenfg-inspector-relation-button { margin: 5px 0; }
.zenfg-inspector-diagnostic-links .selected { background: var(--fgd-accent-soft); }
.zenfg-inspector-diagnostic-section summary:focus-visible,
.zenfg-inspector-view-toolbar button:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
@container zenfg-inspector-main (max-width: 999px) {
	.zenfg-inspector-pass-table tr > :nth-child(2),
	.zenfg-inspector-pass-table tr > :nth-child(3),
	.zenfg-inspector-pass-table tr > :nth-child(4),
	.zenfg-inspector-group-table tr > :nth-child(2),
	.zenfg-inspector-group-table tr > :nth-child(3),
	.zenfg-inspector-group-table tr > :nth-child(6),
	.zenfg-inspector-group-table tr > :nth-child(7),
	.zenfg-inspector-resource-table tr > :nth-child(2) { display: none; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-meta,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-meta { display: block; white-space: normal; }
	.zenfg-inspector-pass-table th:first-child { width: 40%; }
	.zenfg-inspector-pass-table th:nth-child(5), .zenfg-inspector-pass-table th:nth-child(6) { width: 24%; }
	.zenfg-inspector-pass-table th:nth-child(7) { width: 12%; }
	.zenfg-inspector-group-table th:first-child { width: auto; }
	.zenfg-inspector-group-table th:nth-child(4), .zenfg-inspector-group-table th:nth-child(5) { width: 27%; }
	.zenfg-inspector-resource-table th:first-child { width: 48%; }
	.zenfg-inspector-resource-table th:nth-child(3) { width: 20%; }
	.zenfg-inspector-resource-table th:nth-child(4) { width: 20%; }
}
@container zenfg-inspector-main (max-width: 599px) {
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table,
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table tbody,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table tbody { display: block; width: 100%; min-width: 0; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table thead,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table thead {
		position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
	}
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table tbody tr,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table tbody tr {
		display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
		border-bottom: 1px solid var(--fgd-border-subtle);
	}
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table td,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td {
		min-width: 0; max-width: none; height: auto; padding: 6px 10px; border-bottom: 0; white-space: normal; overflow-wrap: anywhere;
	}
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table td:first-child,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:first-child { grid-column: 1 / -1; position: static; max-width: none; padding-top: 10px; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table .zenfg-inspector-relation-button,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table .zenfg-inspector-relation-button { white-space: normal; overflow-wrap: anywhere; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table td:first-child > .zenfg-inspector-relation-button,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:first-child > .zenfg-inspector-relation-button,
	.zenfg-inspector-passes-view .zenfg-inspector-list-group-path,
	.zenfg-inspector-resources-view .zenfg-inspector-list-group-path,
	.zenfg-inspector-resources-view .zenfg-inspector-resource-descriptor {
		display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal;
	}
	.zenfg-inspector-passes-view .zenfg-inspector-group-table td:first-child > .zenfg-inspector-relation-button {
		display: -webkit-inline-box; max-width: calc(100% - 29px); vertical-align: middle;
	}
	.zenfg-inspector-pass-table tr > :nth-child(7),
	.zenfg-inspector-resource-table tr > :nth-child(4),
	.zenfg-inspector-resource-table tr > :nth-child(5) { display: none; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-extra,
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table .zenfg-inspector-list-row-extra { display: block; white-space: normal; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table [data-timing],
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:nth-child(3) { text-align: left; padding-bottom: 10px; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table [data-timing]::before,
	.zenfg-inspector-resource-table td:nth-child(3)::before {
		content: attr(data-label); display: block; margin-bottom: 2px; color: var(--fgd-muted); font: 400 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui);
	}
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table tbody tr { grid-template-columns: minmax(0, 1fr) 110px; }
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:first-child { grid-column: 1; grid-row: 1; }
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table td:nth-child(3) { grid-column: 2; grid-row: 1; padding-top: 10px; }
	.zenfg-inspector-resources-view .zenfg-inspector-resource-descriptor { white-space: normal; }
	.zenfg-inspector-group-table tbody tr { position: relative; }
	.zenfg-inspector-passes-view .zenfg-inspector-group-table td:first-child { padding-left: min(calc(8px + var(--fgd-group-depth-offset, 0px)), 100px, 25cqi); padding-right: 46px; }
	.zenfg-inspector-passes-view .zenfg-inspector-group-table .zenfg-inspector-list-locate-cell { position: absolute; top: 7px; right: 5px; padding: 0; }
	.zenfg-inspector-passes-view .zenfg-inspector-workbench-table tbody tr:not([data-selection-key]),
	.zenfg-inspector-resources-view .zenfg-inspector-workbench-table tbody tr:not([data-selection-key]) { display: block; }
}
`;
