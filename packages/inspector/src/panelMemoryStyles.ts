/** Memory estimates and inclusive lifetimes share one responsive scroll surface. */
export const PANEL_MEMORY_CSS = `
.zenfg-inspector-memory-view {
	grid-template-rows: minmax(0, 1fr);
	container-type: inline-size;
	container-name: zenfg-memory;
}
.zenfg-inspector-memory-scroller { min-width: 0; min-height: 0; overflow: auto; }
.zenfg-inspector-memory-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; padding: 0; background: var(--fgd-canvas); }
.zenfg-inspector-memory-summary > div { gap: var(--fgd-space-2); padding: var(--fgd-space-4); border: 0; border-radius: 0; background: transparent; }
.zenfg-inspector-memory-summary > div + div { border-left: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-metric { display: grid; align-content: start; gap: var(--fgd-space-1); min-width: 0; }
.zenfg-inspector-memory-metric-label { color: var(--fgd-text-secondary); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-memory-metric strong { color: var(--fgd-text); font: 600 28px/1.2 var(--fgd-font-mono); white-space: normal; overflow-wrap: anywhere; }
.zenfg-inspector-memory-metric .zenfg-inspector-memory-state-value { font-size: 20px; }
.zenfg-inspector-memory-unit { color: var(--fgd-muted); font: 500 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-metric small { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.45 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-memory-pool { padding: var(--fgd-space-3) var(--fgd-space-4); border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-pool > h2 { margin: 0 0 var(--fgd-space-2); color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-pool-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--fgd-space-3); min-width: 0; }
.zenfg-inspector-memory-pool-metrics .zenfg-inspector-memory-metric strong { font-size: 16px; }
.zenfg-inspector-memory-pool-metrics > .muted { grid-column: 1 / -1; margin: 0; font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-memory-estimate-details { min-width: 0; border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-estimate-details > summary { display: flex; align-items: center; gap: var(--fgd-space-2); min-height: var(--fgd-control-height); padding: var(--fgd-space-2) var(--fgd-space-4); color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); list-style: none; cursor: pointer; }
.zenfg-inspector-memory-estimate-details > summary::-webkit-details-marker { display: none; }
.zenfg-inspector-memory-estimate-details[open] > summary > .zenfg-inspector-control-icon { transform: rotate(90deg); }
.zenfg-inspector-memory-estimate-content { display: grid; gap: var(--fgd-space-2); padding: 0 var(--fgd-space-4) var(--fgd-space-3); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-memory-estimate-content > p { margin: 0; overflow-wrap: anywhere; }
.zenfg-inspector-memory-estimate-facts { display: grid; gap: var(--fgd-space-2); margin: 0; }
.zenfg-inspector-memory-estimate-facts > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--fgd-space-3); }
.zenfg-inspector-memory-estimate-facts dt { color: var(--fgd-muted); }
.zenfg-inspector-memory-estimate-facts dd { min-width: 0; margin: 0; font-family: var(--fgd-font-mono); overflow-wrap: anywhere; }
.zenfg-inspector-memory-note { margin: 0; padding: 6px var(--fgd-space-3); font: var(--fgd-font-size-small)/1.45 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-memory-timeline { align-content: start; grid-template-columns: minmax(0, 1fr); min-width: 0; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-axis,
.zenfg-inspector-memory-resource {
	grid-template-columns: minmax(130px, 0.9fr) 76px minmax(120px, 2.4fr) 72px;
	column-gap: 10px;
	padding-left: var(--fgd-space-2);
	padding-right: var(--fgd-space-2);
}
.zenfg-inspector-memory-axis { min-height: var(--fgd-row-height); z-index: 4; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-axis > :first-child,
.zenfg-inspector-memory-name { min-width: 0; }
.zenfg-inspector-memory-axis-track,
.zenfg-inspector-memory-track { grid-column: 3; min-width: 0; }
.zenfg-inspector-memory-axis-track > span { transform: translateX(-50%); border-left: 0; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-gridline { position: absolute; height: 100%; top: 0; border-left: 1px dotted var(--fgd-border-strong); }
.zenfg-inspector-memory-resource { min-height: var(--fgd-row-height); }
.zenfg-inspector-memory-name { display: flex; align-items: center; min-height: var(--fgd-row-height); gap: var(--fgd-space-1); }
.zenfg-inspector-memory-name > .zenfg-inspector-relation-button { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--fgd-font-ui); }
.zenfg-inspector-memory-reveal { flex: 0 0 auto; }
.zenfg-inspector-memory-size { text-align: right; }
.zenfg-inspector-memory-allocation-group,
.zenfg-inspector-memory-allocation-resources { min-width: 0; }
.zenfg-inspector-memory-allocation { min-width: 0; align-items: center; flex-wrap: wrap; font-family: var(--fgd-font-ui); }
.zenfg-inspector-memory-allocation-leading { display: flex; align-items: center; gap: var(--fgd-space-1); min-width: 0; }
.zenfg-inspector-memory-allocation-leading > .zenfg-inspector-relation-button { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.zenfg-inspector-memory-allocation-meta { min-width: 0; overflow-wrap: anywhere; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-toggle { flex: 0 0 auto; }
.zenfg-inspector-memory-bar { min-width: 0; }
@container zenfg-memory (max-width: 599px) {
	.zenfg-inspector-memory-summary { grid-template-columns: minmax(0, 1fr); }
	.zenfg-inspector-memory-summary > div + div { border-left: 0; border-top: 1px solid var(--fgd-border-subtle); }
	.zenfg-inspector-memory-summary > div { padding: var(--fgd-space-3) var(--fgd-space-4); }
	.zenfg-inspector-memory-axis,
	.zenfg-inspector-memory-resource { grid-template-columns: minmax(0, 1fr) 68px 68px; row-gap: var(--fgd-space-1); }
	.zenfg-inspector-memory-axis > :first-child,
	.zenfg-inspector-memory-name { grid-column: 1; grid-row: 1; }
	.zenfg-inspector-memory-axis > :nth-child(2),
	.zenfg-inspector-memory-range { grid-column: 2; grid-row: 1; }
	.zenfg-inspector-memory-axis > :last-child,
	.zenfg-inspector-memory-size { grid-column: 3; grid-row: 1; text-align: right; }
	.zenfg-inspector-memory-axis-track,
	.zenfg-inspector-memory-track { grid-column: 1 / -1; grid-row: 2; }
	.zenfg-inspector-memory-resource { padding-top: var(--fgd-space-1); padding-bottom: var(--fgd-space-2); }
	.zenfg-inspector-memory-axis { padding-top: var(--fgd-space-2); }
	.zenfg-inspector-memory-allocation { gap: var(--fgd-space-1); }
	.zenfg-inspector-memory-allocation-meta { flex-basis: 100%; padding-left: calc(var(--fgd-control-height) + var(--fgd-space-1)); }
	.zenfg-inspector-memory-estimate-facts > div { grid-template-columns: minmax(0, 1fr); gap: var(--fgd-space-1); }
}
`;
