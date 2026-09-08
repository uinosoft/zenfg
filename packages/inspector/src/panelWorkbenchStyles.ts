export const PANEL_WORKBENCH_CSS = `
.zenfg-inspector [hidden] { display: none !important; }
.zenfg-inspector-main { container-name: zenfg-inspector-main; container-type: inline-size; }
.zenfg-inspector-capture-summary { gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); }
.zenfg-inspector-capture-summary section > div { font-size: 12px; margin-top: 4px; grid-template-columns: minmax(90px, auto) minmax(0, 1fr); }
.zenfg-inspector-capture-summary strong { white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
.zenfg-inspector-capture-summary > section { background: var(--fgd-surface); padding: 14px; }
.zenfg-inspector-capture-summary h2 { font-size: 12px; letter-spacing: 0; text-transform: none; }
.zenfg-inspector-capture-summary section > button { margin-top: 12px; font-size: 12px; }
.zenfg-inspector-capture-details { grid-column: 1 / -1; padding: 10px 12px; border-top: 1px solid var(--fgd-border); }
.zenfg-inspector-capture-details > summary { cursor: pointer; color: var(--fgd-text-secondary); }
.zenfg-inspector-capture-details > section { margin-top: 12px; max-width: 760px; }
.zenfg-inspector-capture-details h2 { display: none; }
.zenfg-inspector-view-toolbar input,
.zenfg-inspector-view-toolbar select { height: 32px; font-size: 12px; }
.zenfg-inspector-workbench-table { min-width: 620px; font: 12px/1.5 var(--fgd-font-ui); }
.zenfg-inspector-workbench-table th { font-size: 11px; }
.zenfg-inspector-workbench-table td { height: 36px; }
.zenfg-inspector-workbench-table [data-column='numeric'] { font-family: var(--fgd-font-mono); }
.zenfg-inspector-relation-button { overflow: hidden; }
.zenfg-inspector-muted { font-size: 12px; }
.zenfg-inspector-graph-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.zenfg-inspector-graph-toolbar [hidden] { display: none !important; }
.zenfg-inspector-graph-search { position: relative; min-width: 170px; flex: 1 1 250px; }
.zenfg-inspector-graph-search input { width: 100%; min-width: 0; height: 32px; padding: 4px 8px; border: 1px solid var(--fgd-border); border-radius: 4px; color: var(--fgd-text); background: var(--fgd-panel); font: 12px var(--fgd-font-ui); }
.zenfg-inspector-graph-search-results {
  position: absolute; z-index: 8; left: 0; top: 36px; width: min(440px, 100%); max-height: 280px;
  overflow: auto; padding: 6px; border: 1px solid var(--fgd-border-strong); border-radius: 4px; background: var(--fgd-surface-raised); box-shadow: 0 8px 18px #0008;
}
.zenfg-inspector-graph-search-results > p { margin: 0 4px 5px; color: var(--fgd-muted); font-size: 12px; }
.zenfg-inspector-graph-search-results > button { display: block; width: 100%; height: auto; min-height: 32px; text-align: left; padding: 6px; margin: 2px 0; white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
.zenfg-inspector-legend-details { flex: 0 0 auto; font-size: 12px; padding: 4px; }
.zenfg-inspector-legend-details > summary { cursor: pointer; color: var(--fgd-text-secondary); }
.zenfg-inspector-legend-details[open] { flex-basis: 100%; }
.zenfg-inspector-legend-details .zenfg-inspector-graph-legend { flex-wrap: wrap; padding: 6px 0; border: 0; font-size: 11px; white-space: normal; }
.zenfg-inspector-legend-group { flex-wrap: wrap; }

.zenfg-inspector-workbench-tabs button[data-diagnostic-count]::after { content: attr(data-diagnostic-count); margin-left: 5px; color: var(--fgd-warning); font-family: var(--fgd-font-mono); }
`;
