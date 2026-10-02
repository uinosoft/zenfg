export const PANEL_OVERVIEW_CSS = `
.zenfg-inspector-capture-summary {
  display: grid; align-content: start; gap: var(--fgd-space-4); min-width: 0;
  color: var(--fgd-text); font-size: var(--fgd-font-size);
}
.zenfg-inspector-overview-summary,
.zenfg-inspector-overview-panel {
  min-width: 0; border: 1px solid var(--fgd-border-subtle); border-radius: var(--fgd-radius-sm);
  background: var(--fgd-canvas);
}
.zenfg-inspector-overview-context {
  display: flex; align-items: center; justify-content: space-between; gap: var(--fgd-space-3) var(--fgd-space-4);
  padding: var(--fgd-space-4) 20px; border-bottom: 1px solid var(--fgd-border-subtle);
}
.zenfg-inspector-overview-identity {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--fgd-space-1) var(--fgd-space-3); min-width: 0;
}
.zenfg-inspector-overview-identity > strong { font: 600 16px/1.4 var(--fgd-font-ui); }
.zenfg-inspector-overview-identity > span { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-overview-identity > span { padding-left: var(--fgd-space-3); border-left: 1px solid var(--fgd-border); }
.zenfg-inspector-overview-diagnostics {
  display: inline-flex; align-items: center; flex-wrap: wrap; justify-content: end; gap: 6px;
  min-width: 0; color: var(--fgd-muted); font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-overview-diagnostics > .zenfg-inspector-control-icon { color: var(--fgd-success); }
.zenfg-inspector-overview-diagnostics[data-tone='warning'],
.zenfg-inspector-overview-diagnostics[data-tone='warning'] > .zenfg-inspector-control-icon { color: var(--fgd-warning); }
.zenfg-inspector-overview-diagnostics[data-tone='error'],
.zenfg-inspector-overview-diagnostics[data-tone='error'] > .zenfg-inspector-control-icon { color: var(--fgd-danger); }
.zenfg-inspector-overview-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); min-width: 0; }
.zenfg-inspector-overview-kpi { display: grid; align-content: start; gap: var(--fgd-space-2); min-width: 0; padding: 20px; }
.zenfg-inspector-overview-kpi + .zenfg-inspector-overview-kpi { border-left: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-overview-label { color: var(--fgd-text-secondary); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-overview-value {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; min-width: 0;
  color: var(--fgd-text); font: 600 28px/1.2 var(--fgd-font-mono); letter-spacing: -.035em; overflow-wrap: anywhere;
}
.zenfg-inspector-overview-kpi[data-metric='gpu'] > .zenfg-inspector-overview-value { color: var(--fgd-accent); }
.zenfg-inspector-overview-unit { color: var(--fgd-muted); font: 500 var(--fgd-font-size)/1.3 var(--fgd-font-ui); letter-spacing: 0; }
.zenfg-inspector-overview-note {
  margin: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); overflow-wrap: anywhere;
}
.zenfg-inspector-overview-columns { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; gap: var(--fgd-space-4); min-width: 0; }
.zenfg-inspector-overview-panel { padding: 20px; }
.zenfg-inspector-overview-heading { display: flex; align-items: center; flex-wrap: wrap; gap: var(--fgd-space-2) var(--fgd-space-3); min-width: 0; margin-bottom: var(--fgd-space-3); }
.zenfg-inspector-overview-heading > h2 { margin: 0; color: var(--fgd-text); font: 600 16px/1.4 var(--fgd-font-ui); }
.zenfg-inspector-overview-heading > .zenfg-inspector-overview-link { margin-left: auto; }
.zenfg-inspector-overview-heading > .zenfg-inspector-overview-timing-switch { margin-left: auto; }
.zenfg-inspector-overview-timing-switch + .zenfg-inspector-overview-link { margin-left: 0; }
.zenfg-inspector-overview-link,
.zenfg-inspector-overview-pass {
  display: inline-flex; align-items: center; gap: var(--fgd-space-1); min-width: 0; min-height: 24px;
  padding: 0; border: 0; border-radius: var(--fgd-radius-sm); color: var(--fgd-accent); background: transparent;
  font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); text-align: left; cursor: pointer;
}
.zenfg-inspector-overview-link:hover:not(:disabled),
.zenfg-inspector-overview-pass:hover:not(:disabled) { color: var(--fgd-text); text-decoration: underline; }
.zenfg-inspector-overview-link > .zenfg-inspector-button-label { overflow-wrap: anywhere; }
.zenfg-inspector-overview-timing-switch { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); background: var(--fgd-panel); }
.zenfg-inspector-overview-timing-switch > button {
  min-height: 24px; padding: var(--fgd-space-1) var(--fgd-space-2); border: 0; border-radius: calc(var(--fgd-radius-sm) - 2px);
  color: var(--fgd-muted); background: transparent; font: 600 var(--fgd-font-size-small)/1 var(--fgd-font-ui); cursor: pointer;
}
.zenfg-inspector-overview-timing-switch > button:hover:not(:disabled) { color: var(--fgd-text); background: var(--fgd-surface-hover); }
.zenfg-inspector-overview-timing-switch > button[aria-pressed='true'] { color: var(--fgd-accent); background: var(--fgd-accent-soft); }
.zenfg-inspector-overview-coverage { margin: 0 0 var(--fgd-space-3); color: var(--fgd-muted); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-overview-timings { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--fgd-font-size); }
.zenfg-inspector-overview-timings th {
  padding: var(--fgd-space-2) 0; border-bottom: 1px solid var(--fgd-border); color: var(--fgd-muted);
  font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); text-align: left;
}
.zenfg-inspector-overview-timings th:nth-child(1) { width: 26%; }
.zenfg-inspector-overview-timings th:nth-child(2) { width: 16%; }
.zenfg-inspector-overview-timings th:nth-child(3) { width: 18%; text-align: right; }
.zenfg-inspector-overview-timings th:nth-child(4) { width: 40%; text-align: right; }
.zenfg-inspector-overview-timings td { height: 42px; padding: 6px 0; border-bottom: 1px solid var(--fgd-border-subtle); vertical-align: middle; overflow-wrap: anywhere; }
.zenfg-inspector-overview-timings td:first-child { padding-right: var(--fgd-space-2); }
.zenfg-inspector-overview-timings tbody tr:last-child td { border-bottom: 0; }
.zenfg-inspector-overview-pass { display: block; max-width: 100%; overflow: hidden; color: var(--fgd-text-secondary); font-size: var(--fgd-font-size); text-overflow: ellipsis; white-space: nowrap; }
.zenfg-inspector-overview-kind { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-overview-duration { color: var(--fgd-text); font-family: var(--fgd-font-mono); font-size: var(--fgd-font-size-small); text-align: right; white-space: nowrap; }
.zenfg-inspector-overview-share { display: flex; align-items: center; justify-content: end; gap: var(--fgd-space-2); min-width: 0; padding-left: var(--fgd-space-2); }
.zenfg-inspector-overview-bar { flex: 1 1 0; min-width: 8px; height: 6px; overflow: hidden; border-radius: 2px; background: var(--fgd-border-subtle); }
.zenfg-inspector-overview-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--fgd-accent); }
.zenfg-inspector-overview-percentage { flex: 0 0 auto; min-width: 38px; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); text-align: right; }
.zenfg-inspector-overview-timings + .zenfg-inspector-overview-note { margin-top: var(--fgd-space-2); }
.zenfg-inspector-overview-external { display: flex; align-items: flex-start; gap: 6px; margin: var(--fgd-space-3) 0 0; color: var(--fgd-warning); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-overview-external > .zenfg-inspector-control-icon { margin-top: 2px; }
.zenfg-inspector-overview-work { margin-top: var(--fgd-space-4); padding-top: var(--fgd-space-4); border-top: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-overview-work h2 { margin: 0; color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-overview-kinds { display: flex; align-items: center; flex-wrap: wrap; gap: 6px var(--fgd-space-4); margin-bottom: var(--fgd-space-2); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-overview-kinds > span { display: inline-flex; align-items: baseline; gap: var(--fgd-space-1); }
.zenfg-inspector-overview-facts { display: grid; gap: var(--fgd-space-3); min-width: 0; margin: 0; }
.zenfg-inspector-overview-facts > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--fgd-space-1) var(--fgd-space-3); min-width: 0; }
.zenfg-inspector-overview-facts dt { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-overview-facts dd { min-width: 0; margin: 0; color: var(--fgd-text-secondary); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); text-align: right; overflow-wrap: anywhere; }
.zenfg-inspector-overview-pool { margin-top: var(--fgd-space-4); padding-top: var(--fgd-space-4); border-top: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-overview-pool > h3 { margin: 0 0 var(--fgd-space-3); color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-overview-panel > footer { margin-top: var(--fgd-space-4); }
.zenfg-inspector-overview-details { min-width: 0; border: 1px solid var(--fgd-border-subtle); border-radius: var(--fgd-radius-sm); background: var(--fgd-canvas); }
.zenfg-inspector-overview-details > summary { display: flex; align-items: center; gap: var(--fgd-space-2); min-height: var(--fgd-control-height); padding: var(--fgd-space-2) 20px; color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); list-style: none; cursor: pointer; }
.zenfg-inspector-overview-details > summary::-webkit-details-marker { display: none; }
.zenfg-inspector-overview-details > summary > .zenfg-inspector-control-icon { transition: transform 120ms ease; }
.zenfg-inspector-overview-details[open] > summary > .zenfg-inspector-control-icon { transform: rotate(90deg); }
.zenfg-inspector-overview-details > .zenfg-inspector-overview-facts { padding: var(--fgd-space-3) 20px var(--fgd-space-4) 42px; max-width: 900px; }
.zenfg-inspector-overview-details .zenfg-inspector-overview-facts > div { grid-template-columns: minmax(140px, 1fr) minmax(0, 3fr); }
.zenfg-inspector-overview-details .zenfg-inspector-overview-facts dd { text-align: left; }
.zenfg-inspector-overview-kind[data-kind='render'], .zenfg-inspector-overview-kinds > [data-kind='render'] { color: var(--fgd-graph-render-stroke); }
.zenfg-inspector-overview-kind[data-kind='compute'], .zenfg-inspector-overview-kinds > [data-kind='compute'] { color: var(--fgd-graph-compute-stroke); }
.zenfg-inspector-overview-kind[data-kind='copy'], .zenfg-inspector-overview-kinds > [data-kind='copy'] { color: var(--fgd-graph-copy-stroke); }
.zenfg-inspector-overview-kind[data-kind='clear-buffer'], .zenfg-inspector-overview-kinds > [data-kind='clear-buffer'] { color: var(--fgd-graph-clear-stroke); }
.zenfg-inspector-overview-kind[data-kind='command'], .zenfg-inspector-overview-kinds > [data-kind='command'] { color: var(--fgd-graph-command-stroke); }
.zenfg-inspector-overview-kind[data-kind='external-submission'], .zenfg-inspector-overview-kinds > [data-kind='external-submission'] { color: var(--fgd-graph-external-stroke); }
@container zenfg-inspector-main (max-width: 999px) {
  .zenfg-inspector-overview-columns { grid-template-columns: minmax(0, 1fr); }
  .zenfg-inspector-overview-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .zenfg-inspector-overview-kpi:nth-child(3) { border-left: 0; }
  .zenfg-inspector-overview-kpi:nth-child(n + 3) { border-top: 1px solid var(--fgd-border-subtle); }
}
@container zenfg-inspector-main (max-width: 599px) {
  .zenfg-inspector-overview-context { align-items: flex-start; flex-direction: column; padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-identity > .zenfg-inspector-overview-source { flex-basis: 100%; padding-left: 0; border-left: 0; }
  .zenfg-inspector-overview-diagnostics { justify-content: start; }
  .zenfg-inspector-overview-kpis { grid-template-columns: minmax(0, 1fr); }
  .zenfg-inspector-overview-kpi { padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-kpi + .zenfg-inspector-overview-kpi { border-left: 0; border-top: 1px solid var(--fgd-border-subtle); }
  .zenfg-inspector-overview-panel { padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-heading > .zenfg-inspector-overview-link { margin-left: 0; }
  .zenfg-inspector-overview-heading > .zenfg-inspector-overview-timing-switch { margin-left: 0; }
  .zenfg-inspector-overview-timings th:nth-child(1) { width: 35%; }
  .zenfg-inspector-overview-timings th:nth-child(2) { width: 20%; }
  .zenfg-inspector-overview-timings th:nth-child(3) { width: 24%; }
  .zenfg-inspector-overview-timings th:nth-child(4) { width: 21%; }
  .zenfg-inspector-overview-share { gap: var(--fgd-space-1); }
  .zenfg-inspector-overview-details .zenfg-inspector-overview-facts > div { grid-template-columns: minmax(0, 1fr); }
}
`;
