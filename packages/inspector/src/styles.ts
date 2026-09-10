import { themeDefaultsCss } from './themeDefinitions.ts';
import { PANEL_WORKBENCH_CSS } from './panelWorkbenchStyles.ts';
import { PANEL_LIST_CSS } from './panelListStyles.ts';
import { PANEL_DETAIL_CSS } from './panelDetailStyles.ts';
import { PANEL_MEMORY_CSS } from './panelMemoryStyles.ts';

const STYLE_ELEMENT_ID = 'zenfg-inspector-panel-styles';


const FRAME_GRAPH_DEBUG_PANEL_CSS = `
/* Tokens and workbench root */
.zenfg-inspector {
	${themeDefaultsCss}
	position: relative;
	display: block;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	color: var(--fgd-text);
	background: var(--fgd-canvas);
	font-family: var(--fgd-font-ui);
	line-height: 1.45;
	color-scheme: var(--zfgi-color-scheme, dark);
	container-name: zenfg-inspector;
	container-type: inline-size;
}

.zenfg-inspector,
.zenfg-inspector * { box-sizing: border-box; }

.zenfg-inspector-body {
	width: 100%;
	height: 100%;
	min-height: 0;
	padding: 10px;
	overflow: hidden;
	border: 0;
	border-radius: 0;
	background: var(--fgd-panel);
}

.zenfg-inspector-content {
	min-width: 0;
	min-height: 0;
	height: 100%;
	overflow: hidden;
}

.zenfg-inspector-drop-overlay {
	position: absolute;
	z-index: 40;
	inset: 10px;
	display: grid;
	place-content: center;
	gap: 6px;
	border: 2px dashed var(--fgd-accent);
	border-radius: var(--fgd-radius-md);
	color: var(--fgd-accent);
	background: color-mix(in srgb, var(--fgd-canvas) 90%, transparent);
	font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui);
	text-align: center;
	pointer-events: none;
}
.zenfg-inspector-drop-overlay[hidden] { display: none; }
.zenfg-inspector-drop-overlay > span { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }

.zenfg-inspector-capture-summary[hidden],
.zenfg-inspector-command-status[hidden],
.zenfg-inspector-capture-action[hidden],
.zenfg-inspector-workbench-empty[hidden],
.zenfg-inspector-open-inspector[hidden],
.zenfg-inspector-inspector.unavailable,
.zenfg-inspector-view[hidden],
.zenfg-inspector-graph-status[hidden] { display: none !important; }

.zenfg-inspector-muted {
	margin: 0;
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
}

.zenfg-inspector-control-icon {
	display: block;
	flex: 0 0 auto;
	width: 14px;
	height: 14px;
}

.zenfg-inspector-table-scroller,
.zenfg-inspector-memory-scroller,
.zenfg-inspector-diagnostics-scroller,
.zenfg-inspector-inspector-content,
.zenfg-inspector-workbench-tabs,
.zenfg-inspector-graph-legend {
	scrollbar-width: thin;
	scrollbar-color: var(--fgd-border) transparent;
}

/* Common control states apply consistently across all workbench views. */
.zenfg-inspector :is(button, input, select, textarea) { font-family: var(--fgd-font-ui); }
.zenfg-inspector :is(button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
/* The modal dismiss button must retain its translucent scrim while pressed. */
.zenfg-inspector button:active:not(:disabled):not(.zenfg-inspector-detail-backdrop) { background: var(--fgd-accent-soft); }
.zenfg-inspector :is(button, input, select):disabled { cursor: default; opacity: .5; }
.zenfg-inspector ::selection { color: var(--fgd-text); background: var(--fgd-accent-soft); }
/* Workbench and summary */
.zenfg-inspector-workbench {
	grid-template-rows: auto minmax(0, 1fr);
	height: 100%;
	min-width: 0;
	min-height: 0;
	font-family: var(--fgd-font-ui);
}

.zenfg-inspector-capture-summary {
	display: grid;
	align-content: start;
	min-width: 0;
	background: transparent;
}

.zenfg-inspector-capture-summary > section {
	min-width: 0;
	border: 1px solid var(--fgd-border-subtle);
	border-radius: var(--fgd-radius-sm);
}

.zenfg-inspector-capture-summary h2 {
	margin: 0 0 5px;
	color: var(--fgd-text-secondary);
	font-weight: 700;
	line-height: 1.2;
}

.zenfg-inspector-capture-summary section > div {
	display: grid;
	gap: var(--fgd-space-2);
	min-width: 0;
	line-height: 1.5;
}

.zenfg-inspector-capture-summary span { color: var(--fgd-muted); white-space: nowrap; }
.zenfg-inspector-capture-summary strong {
	min-width: 0;
	overflow: hidden;
	color: var(--fgd-text);
	font: 600 var(--fgd-font-size-small)/1.5 var(--fgd-font-mono);
	text-align: right;
	text-overflow: ellipsis;
}

/* Command bar, tabs, and controls */
.zenfg-inspector-workbench-command-bar {
	position: relative;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	min-width: 0;
	border-bottom: 1px solid var(--fgd-border-subtle);
}
.zenfg-inspector-workbench-command-bar.branding-hidden {
	grid-template-columns: minmax(0, 1fr) auto;
}

.zenfg-inspector-brand {
	position: relative;
	display: flex;
	align-items: center;
	min-width: 0;
	min-height: var(--fgd-control-height);
	padding: 0 var(--fgd-space-3) 0 var(--fgd-space-1);
	overflow: hidden;
	color: var(--fgd-text);
	font: 700 var(--fgd-font-size-small)/1 var(--fgd-font-ui);
	letter-spacing: 0.015em;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zenfg-inspector-brand::after {
	position: absolute;
	top: 50%;
	right: 0;
	width: 1px;
	height: 16px;
	background: var(--fgd-border);
	content: '';
	transform: translateY(-50%);
}

.zenfg-inspector-workbench-tabs,
.zenfg-inspector-subtabs,
.zenfg-inspector-inspector-tabs {
	display: flex;
	align-items: end;
	min-width: 0;
	border-bottom: 1px solid var(--fgd-border-subtle);
}

.zenfg-inspector-workbench-tabs {
	align-self: stretch;
	align-items: stretch;
	overflow-x: auto;
	border-bottom: 0;
}

.zenfg-inspector-workbench-tabs > button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.zenfg-inspector-workbench-tabs > button,
.zenfg-inspector-subtabs > button,
.zenfg-inspector-inspector-tabs > button {
	min-height: var(--fgd-control-height);
	padding: 6px 10px;
	border: 0;
	border-bottom: 2px solid transparent;
	color: var(--fgd-muted);
	background: transparent;
	font: 600 var(--fgd-font-size)/1 var(--fgd-font-ui);
	white-space: nowrap;
	cursor: pointer;
	transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
}

.zenfg-inspector-workbench-tabs > button:hover:not(:disabled),
.zenfg-inspector-subtabs > button:hover:not(:disabled),
.zenfg-inspector-inspector-tabs > button:hover:not(:disabled) {
	color: var(--fgd-text-secondary);
	background: var(--fgd-surface-hover);
}

.zenfg-inspector-workbench-tabs > button.active,
.zenfg-inspector-subtabs > button.active,
.zenfg-inspector-inspector-tabs > button.active {
	border-bottom-color: var(--fgd-accent);
	color: var(--fgd-text);
	background: linear-gradient(to top, var(--fgd-accent-soft), transparent 55%);
}

.zenfg-inspector-workbench-tabs > button:disabled,
.zenfg-inspector-subtabs > button:disabled,
.zenfg-inspector-inspector-tabs > button:disabled { cursor: default; opacity: 0.42; }

.zenfg-inspector-workbench-actions {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: var(--fgd-space-1) 0 var(--fgd-space-1) var(--fgd-space-2);
	overflow-x: auto;
	scrollbar-width: thin;
}

.zenfg-inspector-export-menu {
	position: absolute;
	z-index: 30;
	top: calc(100% + 4px);
	right: 0;
	display: grid;
	min-width: 142px;
	padding: var(--fgd-space-1);
	border: 1px solid var(--fgd-border-strong);
	border-radius: var(--fgd-radius-sm);
	background: var(--fgd-surface-raised);
	box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-export-menu[hidden] { display: none; }
.zenfg-inspector-export-menu > button {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 7px 9px;
	border: 0;
	border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text-secondary);
	background: transparent;
	font: 600 var(--fgd-font-size)/1.2 var(--fgd-font-ui);
	text-align: left;
	white-space: nowrap;
	cursor: pointer;
}
.zenfg-inspector-export-menu > button:hover:not(:disabled) {
	color: var(--fgd-text);
	background: var(--fgd-surface-hover);
}
.zenfg-inspector-export-menu > button:disabled { cursor: default; opacity: 0.46; }

.zenfg-inspector-workbench-actions > button,
.zenfg-inspector-graph-toolbar button,
.zenfg-inspector-group-toggle,
.zenfg-inspector-inspector-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: var(--fgd-control-height);
	min-height: var(--fgd-control-height);
	padding: 0 9px;
	border: 1px solid var(--fgd-border);
	border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text-secondary);
	background: var(--fgd-surface);
	font: 600 var(--fgd-font-size)/1 var(--fgd-font-ui);
	white-space: nowrap;
	cursor: pointer;
	transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
}

.zenfg-inspector-workbench-actions > button:hover:not(:disabled),
.zenfg-inspector-graph-toolbar button:hover:not(:disabled),
.zenfg-inspector-group-toggle:hover:not(:disabled),
.zenfg-inspector-inspector-close:hover:not(:disabled) {
	border-color: var(--fgd-border-strong);
	color: var(--fgd-text);
	background: var(--fgd-surface-hover);
}

.zenfg-inspector-workbench-actions > button[data-tone='accent'] {
	border-color: var(--fgd-accent);
	color: var(--fgd-accent);
	background: var(--fgd-accent-soft);
}
.zenfg-inspector-workbench-actions > button[data-tone='accent']:hover:not(:disabled) {
	border-color: var(--fgd-accent);
	background: var(--fgd-accent-hover);
}
.zenfg-inspector-workbench-actions > button[data-tone='pending'] {
	border-color: var(--fgd-accent);
	color: var(--fgd-text-secondary);
	background: var(--fgd-accent-soft);
}
.zenfg-inspector-workbench-actions > button[data-tone='success'] {
	border-color: var(--fgd-success);
	color: var(--fgd-success);
	background: color-mix(in srgb, var(--fgd-success) 10%, var(--fgd-panel));
}
.zenfg-inspector-workbench-actions > button:disabled { cursor: default; opacity: 0.46; }
.zenfg-inspector-workbench-actions > button[aria-busy='true']:disabled { opacity: 0.72; }

.zenfg-inspector-command-status {
	max-width: 220px;
	overflow: hidden;
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1.35 var(--fgd-font-ui);
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zenfg-inspector-command-status[data-tone='error'] { color: var(--fgd-danger); }

.zenfg-inspector-control-icon[data-icon='spinner'],
button[aria-busy='true'] > .zenfg-inspector-control-icon {
	animation: zenfg-inspector-spin 800ms linear infinite;
}
@keyframes zenfg-inspector-spin { to { transform: rotate(360deg); } }

.zenfg-inspector-workbench-tabs > button:focus-visible,
.zenfg-inspector-subtabs > button:focus-visible,
.zenfg-inspector-inspector-tabs > button:focus-visible,
.zenfg-inspector-workbench-actions > button:focus-visible,
.zenfg-inspector-graph-toolbar button:focus-visible,
.zenfg-inspector-group-toggle:focus-visible,
.zenfg-inspector-inspector-close:focus-visible,
.zenfg-inspector-relation-button:focus-visible,
.zenfg-inspector-view-toolbar input:focus-visible,
.zenfg-inspector-view-toolbar select:focus-visible {
	outline: 2px solid var(--fgd-accent);
	outline-offset: 1px;
}

/* Workspace and empty states */
.zenfg-inspector-overview-view {
	padding: var(--fgd-space-3);
	overflow: auto;
	background: var(--fgd-canvas);
}

.zenfg-inspector-workspace {
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	min-width: 0;
	min-height: 0;
	overflow: hidden;
}

.zenfg-inspector-main {
	display: grid;
	grid-template: minmax(0, 1fr) / minmax(0, 1fr);
	min-width: 0;
	min-height: 0;
	overflow: hidden;
}

.zenfg-inspector-workbench-empty {
	grid-area: 1 / 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--fgd-space-2);
	min-width: 0;
	min-height: 0;
	padding: 24px;
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
	text-align: center;
}
.zenfg-inspector-workbench-empty > .zenfg-inspector-control-icon {
	width: 22px;
	height: 22px;
	color: var(--fgd-text-secondary);
}
.zenfg-inspector-workbench-empty[data-state='error'] > .zenfg-inspector-control-icon { color: var(--fgd-danger); }
.zenfg-inspector-workbench-empty[data-state='capturing'] > .zenfg-inspector-control-icon { color: var(--fgd-accent); }
.zenfg-inspector-empty-message { max-width: 520px; }
.zenfg-inspector-empty-detail { color: color-mix(in srgb, var(--fgd-muted) 78%, transparent); font-size: var(--fgd-font-size-small); }

.zenfg-inspector-view {
	grid-area: 1 / 1;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	border: 1px solid var(--fgd-border-subtle);
	border-radius: var(--fgd-radius-sm);
	background: var(--fgd-canvas);
}

.zenfg-inspector-view-toolbar {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	padding: 6px var(--fgd-space-2);
	border-bottom: 1px solid var(--fgd-border-subtle);
	background: var(--fgd-surface);
}

.zenfg-inspector-view-toolbar input,
.zenfg-inspector-view-toolbar select {
	min-width: 0;
	padding: var(--fgd-space-1) var(--fgd-space-2);
	border: 1px solid var(--fgd-border);
	border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text);
	background: var(--fgd-panel);
	font: var(--fgd-font-size)/1 var(--fgd-font-ui);
}
.zenfg-inspector-view-toolbar input { flex: 1 1 210px; }
.zenfg-inspector-view-toolbar input::placeholder { color: var(--fgd-muted); opacity: 0.86; }
.zenfg-inspector-view-toolbar select { flex: 0 1 auto; color-scheme: dark; }

.zenfg-inspector-passes-view,
.zenfg-inspector-resources-view { display: flex; flex-direction: column; }
.zenfg-inspector-subtabs,
.zenfg-inspector-inspector-tabs {
	flex: 0 0 auto;
	padding: 0 var(--fgd-space-1);
	background: var(--fgd-panel);
}
.zenfg-inspector-subview { flex: 1 1 auto; min-height: 0; overflow: hidden; }

/* Tables and relations */
.zenfg-inspector-table-scroller {
	width: 100%;
	height: 100%;
	min-height: 0;
	overflow: auto;
}
.zenfg-inspector-workbench-table {
	width: 100%;
	border-collapse: collapse;
}
.zenfg-inspector-workbench-table th,
.zenfg-inspector-workbench-table td {
	height: var(--fgd-control-height);
	max-width: 360px;
	padding: 6px 10px;
	border-bottom: 1px solid var(--fgd-border-subtle);
	overflow: hidden;
	text-align: left;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zenfg-inspector-workbench-table th {
	position: sticky;
	z-index: 2;
	top: 0;
	color: var(--fgd-muted);
	background: var(--fgd-panel);
	font: 650 var(--fgd-font-size-small)/1.3 var(--fgd-font-ui);
	letter-spacing: 0.025em;
}
.zenfg-inspector-workbench-table [data-column='numeric'] {
	font-variant-numeric: tabular-nums;
	text-align: right;
}
.zenfg-inspector-workbench-table [data-column='code'] { font-family: var(--fgd-font-mono); }
.zenfg-inspector-workbench-table tbody tr:hover td { background: var(--fgd-surface-hover); }

.zenfg-inspector-workbench-table tr.selected td,
.zenfg-inspector-diagnostic-list .selected,
.zenfg-inspector-memory-allocation.selected,
.zenfg-inspector-memory-resource.selected { background: var(--fgd-accent-soft); }
.zenfg-inspector-workbench-table tr.selected td:first-child { box-shadow: inset 2px 0 var(--fgd-accent); }

.zenfg-inspector-workbench-table td small {
	display: block;
	margin-top: 2px;
	overflow: hidden;
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui);
	text-overflow: ellipsis;
}

.zenfg-inspector-kind-label {
	--fgd-kind-color: var(--fgd-muted);
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 100%;
	overflow: hidden;
	color: var(--fgd-text-secondary);
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zenfg-inspector-kind-label::before {
	width: 6px;
	height: 6px;
	flex: 0 0 auto;
	border: 1px solid color-mix(in srgb, var(--fgd-kind-color) 78%, white);
	border-radius: 50%;
	background: color-mix(in srgb, var(--fgd-kind-color) 72%, transparent);
	content: '';
}
.zenfg-inspector-kind-label[data-kind='render'] { --fgd-kind-color: var(--fgd-graph-render-stroke); }
.zenfg-inspector-kind-label[data-kind='compute'] { --fgd-kind-color: var(--fgd-graph-compute-stroke); }
.zenfg-inspector-kind-label[data-kind='copy'] { --fgd-kind-color: var(--fgd-graph-copy-stroke); }
.zenfg-inspector-kind-label[data-kind='clear-buffer'] { --fgd-kind-color: var(--fgd-graph-clear-stroke); }
.zenfg-inspector-kind-label[data-kind='command'] { --fgd-kind-color: var(--fgd-graph-command-stroke); }
.zenfg-inspector-kind-label[data-kind='external-submission'] { --fgd-kind-color: var(--fgd-graph-external-stroke); }
.zenfg-inspector-kind-label[data-kind='opaque'] { --fgd-kind-color: var(--fgd-graph-external-stroke); }
.zenfg-inspector-kind-label[data-kind='texture'] { --fgd-kind-color: var(--fgd-graph-texture-stroke); }
.zenfg-inspector-kind-label[data-kind='buffer'] { --fgd-kind-color: var(--fgd-graph-buffer-stroke); }
.zenfg-inspector-kind-label[data-kind='frame-graph'] { --fgd-kind-color: var(--fgd-accent); }
.zenfg-inspector-kind-label[data-kind='timed'] { --fgd-kind-color: var(--fgd-success); }
.zenfg-inspector-kind-label[data-kind='not-timed'] { --fgd-kind-color: var(--fgd-muted); }

.zenfg-inspector-relation-button {
	max-width: 100%;
	padding: 0;
	border: 0;
	color: var(--fgd-accent);
	background: transparent;
	font: inherit;
	text-align: left;
	text-overflow: ellipsis;
	white-space: nowrap;
	cursor: pointer;
}
.zenfg-inspector-relation-button:hover {
	color: var(--fgd-accent);
	text-decoration: underline;
	text-underline-offset: 2px;
}
.zenfg-inspector-group-toggle { width: 28px; padding: 0; color: var(--fgd-text-secondary); }
.zenfg-inspector-empty-row {
	height: 60px !important;
	color: var(--fgd-muted);
	font-family: var(--fgd-font-ui);
	text-align: center !important;
}

/* Graph */
.zenfg-inspector-graph-view { display: flex; flex-direction: column; }
.zenfg-inspector-graph-toolbar {
	min-width: 0;
}
.zenfg-inspector-graph-action-controls { display: flex; align-items: center; min-width: 0; }
.zenfg-inspector-graph-action-controls { gap: var(--fgd-space-1); }
.zenfg-inspector-graph-toolbar button.active,
.zenfg-inspector-graph-toolbar button[aria-pressed='true'] {
	z-index: 1;
	border-color: var(--fgd-accent);
	color: var(--fgd-accent);
	background: var(--fgd-accent-soft);
}
.zenfg-inspector-graph-toolbar button:disabled { cursor: default; opacity: 0.42; }

.zenfg-inspector-graph-legend {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	padding: 2px 0;
	overflow-x: auto;
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1 var(--fgd-font-ui);
	white-space: nowrap;
}
.zenfg-inspector-legend-item { display: inline-flex; align-items: center; gap: var(--fgd-space-1); flex: 0 0 auto; }
.zenfg-inspector-legend-group { display: inline-flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.zenfg-inspector-legend-group + .zenfg-inspector-legend-group { border-left: 1px solid var(--fgd-border-subtle); padding-left: 10px; }
.zenfg-inspector-legend-heading { color: var(--fgd-text-secondary); font-weight: 600; }
.zenfg-inspector-legend-swatch {
	position: relative;
	display: inline-block;
	width: 10px;
	height: 8px;
	border: 1px solid var(--zenfg-inspector-legend-color);
	border-radius: 2px;
	background: color-mix(in srgb, var(--zenfg-inspector-legend-color) 20%, var(--fgd-canvas));
}
.zenfg-inspector-legend-swatch[data-shape='ellipse'] { border-radius: 50%; }
.zenfg-inspector-legend-swatch[data-shape='group'] { background: transparent; }
.zenfg-inspector-legend-swatch[data-shape='cut-rectangle'],
.zenfg-inspector-legend-swatch[data-shape='tag'] { width: 14px; height: 10px; border: 0; background: transparent; }
.zenfg-inspector-legend-swatch > svg { display: block; width: 100%; height: 100%; overflow: visible; }
.zenfg-inspector-legend-swatch > svg polygon {
	fill: color-mix(in srgb, var(--zenfg-inspector-legend-color) 20%, var(--fgd-canvas));
	stroke: var(--zenfg-inspector-legend-color);
	stroke-width: 1.4;
}
.zenfg-inspector-legend-swatch[data-shape='line'] {
	width: 16px;
	height: 0;
	border: 0;
	border-top: 1px solid var(--zenfg-inspector-legend-color);
	border-radius: 0;
	background: transparent;
}
.zenfg-inspector-legend-swatch[data-shape='line'][data-line-style='dotted'] { border-top-style: dotted; }
.zenfg-inspector-legend-swatch[data-shape='line'][data-line-style='dashed'] { border-top-style: dashed; }
.zenfg-inspector-legend-swatch:not([data-shape='line'])[data-line-style='dashed'] { border-style: dashed; }
.zenfg-inspector-legend-swatch[data-shape='line']::after {
	position: absolute;
	top: -2px;
	right: -1px;
	width: 5px;
	height: 4px;
	background: var(--zenfg-inspector-legend-color);
	clip-path: polygon(0 0, 100% 50%, 0 100%);
	content: '';
}
.zenfg-inspector-legend-swatch[data-shape='line'][data-hollow-arrow='true']::after {
	top: -3px;
	width: 4px;
	height: 4px;
	border-top: 1px solid var(--zenfg-inspector-legend-color);
	border-right: 1px solid var(--zenfg-inspector-legend-color);
	background: transparent;
	clip-path: none;
	transform: rotate(45deg);
}

.zenfg-inspector-graph-view .zenfg-inspector-graph {
	flex: 1 1 auto;
	width: 100%;
	height: auto;
	min-height: 0;
	border: 0;
}
.zenfg-inspector-graph {
	position: relative;
	width: 100%;
	height: 260px;
	min-height: 220px;
	overflow: hidden;
	border: 1px solid var(--fgd-border-subtle);
	background: var(--fgd-canvas);
	color: var(--fgd-muted);
	font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-graph-canvas {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	outline: none;
}
.zenfg-inspector-graph-status {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--fgd-space-2);
	padding: var(--fgd-space-4);
	color: var(--fgd-muted);
	background: color-mix(in srgb, var(--fgd-canvas) 82%, transparent);
	font: var(--fgd-font-size-small)/1.45 var(--fgd-font-ui);
	text-align: center;
	pointer-events: none;
}
.zenfg-inspector-graph-status[data-state='layout'] { background: color-mix(in srgb, var(--fgd-canvas) 50%, transparent); }
.zenfg-inspector-graph-status[data-state='error'] {
	color: var(--fgd-text);
	background: color-mix(in srgb, var(--fgd-canvas) 94%, transparent);
}
.zenfg-inspector-graph-status > span { max-width: min(560px, 80%); }
.zenfg-inspector-graph-status button {
	height: var(--fgd-control-height);
	padding: 0 9px;
	border: 1px solid var(--fgd-accent);
	border-radius: var(--fgd-radius-sm);
	color: var(--fgd-accent);
	background: var(--fgd-accent-soft);
	font: 600 var(--fgd-font-size)/1 var(--fgd-font-ui);
	cursor: pointer;
	pointer-events: auto;
}
.zenfg-inspector-graph-tooltip {
	position: absolute;
	z-index: 3;
	width: max-content;
	max-width: min(380px, calc(100% - 16px));
	padding: var(--fgd-space-2) 10px;
	border: 1px solid var(--fgd-border-strong);
	border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text);
	background: var(--fgd-surface-raised);
	box-shadow: var(--fgd-shadow);
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono);
	white-space: pre-wrap;
	pointer-events: none;
}

/* Inspector */
.zenfg-inspector-inspector {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	border: 1px solid var(--fgd-border);
	border-radius: var(--fgd-radius-sm);
	background: var(--fgd-surface-raised);
	box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-inspector[hidden] { display: none; }
.zenfg-inspector-inspector > header {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: space-between;
	min-height: var(--fgd-row-height);
	padding: 0 var(--fgd-space-2) 0 10px;
	border-bottom: 1px solid var(--fgd-border-subtle);
	background: var(--fgd-surface);
}
.zenfg-inspector-inspector > header strong {
	min-width: 0;
	overflow: hidden;
	font: 600 var(--fgd-font-size-small)/1.3 var(--fgd-font-mono);
	text-overflow: ellipsis;
	white-space: nowrap;
}
.zenfg-inspector-inspector-close {
	width: 28px;
	padding: 0;
	border-color: transparent;
	background: transparent;
}
.zenfg-inspector-inspector-content {
	flex: 1 1 auto;
	min-height: 0;
	padding: 10px;
	overflow: auto;
}
.zenfg-inspector-inspector-summary {
	display: grid;
	gap: 3px var(--fgd-space-3);
	margin: 0;
	line-height: 1.6;
}
.zenfg-inspector-inspector-summary dt { color: var(--fgd-muted); font-family: var(--fgd-font-ui); }
.zenfg-inspector-inspector-summary dd {
	min-width: 0;
	margin: 0;
	color: var(--fgd-text);
	overflow-wrap: anywhere;
}
.zenfg-inspector-inspector-relations { display: grid; gap: var(--fgd-space-2); }
.zenfg-inspector-inspector-relations section {
	display: grid;
	gap: 6px;
	padding: var(--fgd-space-2);
	border: 1px solid var(--fgd-border-subtle);
	border-radius: var(--fgd-radius-sm);
	background: var(--fgd-surface);
}
.zenfg-inspector-inspector-relations h3 {
	margin: 0 0 2px;
	color: var(--fgd-muted);
	font: 700 var(--fgd-font-size-small)/1.3 var(--fgd-font-ui);
	letter-spacing: 0.055em;
	text-transform: uppercase;
}
.zenfg-inspector-inspector-relations .zenfg-inspector-relation-button {
	font: var(--fgd-font-size)/1.5 var(--fgd-font-mono);
	overflow-wrap: anywhere;
	white-space: normal;
}
.zenfg-inspector-relation-entry { display: grid; justify-items: start; gap: 2px; }
.zenfg-inspector-relation-entry > span { font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); overflow-wrap: anywhere; }
.zenfg-inspector-inspector .zenfg-inspector-raw-detail {
	min-width: 100%;
	margin: 0;
	color: var(--fgd-text-secondary);
}

/* Memory */
.zenfg-inspector-memory-view {
	display: grid;
}
.zenfg-inspector-memory-summary {
	display: grid;
	gap: 6px;
	padding: 6px;
	border-bottom: 1px solid var(--fgd-border-subtle);
	background: var(--fgd-panel);
}
.zenfg-inspector-memory-summary > div {
	display: grid;
	gap: 3px;
	min-width: 0;
	padding: 6px var(--fgd-space-2);
	border-radius: var(--fgd-radius-sm);
}
.zenfg-inspector-memory-summary strong {
	overflow: hidden;
	font: 600 var(--fgd-font-size-small)/1.35 var(--fgd-font-mono);
	text-overflow: ellipsis;
}
.zenfg-inspector-memory-scroller { min-height: 0; overflow: auto; }
.zenfg-inspector-memory-timeline {
	display: grid;
	padding: var(--fgd-space-2);
	font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono);
}
.zenfg-inspector-memory-axis,
.zenfg-inspector-memory-resource {
	display: grid;
	gap: 10px;
	align-items: center;
	min-height: var(--fgd-control-height);
}
.zenfg-inspector-memory-axis {
	position: sticky;
	top: 0;
	padding: 0 var(--fgd-space-2) 6px;
	color: var(--fgd-muted);
	background: var(--fgd-canvas);
	font: var(--fgd-font-size-small)/1.3 var(--fgd-font-ui);
}
.zenfg-inspector-memory-axis-track,
.zenfg-inspector-memory-track { position: relative; height: 16px; }
.zenfg-inspector-memory-axis-track { border-bottom: 1px solid var(--fgd-border-strong); }
.zenfg-inspector-memory-axis-track > span {
	position: absolute;
	bottom: -1px;
	padding-bottom: 5px;
	font: var(--fgd-font-size-small)/1 var(--fgd-font-mono);
}
.zenfg-inspector-memory-allocation {
	display: flex;
	justify-content: space-between;
	gap: var(--fgd-space-3);
	margin-top: 6px;
	padding: 7px var(--fgd-space-2);
	border-top: 1px solid var(--fgd-border-subtle);
	border-bottom: 1px solid var(--fgd-border-subtle);
	background: var(--fgd-surface);
}
.zenfg-inspector-memory-allocation > span { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.35 var(--fgd-font-mono); }
.zenfg-inspector-memory-allocation.muted { color: var(--fgd-muted); font-family: var(--fgd-font-ui); }
.zenfg-inspector-memory-resource { padding: 0 var(--fgd-space-2); border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-resource.selected,
.zenfg-inspector-memory-allocation.selected { box-shadow: inset 2px 0 var(--fgd-accent); }
.zenfg-inspector-memory-bar {
	position: absolute;
	top: 4px;
	height: 8px;
	border-radius: var(--fgd-radius-sm);
	background: color-mix(in srgb, var(--fgd-graph-texture-stroke) 76%, transparent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--fgd-graph-texture-stroke) 36%, transparent);
}
.zenfg-inspector-memory-bar.buffer {
	background: color-mix(in srgb, var(--fgd-graph-buffer-stroke) 72%, transparent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--fgd-graph-buffer-stroke) 34%, transparent);
}
.zenfg-inspector-memory-bar.empty { display: none; }

/* Diagnostics */
.zenfg-inspector-diagnostics-scroller { width: 100%; height: 100%; overflow: auto; }
.zenfg-inspector-diagnostics-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--fgd-space-2);
	padding: var(--fgd-space-2);
}
.zenfg-inspector-diagnostic-card {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 164px;
	overflow: hidden;
	border: 1px solid var(--fgd-border-subtle);
	border-radius: var(--fgd-radius-sm);
	background: var(--fgd-surface);
}
.zenfg-inspector-diagnostic-card > h2 {
	margin: 0;
	padding: 9px 10px 3px;
	color: var(--fgd-text-secondary);
	font: 650 var(--fgd-font-size-small)/1.35 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-card > p {
	margin: 0;
	padding: 0 10px var(--fgd-space-2);
	color: var(--fgd-muted);
	font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-diagnostic-card .zenfg-inspector-table-scroller { flex: 1 1 auto; max-height: 280px; }
.zenfg-inspector-diagnostic-card .zenfg-inspector-workbench-table { min-width: 100%; table-layout: fixed; }
.zenfg-inspector-diagnostic-card .zenfg-inspector-workbench-table td {
	overflow-wrap: anywhere;
	white-space: normal;
}
.zenfg-inspector-diagnostic-list { display: grid; gap: 2px; padding: 6px; overflow: auto; }
.zenfg-inspector-diagnostic-list .zenfg-inspector-relation-button {
	padding: 6px var(--fgd-space-2);
	border-radius: var(--fgd-radius-sm);
	color: var(--fgd-text-secondary);
	font: var(--fgd-font-size)/1.45 var(--fgd-font-mono);
}
.zenfg-inspector-diagnostic-list .zenfg-inspector-relation-button:hover {
	background: var(--fgd-surface-hover);
	text-decoration: none;
}
.zenfg-inspector-diagnostic-list .selected { box-shadow: inset 2px 0 var(--fgd-accent); }

/* Responsive */
@container zenfg-inspector (max-width: 960px) {
	.zenfg-inspector-workspace.inspector-open { grid-template-columns: minmax(0, 1fr); }
	.zenfg-inspector-workspace.inspector-open::after {
		position: absolute;
		z-index: 10;
		inset: 0;
		background: var(--fgd-backdrop);
		content: '';
		pointer-events: none;
	}
	.zenfg-inspector-inspector {
		position: absolute;
		z-index: 20;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(380px, calc(100% - 24px));
		box-shadow: var(--fgd-shadow);
	}
	.zenfg-inspector-graph-toolbar {
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 6px var(--fgd-space-2);
	}
	.zenfg-inspector-graph-legend {
		grid-column: 1 / -1;
		grid-row: 2;
		padding-top: 6px;
		border-top: 1px solid var(--fgd-border-subtle);
	}
	.zenfg-inspector-graph-action-controls { justify-self: end; }
}

@container zenfg-inspector (max-width: 840px) {
	.zenfg-inspector-workbench-command-bar {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.zenfg-inspector-brand { grid-column: 1; grid-row: 1; min-height: var(--fgd-row-height); display: flex; align-items: center; }
	.zenfg-inspector-brand::after { display: none; }
	.zenfg-inspector-workbench-actions { grid-column: 2; grid-row: 1; }
	.zenfg-inspector-workbench-tabs { grid-column: 1 / -1; grid-row: 2; }
	.zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-tabs {
		grid-column: 1;
		grid-row: 1;
	}
	.zenfg-inspector-diagnostics-grid { grid-template-columns: minmax(0, 1fr); }
}

@container zenfg-inspector (max-width: 720px) {
	.zenfg-inspector-body { padding: var(--fgd-space-2); }
	.zenfg-inspector-overview-view { padding: var(--fgd-space-2); }
	.zenfg-inspector-capture-summary > section { padding: 10px; }
	.zenfg-inspector-workbench-actions { padding-left: 6px; }
	.zenfg-inspector-command-status { max-width: 104px; }
	.zenfg-inspector-workbench-tabs > button { flex: 0 0 auto; padding-inline: var(--fgd-space-2); }
	.zenfg-inspector-memory-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.zenfg-inspector-view-toolbar input { flex-basis: 100%; }
	.zenfg-inspector-graph-toolbar { display: flex; flex-wrap: wrap; }
	.zenfg-inspector-graph-legend { order: 3; flex-basis: 100%; }
	.zenfg-inspector-graph-action-controls { margin-left: auto; }
	.zenfg-inspector-graph-view .zenfg-inspector-graph { height: auto; }
}

@media (prefers-reduced-motion: reduce) {
	.zenfg-inspector *,
	.zenfg-inspector *::before,
	.zenfg-inspector *::after {
		scroll-behavior: auto !important;
		transition-duration: 0.01ms !important;
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
	}
}
`;

/**
 * Installs the inspector's shared stylesheet in the current document once.
 *
 * @remarks This is safe to call repeatedly and is a no-op during server-side
 * rendering. `FrameGraphInspector` calls it automatically.
 */
export function ensureFrameGraphInspectorStyles(): void {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
		return;
	}

	const style = document.createElement('style');
	style.id = STYLE_ELEMENT_ID;
	style.textContent = FRAME_GRAPH_DEBUG_PANEL_CSS + PANEL_WORKBENCH_CSS + PANEL_LIST_CSS + PANEL_DETAIL_CSS + PANEL_MEMORY_CSS;
	document.head.appendChild(style);
}
