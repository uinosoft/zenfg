export const PANEL_WORKBENCH_CSS = `
.zenfg-inspector [hidden] { display: none !important; }
.zenfg-inspector { font-size: 13px; }
.zenfg-inspector-workbench { display: flex; flex-direction: column; gap: 6px; }
.zenfg-inspector-workbench-command-bar,
.zenfg-inspector-capture-context,
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
  width: min(380px, calc(100% - 24px)); box-shadow: -12px 0 32px #0006;
}
.zenfg-inspector-detail-divider {
  grid-column: 2; cursor: col-resize; touch-action: none; align-self: stretch; border-radius: 4px;
}
.zenfg-inspector-detail-divider:hover,
.zenfg-inspector-detail-divider:focus-visible { background: var(--fgd-accent-soft); outline: 1px solid var(--fgd-accent); }
.zenfg-inspector-detail-backdrop {
  position: absolute; z-index: 10; inset: 0; border: 0; padding: 0; background: #03070c99; cursor: default;
}
.zenfg-inspector-capture-context {
  display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px;
  padding: 2px 4px; color: var(--fgd-text-secondary); font: 12px/1.5 var(--fgd-font-ui);
}
.zenfg-inspector-capture-context > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zenfg-inspector-capture-context > button {
  flex: 0 0 auto; padding: 2px 5px; border: 0; background: transparent; color: var(--fgd-text-secondary); font: inherit; cursor: pointer;
}
.zenfg-inspector-capture-context [data-tone='error'] { color: var(--fgd-danger); }
.zenfg-inspector-capture-context [data-tone='warning'] { color: var(--fgd-warning); }
.zenfg-inspector-diagnostic-badge { margin-left: 5px; padding: 1px 4px; border-radius: 4px; color: var(--fgd-warning); background: var(--fgd-surface-raised); font: 11px/1.2 var(--fgd-font-mono); }
.zenfg-inspector-feedback { border: 1px solid var(--fgd-border); border-radius: 4px; padding: 6px 10px; }
.zenfg-inspector-feedback summary { color: var(--fgd-text-secondary); cursor: pointer; }
.zenfg-inspector-feedback[data-tone='error'] { border-color: var(--fgd-danger); }
.zenfg-inspector-feedback[data-tone='error'] summary { color: var(--fgd-danger); }
.zenfg-inspector-feedback .zenfg-inspector-command-status {
  display: block; max-width: none; max-height: 140px; margin-top: 5px; overflow: auto;
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px;
}
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
.zenfg-inspector button:focus-visible,
.zenfg-inspector input:focus-visible,
.zenfg-inspector select:focus-visible,
.zenfg-inspector summary:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 1px; }
@container zenfg-inspector (max-width: 560px) {
  .zenfg-inspector-workbench-command-bar.branding-hidden { grid-template-columns: minmax(0, 1fr); }
  .zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-tabs { grid-column: 1; grid-row: 2; }
  .zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-actions { grid-column: 1; grid-row: 1; justify-content: end; }
  .zenfg-inspector-capture-context { gap: 4px; font-size: 11px; }
}
`;
