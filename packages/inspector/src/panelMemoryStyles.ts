/** Appended after the base styles so the axis and every resource share one grid. */
export const PANEL_MEMORY_CSS = `
.zenfg-inspector-memory-view {
	grid-template-rows: auto auto auto minmax(0, 1fr);
	container-type: inline-size;
	container-name: zenfg-memory;
}
.zenfg-inspector-memory-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.zenfg-inspector-memory-summary > div { border: 0; background: transparent; }
.zenfg-inspector-memory-summary span { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-summary strong { font-size: var(--fgd-font-size); white-space: normal; overflow-wrap: anywhere; }
.zenfg-inspector-memory-note { margin: 0; padding: 6px var(--fgd-space-3); font: var(--fgd-font-size-small)/1.45 var(--fgd-font-ui); }
.zenfg-inspector-memory-timeline { align-content: start; grid-template-columns: minmax(0, 1fr); min-width: 720px; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-axis,
.zenfg-inspector-memory-resource {
	grid-template-columns: minmax(165px, 0.9fr) 86px minmax(300px, 2.4fr) 82px;
	column-gap: 10px;
	padding-left: var(--fgd-space-2);
	padding-right: var(--fgd-space-2);
}
.zenfg-inspector-memory-axis { min-height: var(--fgd-row-height); z-index: 4; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-axis > :first-child,
.zenfg-inspector-memory-name { position: sticky; left: 0; z-index: 2; background: var(--fgd-canvas); }
.zenfg-inspector-memory-axis-track,
.zenfg-inspector-memory-track { grid-column: 3; }
.zenfg-inspector-memory-axis-track > span { transform: translateX(-50%); border-left: 0; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-gridline { position: absolute; height: 100%; top: 0; border-left: 1px dotted var(--fgd-border-strong); }
.zenfg-inspector-memory-resource { min-height: var(--fgd-row-height); }
.zenfg-inspector-memory-name { display: flex; align-items: center; min-height: var(--fgd-row-height); gap: 6px; min-width: 0; }
.zenfg-inspector-memory-name > .zenfg-inspector-relation-button { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--fgd-font-ui); }
.zenfg-inspector-memory-reveal { flex: 0 0 auto; padding: 2px var(--fgd-space-1); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); color: var(--fgd-text-secondary); background: var(--fgd-panel); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); cursor: pointer; }
.zenfg-inspector-memory-reveal:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 1px; }
.zenfg-inspector-memory-resource.selected .zenfg-inspector-memory-name { background: var(--fgd-panel); box-shadow: inset 2px 0 var(--fgd-accent); }
.zenfg-inspector-memory-allocation { min-width: 0; align-items: flex-start; font-family: var(--fgd-font-ui); }
.zenfg-inspector-memory-allocation > button { min-width: 0; overflow: hidden; }
.zenfg-inspector-memory-allocation > span { min-width: 0; overflow-wrap: anywhere; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-memory-bar { min-width: 0; }
@container zenfg-memory (max-width: 660px) {
	.zenfg-inspector-memory-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;
