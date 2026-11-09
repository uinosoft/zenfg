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
  padding: var(--fgd-space-3) 20px; border-bottom: 1px solid var(--fgd-border-subtle);
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
.zenfg-inspector-overview-kpi { display: grid; align-content: start; gap: 6px; min-width: 0; padding: var(--fgd-space-4) 20px; }
.zenfg-inspector-overview-kpi + .zenfg-inspector-overview-kpi { border-left: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-overview-label { color: var(--fgd-text-secondary); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-overview-value {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; min-width: 0;
  color: var(--fgd-text); font: 600 28px/1.2 var(--fgd-font-mono); letter-spacing: -.035em; overflow-wrap: anywhere;
}
.zenfg-inspector-overview-kpi[data-metric='gpu'] > .zenfg-inspector-overview-value { color: var(--fgd-accent); }
.zenfg-inspector-overview-kpi > .zenfg-inspector-overview-value[data-state='unknown'] {
  color: var(--fgd-text-secondary); font: 400 var(--fgd-font-size)/1.4 var(--fgd-font-ui); letter-spacing: 0;
}
.zenfg-inspector-overview-unit { color: var(--fgd-muted); font: 500 var(--fgd-font-size)/1.3 var(--fgd-font-ui); letter-spacing: 0; }
.zenfg-inspector-overview-note {
  margin: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); overflow-wrap: anywhere;
}
.zenfg-inspector-overview-columns { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; gap: var(--fgd-space-4); min-width: 0; }
.zenfg-inspector-overview-side { display: grid; align-content: start; gap: var(--fgd-space-4); min-width: 0; }
.zenfg-inspector-overview-panel { padding: 20px; }
.zenfg-inspector-overview-timing-panel { container: zenfg-overview-timing / inline-size; }
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
.zenfg-inspector-overview-timings th:nth-child(1) { width: 36%; }
.zenfg-inspector-overview-timings th:nth-child(3) { width: 96px; text-align: right; }
.zenfg-inspector-overview-timings th:nth-child(4) { width: 68px; text-align: right; }
.zenfg-inspector-overview-timings .zenfg-inspector-overview-timing-axis,
.zenfg-inspector-overview-timings .zenfg-inspector-overview-plot { padding-right: var(--fgd-space-4); }
.zenfg-inspector-overview-axis { position: relative; height: 18px; min-width: 0; font-family: var(--fgd-font-mono); }
.zenfg-inspector-overview-axis > span { position: absolute; top: 0; white-space: nowrap; }
.zenfg-inspector-overview-axis > span:first-child { left: 0; }
.zenfg-inspector-overview-axis > span:nth-child(2) { left: 50%; transform: translateX(-50%); }
.zenfg-inspector-overview-axis > span:last-child { right: 0; }
.zenfg-inspector-overview-timings td { height: 42px; padding: 6px 0; border-bottom: 1px solid var(--fgd-border-subtle); vertical-align: middle; overflow-wrap: anywhere; }
.zenfg-inspector-overview-timings td:first-child { padding-right: var(--fgd-space-4); }
.zenfg-inspector-overview-timings tbody tr:last-child td { border-bottom: 0; }
.zenfg-inspector-overview-timings tbody tr[data-node-id]:hover,
.zenfg-inspector-overview-timings tbody tr[data-node-id]:focus-within { background: var(--fgd-surface-hover); }
.zenfg-inspector-overview-pass-identity { display: flex; align-items: center; gap: var(--fgd-space-2); min-width: 0; }
.zenfg-inspector-overview-pass {
  display: flex; gap: 0; max-width: 100%; min-width: 0; overflow: hidden; color: var(--fgd-text-secondary);
  font-size: var(--fgd-font-size); white-space: nowrap;
}
.zenfg-inspector-overview-pass-prefix { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.zenfg-inspector-overview-pass-suffix { flex: 0 0 auto; }
.zenfg-inspector-overview-kind { flex: 0 0 auto; color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-overview-duration { color: var(--fgd-text); font-family: var(--fgd-font-mono); font-size: var(--fgd-font-size-small); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.zenfg-inspector-overview-bar {
  display: flex; align-items: center; width: 100%; min-width: 0; height: 16px;
  background: linear-gradient(to right, transparent calc(50% - .5px), var(--fgd-border-subtle) calc(50% - .5px), var(--fgd-border-subtle) calc(50% + .5px), transparent calc(50% + .5px));
}
.zenfg-inspector-overview-bar > span { display: block; height: 12px; border-radius: 2px; background: var(--fgd-accent); }
.zenfg-inspector-overview-percentage { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.zenfg-inspector-overview-timing-summary { display: grid; gap: var(--fgd-space-2); margin-top: var(--fgd-space-3); padding-top: var(--fgd-space-3); border-top: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-overview-timing-totals { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--fgd-space-2) var(--fgd-space-4); min-width: 0; color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-overview-timing-totals > span { display: inline-flex; flex-wrap: wrap; gap: var(--fgd-space-1) var(--fgd-space-2); min-width: 0; }
.zenfg-inspector-overview-timing-totals strong { color: var(--fgd-text-secondary); font: 500 var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); font-variant-numeric: tabular-nums; }
.zenfg-inspector-overview-timing-composition { display: flex; height: 6px; overflow: hidden; border-radius: 2px; background: var(--fgd-border-subtle); }
.zenfg-inspector-overview-timing-composition > span:first-child { flex: 0 0 var(--top-share, 0%); background: var(--fgd-accent); }
.zenfg-inspector-overview-timing-composition > span:last-child { flex: 1 1 0; }
.zenfg-inspector-overview-timings + .zenfg-inspector-overview-note { margin-top: var(--fgd-space-2); }
.zenfg-inspector-overview-scope-note { margin-top: var(--fgd-space-2); }
.zenfg-inspector-overview-external { display: flex; align-items: flex-start; gap: 6px; margin: var(--fgd-space-3) 0 0; color: var(--fgd-warning); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-overview-external > .zenfg-inspector-control-icon { margin-top: 2px; }
.zenfg-inspector-overview-facts { display: grid; gap: var(--fgd-space-3); min-width: 0; margin: 0; }
.zenfg-inspector-overview-facts > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--fgd-space-1) var(--fgd-space-3); min-width: 0; }
.zenfg-inspector-overview-facts dt { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
.zenfg-inspector-overview-facts dd { min-width: 0; margin: 0; color: var(--fgd-text-secondary); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-mono); text-align: right; overflow-wrap: anywhere; }
.zenfg-inspector-overview-fact-detail { display: block; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-overview-report-state { margin: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-overview-allocations { min-width: 0; }
.zenfg-inspector-overview-allocations > .zenfg-inspector-overview-facts + .zenfg-inspector-overview-report-state { margin-top: var(--fgd-space-3); }
.zenfg-inspector-overview-pool { margin-top: var(--fgd-space-4); padding-top: var(--fgd-space-4); border-top: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-overview-pool > h3 { margin: 0 0 var(--fgd-space-3); color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-overview-resources { container: zenfg-overview-resources / inline-size; }
.zenfg-inspector-overview-resource-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--fgd-space-4); }
.zenfg-inspector-overview-resource-body > .zenfg-inspector-overview-pool { margin-top: 0; }
.zenfg-inspector-overview-panel > footer { display: flex; flex-wrap: wrap; gap: var(--fgd-space-2) var(--fgd-space-4); margin-top: var(--fgd-space-4); }
.zenfg-inspector-overview-details { min-width: 0; border: 1px solid var(--fgd-border-subtle); border-radius: var(--fgd-radius-sm); background: var(--fgd-canvas); }
.zenfg-inspector-overview-details > summary { display: flex; align-items: center; gap: var(--fgd-space-2); min-height: var(--fgd-control-height); padding: var(--fgd-space-2) 20px; color: var(--fgd-text-secondary); font: 600 var(--fgd-font-size)/1.4 var(--fgd-font-ui); list-style: none; cursor: pointer; }
.zenfg-inspector-overview-details > summary::-webkit-details-marker { display: none; }
.zenfg-inspector-overview-details > summary > .zenfg-inspector-control-icon { transition: transform 120ms ease; }
.zenfg-inspector-overview-details[open] > summary > .zenfg-inspector-control-icon { transform: rotate(90deg); }
.zenfg-inspector-overview-details > .zenfg-inspector-overview-facts { padding: var(--fgd-space-3) 20px var(--fgd-space-4) 42px; max-width: 900px; }
.zenfg-inspector-overview-details .zenfg-inspector-overview-facts > div { grid-template-columns: minmax(140px, 1fr) minmax(0, 3fr); }
.zenfg-inspector-overview-details .zenfg-inspector-overview-facts dd { text-align: left; }
.zenfg-inspector-overview-kind[data-kind='render'] { color: var(--fgd-graph-render-stroke); }
.zenfg-inspector-overview-kind[data-kind='compute'] { color: var(--fgd-graph-compute-stroke); }
.zenfg-inspector-overview-kind[data-kind='copy'] { color: var(--fgd-graph-copy-stroke); }
.zenfg-inspector-overview-kind[data-kind='clear-buffer'] { color: var(--fgd-graph-clear-stroke); }
.zenfg-inspector-overview-kind[data-kind='command'] { color: var(--fgd-graph-command-stroke); }
.zenfg-inspector-overview-kind[data-kind='external-submission'] { color: var(--fgd-graph-external-stroke); }
@container zenfg-overview-resources (min-width: 640px) {
  .zenfg-inspector-overview-resource-body { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; }
  .zenfg-inspector-overview-resource-body > .zenfg-inspector-overview-pool { padding-top: 0; padding-left: 20px; border-top: 0; border-left: 1px solid var(--fgd-border-subtle); }
}
@container zenfg-inspector-main (max-width: 999px) {
  .zenfg-inspector-overview-columns { grid-template-columns: minmax(0, 1fr); }
}
@container zenfg-inspector-main (max-width: 899px) {
  .zenfg-inspector-overview-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .zenfg-inspector-overview-kpi:nth-child(3) { border-left: 0; }
  .zenfg-inspector-overview-kpi:nth-child(n + 3) { border-top: 1px solid var(--fgd-border-subtle); }
}
@container zenfg-overview-timing (max-width: 720px) {
  .zenfg-inspector-overview-timings th:nth-child(1) { width: 40%; }
  .zenfg-inspector-overview-timings td { height: 46px; padding-top: 5px; padding-bottom: 5px; }
  .zenfg-inspector-overview-pass-identity { flex-direction: column; align-items: flex-start; gap: 0; }
  .zenfg-inspector-overview-pass { min-height: 18px; }
  .zenfg-inspector-overview-kind { line-height: 1.2; }
}
@container zenfg-inspector-main (max-width: 599px) {
  .zenfg-inspector-overview-context { align-items: flex-start; flex-direction: column; padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-identity > .zenfg-inspector-overview-source { flex-basis: 100%; padding-left: 0; border-left: 0; }
  .zenfg-inspector-overview-diagnostics { justify-content: start; }
  .zenfg-inspector-overview-kpi { padding: var(--fgd-space-3); }
  .zenfg-inspector-overview-value { font-size: 24px; }
  .zenfg-inspector-overview-panel { padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-heading > .zenfg-inspector-overview-link { margin-left: 0; }
  .zenfg-inspector-overview-heading > .zenfg-inspector-overview-timing-switch { margin-left: 0; }
  .zenfg-inspector-overview-timings,
  .zenfg-inspector-overview-timings thead,
  .zenfg-inspector-overview-timings tbody { display: block; }
  .zenfg-inspector-overview-timings tr { display: grid; grid-template-columns: minmax(0, 1fr) 80px 52px; align-items: center; column-gap: var(--fgd-space-2); }
  .zenfg-inspector-overview-timings th:nth-child(n) { width: auto; border-bottom: 0; }
  .zenfg-inspector-overview-timings th:first-child { grid-column: 1 / -1; }
  .zenfg-inspector-overview-timings th:nth-child(3) { grid-column: 2; grid-row: 2; }
  .zenfg-inspector-overview-timings th:nth-child(4) { grid-column: 3; grid-row: 2; }
  .zenfg-inspector-overview-timings .zenfg-inspector-overview-timing-axis { grid-column: 1; grid-row: 2; padding: var(--fgd-space-2) 0; }
  .zenfg-inspector-overview-axis > span:nth-child(2) { display: none; }
  .zenfg-inspector-overview-timings tbody tr { padding: var(--fgd-space-2) 0; border-top: 1px solid var(--fgd-border-subtle); row-gap: var(--fgd-space-1); }
  .zenfg-inspector-overview-timings td { min-width: 0; height: auto; padding: 0; border-bottom: 0; }
  .zenfg-inspector-overview-timings td:first-child { grid-column: 1 / -1; padding-right: 0; }
  .zenfg-inspector-overview-timings .zenfg-inspector-overview-plot { grid-column: 1; grid-row: 2; padding-right: 0; }
  .zenfg-inspector-overview-timings .zenfg-inspector-overview-duration { grid-column: 2; grid-row: 2; }
  .zenfg-inspector-overview-timings .zenfg-inspector-overview-percentage { grid-column: 3; grid-row: 2; }
  .zenfg-inspector-overview-pass-identity { flex-direction: row; align-items: center; gap: var(--fgd-space-2); }
  .zenfg-inspector-overview-pass { min-height: 24px; }
  .zenfg-inspector-overview-kind { line-height: 1.4; }
  .zenfg-inspector-overview-timing-empty { grid-column: 1 / -1; }
  .zenfg-inspector-overview-details .zenfg-inspector-overview-facts > div { grid-template-columns: minmax(0, 1fr); }
}
`;
