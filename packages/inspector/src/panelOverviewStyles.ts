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
.zenfg-inspector-overview-heading > .zenfg-inspector-timing-switch { margin-left: auto; }
.zenfg-inspector-timing-switch + .zenfg-inspector-overview-link { margin-left: 0; }
.zenfg-inspector-overview-link { display: inline-flex; align-items: center; gap: var(--fgd-space-1); min-width: 0; min-height: 24px; padding: 0; border: 0; border-radius: var(--fgd-radius-sm); color: var(--fgd-accent); background: transparent; font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); text-align: left; cursor: pointer; }
.zenfg-inspector-overview-link:hover:not(:disabled) { color: var(--fgd-text); text-decoration: underline; }
.zenfg-inspector-overview-link > .zenfg-inspector-button-label { overflow-wrap: anywhere; }
.zenfg-inspector-overview-coverage { margin: 0 0 var(--fgd-space-3); color: var(--fgd-muted); font-size: var(--fgd-font-size-small); overflow-wrap: anywhere; }
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
@container zenfg-overview-resources (min-width: 640px) {
  .zenfg-inspector-overview-resource-body { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; }
  .zenfg-inspector-overview-resource-body > .zenfg-inspector-overview-pool { padding-top: 0; padding-left: 20px; border-top: 0; border-left: 1px solid var(--fgd-border-subtle); }
}
@container zenfg-inspector-main (width < 1000px) {
  .zenfg-inspector-overview-columns { grid-template-columns: minmax(0, 1fr); }
}
@container zenfg-inspector-main (width < 900px) {
  .zenfg-inspector-overview-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .zenfg-inspector-overview-kpi:nth-child(3) { border-left: 0; }
  .zenfg-inspector-overview-kpi:nth-child(n + 3) { border-top: 1px solid var(--fgd-border-subtle); }
}
@container zenfg-inspector-main (width < 600px) {
  .zenfg-inspector-overview-context { align-items: flex-start; flex-direction: column; padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-identity > .zenfg-inspector-overview-source { flex-basis: 100%; padding-left: 0; border-left: 0; }
  .zenfg-inspector-overview-diagnostics { justify-content: start; }
  .zenfg-inspector-overview-kpi { padding: var(--fgd-space-3); }
  .zenfg-inspector-overview-value { font-size: 24px; }
  .zenfg-inspector-overview-panel { padding: var(--fgd-space-4); }
  .zenfg-inspector-overview-heading > .zenfg-inspector-overview-link { margin-left: 0; }
  .zenfg-inspector-overview-heading > .zenfg-inspector-timing-switch { margin-left: 0; }
  .zenfg-inspector-overview-details .zenfg-inspector-overview-facts > div { grid-template-columns: minmax(0, 1fr); }
}
`;
