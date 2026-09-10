export const PANEL_WORKBENCH_CSS = `
.zenfg-inspector [hidden] { display: none !important; }
.zenfg-inspector { font-size: var(--fgd-font-size); }
.zenfg-inspector-workbench { display: flex; flex-direction: column; gap: 6px; }
.zenfg-inspector-workbench-command-bar,
.zenfg-inspector-feedback { flex: 0 0 auto; }
.zenfg-inspector-workspace { flex: 1 1 0; gap: 0; }
.zenfg-inspector-main { container-name: zenfg-inspector-main; container-type: inline-size; }
.zenfg-inspector-workspace.inspector-open { grid-template-columns: minmax(0, 1fr) 8px var(--fgd-detail-width, 340px); }
.zenfg-inspector-workspace.inspector-open::after { display: none; }
.zenfg-inspector-workspace:not(.detail-drawer) .zenfg-inspector-inspector {
  position: static; width: auto; grid-column: 3; box-shadow: none;
}
.zenfg-inspector-workspace.detail-drawer { grid-template-columns: minmax(0, 1fr); }
.zenfg-inspector-workspace.detail-drawer .zenfg-inspector-inspector {
  position: absolute; z-index: 20; top: 0; right: 0; bottom: 0;
  width: min(380px, calc(100% - 24px)); box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-detail-divider {
  grid-column: 2; cursor: col-resize; touch-action: none; align-self: stretch; border-radius: var(--fgd-radius-sm);
}
.zenfg-inspector-detail-divider:hover,
.zenfg-inspector-detail-divider:focus-visible { background: var(--fgd-accent-soft); outline: 1px solid var(--fgd-accent); }
.zenfg-inspector-detail-backdrop {
  position: absolute; z-index: 10; inset: 0; border: 0; padding: 0; background: var(--fgd-backdrop); cursor: default;
}
.zenfg-inspector-diagnostic-badge { margin-left: 5px; padding: 1px var(--fgd-space-1); border-radius: var(--fgd-radius-sm); color: var(--fgd-warning); background: var(--fgd-surface-raised); font: var(--fgd-font-size-small)/1.2 var(--fgd-font-mono); }
.zenfg-inspector-feedback { border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); padding: 6px 10px; }
.zenfg-inspector-feedback summary { color: var(--fgd-text-secondary); cursor: pointer; }
.zenfg-inspector-feedback[data-tone='error'] { border-color: var(--fgd-danger); }
.zenfg-inspector-feedback[data-tone='error'] summary { color: var(--fgd-danger); }
.zenfg-inspector-feedback .zenfg-inspector-command-status {
  display: block; max-width: none; max-height: 140px; margin-top: 5px; overflow: auto;
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-capture-summary { gap: var(--fgd-space-3); grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); }
.zenfg-inspector-capture-summary section > div { font-size: var(--fgd-font-size-small); margin-top: var(--fgd-space-1); grid-template-columns: minmax(90px, auto) minmax(0, 1fr); }
.zenfg-inspector-capture-summary strong { white-space: normal; overflow-wrap: anywhere; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-capture-summary > section { background: var(--fgd-surface); padding: 14px; }
.zenfg-inspector-capture-summary h2 { font-size: var(--fgd-font-size-small); letter-spacing: 0; text-transform: none; }
.zenfg-inspector-capture-summary section > button { margin-top: var(--fgd-space-3); font-size: var(--fgd-font-size); }
.zenfg-inspector-capture-details { grid-column: 1 / -1; padding: 10px var(--fgd-space-3); border-top: 1px solid var(--fgd-border); }
.zenfg-inspector-capture-details > summary { cursor: pointer; color: var(--fgd-text-secondary); }
.zenfg-inspector-capture-details > section { margin-top: var(--fgd-space-3); max-width: 760px; }
.zenfg-inspector-capture-details h2 { display: none; }
.zenfg-inspector-view-toolbar input,
.zenfg-inspector-view-toolbar select { height: var(--fgd-control-height); }
.zenfg-inspector-workbench-table { min-width: 620px; font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-workbench-table th { font-size: var(--fgd-font-size-small); }
.zenfg-inspector-workbench-table td { height: var(--fgd-row-height); }
.zenfg-inspector-workbench-table [data-column='numeric'] { font-family: var(--fgd-font-mono); }
.zenfg-inspector-relation-button { overflow: hidden; }
.zenfg-inspector-muted { font-size: var(--fgd-font-size-small); }
.zenfg-inspector-graph-toolbar {
  position: absolute; z-index: 5; top: var(--fgd-space-2); left: var(--fgd-space-2); right: var(--fgd-space-2);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; pointer-events: none;
}
.zenfg-inspector-graph-toolbar > * { pointer-events: auto; }
.zenfg-inspector-graph-toolbar > .zenfg-inspector-graph-action-controls,
.zenfg-inspector-graph-search > button { box-shadow: var(--fgd-shadow); }
.zenfg-inspector-graph-toolbar [hidden] { display: none !important; }
.zenfg-inspector-graph-search { min-width: 0; }
.zenfg-inspector-graph-search-popover {
  position: absolute; top: calc(100% + var(--fgd-space-2)); left: 0; width: min(360px, 100%);
  padding: var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
  background: var(--fgd-surface-raised); box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-graph-search input { width: 100%; min-width: 0; height: var(--fgd-control-height); padding: var(--fgd-space-1) var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); color: var(--fgd-text); background: var(--fgd-panel); font: var(--fgd-font-size) var(--fgd-font-ui); }
.zenfg-inspector-graph-search-results {
  max-height: min(240px, 40vh); margin-top: var(--fgd-space-1); overflow: auto;
}
.zenfg-inspector-graph-search-results > p { margin: 0 var(--fgd-space-1) 5px; color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-graph-search-results > button { display: block; width: 100%; height: auto; min-height: var(--fgd-control-height); text-align: left; padding: 6px; margin: 2px 0; white-space: normal; overflow-wrap: anywhere; font-size: var(--fgd-font-size); }
.zenfg-inspector-graph-viewport { position: relative; isolation: isolate; display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
.zenfg-inspector-legend-details {
  position: absolute; z-index: 4; right: var(--fgd-space-2); bottom: var(--fgd-space-2);
  max-width: calc(100% - 2 * var(--fgd-space-2)); max-height: calc(100% - 2 * var(--fgd-space-2)); overflow: auto;
  border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
  background: var(--fgd-surface-raised); box-shadow: var(--fgd-shadow); font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-legend-details > summary { min-height: var(--fgd-control-height); padding: var(--fgd-space-2); cursor: pointer; color: var(--fgd-text-secondary); }
.zenfg-inspector-legend-details[open] { width: 360px; }
.zenfg-inspector-legend-details .zenfg-inspector-graph-legend {
  flex-direction: column; align-items: stretch; gap: var(--fgd-space-2); padding: 0 var(--fgd-space-2) var(--fgd-space-2);
  border: 0; font-size: var(--fgd-font-size-small); line-height: 1.5; white-space: normal;
}
.zenfg-inspector-legend-details .zenfg-inspector-legend-group + .zenfg-inspector-legend-group {
  border-left: 0; border-top: 1px solid var(--fgd-border-subtle); padding: var(--fgd-space-2) 0 0;
}
.zenfg-inspector-legend-group { flex-wrap: wrap; }
.zenfg-inspector button:focus-visible,
.zenfg-inspector input:focus-visible,
.zenfg-inspector select:focus-visible,
.zenfg-inspector summary:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 1px; }
@container zenfg-inspector (max-width: 560px) {
  .zenfg-inspector-workbench-command-bar.branding-hidden { grid-template-columns: minmax(0, 1fr); }
  .zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-tabs { grid-column: 1; grid-row: 2; }
  .zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-actions { grid-column: 1; grid-row: 1; justify-content: end; }
}
`;
