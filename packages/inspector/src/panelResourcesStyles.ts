/** Resource identity, capture-wide size comparisons and explicit access navigation. */
export const PANEL_RESOURCES_CSS = `
.zenfg-inspector .zenfg-inspector-object-name.zenfg-inspector-relation-button {
  display: flex; width: 100%; min-width: 0; min-height: 24px; max-width: 100%; gap: 0; padding: 0;
  overflow: hidden; border: 0; background: transparent; text-align: left; white-space: nowrap;
  font: var(--fgd-font-size)/1.4 var(--fgd-font-ui);
}
.zenfg-inspector-name-prefix { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.zenfg-inspector-name-suffix { display: flex; flex: 0 0 auto; justify-content: flex-end; max-width: 100%; overflow: hidden; }
.zenfg-inspector .zenfg-inspector-resource-table {
  width: 100%; min-width: 0; table-layout: fixed; font: var(--fgd-font-size)/1.4 var(--fgd-font-ui);
}
.zenfg-inspector .zenfg-inspector-resource-table :is(th, td)[data-resource-column] {
  min-width: 0; max-width: none; height: 44px; padding: 6px var(--fgd-space-2); vertical-align: middle;
  border-bottom: 1px solid var(--fgd-border-subtle);
}
.zenfg-inspector .zenfg-inspector-resource-table th[data-resource-column] {
  height: 34px; font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); color: var(--fgd-muted); text-align: left;
}
.zenfg-inspector .zenfg-inspector-resource-table th[data-resource-column='name'] { width: clamp(240px, 36cqi, 440px); }
.zenfg-inspector .zenfg-inspector-resource-table th[data-resource-column='lifetime'] { width: calc(var(--fgd-font-size-small) * 10); }
.zenfg-inspector .zenfg-inspector-resource-table th[data-resource-column='access'] { width: calc(var(--fgd-font-size-small) * (13 + var(--fgd-resource-access-extra-digits, 0) * .6)); }
.zenfg-inspector .zenfg-inspector-resource-table tbody tr:last-child td { border-bottom: 0; }
.zenfg-inspector .zenfg-inspector-resource-table tbody tr:is(:hover, :focus-within) td { background: var(--fgd-surface-hover); }
.zenfg-inspector-resource-identity { display: grid; min-width: 0; gap: 2px; }
.zenfg-inspector-resource-attributes { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; gap: 3px var(--fgd-space-2); }
.zenfg-inspector-resource-badge {
  --fgd-resource-color: var(--fgd-muted); flex: 0 0 auto; padding: 1px 5px; border-radius: calc(var(--fgd-radius-sm) - 2px);
  color: color-mix(in srgb, var(--fgd-resource-color) 90%, var(--fgd-text)); background: color-mix(in srgb, var(--fgd-resource-color) 10%, var(--fgd-canvas));
  font: 500 var(--fgd-font-size-small)/1.3 var(--fgd-font-ui); white-space: nowrap;
}
.zenfg-inspector-resource-badge[data-kind='texture'] { --fgd-resource-color: var(--fgd-graph-texture-stroke); }
.zenfg-inspector-resource-badge[data-kind='buffer'] { --fgd-resource-color: var(--fgd-graph-buffer-stroke); }
.zenfg-inspector-resource-badge[data-origin='imported'],
.zenfg-inspector-resource-badge[data-origin='surface'] { --fgd-resource-color: var(--fgd-graph-external-stroke); }
.zenfg-inspector-resource-descriptor {
  min-width: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.zenfg-inspector-resource-size { display: grid; grid-template-columns: minmax(0, 1fr) var(--fgd-resource-size-width, 9ch); align-items: center; gap: var(--fgd-space-3); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); }
.zenfg-inspector-resource-size-label { display: none; }
.zenfg-inspector-resource-size-value { grid-column: 2; color: var(--fgd-text); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
[data-size-state='unknown'] .zenfg-inspector-resource-size-value { color: var(--fgd-muted); }
.zenfg-inspector-resource-size-bar { min-width: 0; display: block; height: 6px; border-radius: 2px; background: var(--fgd-border-subtle); }
.zenfg-inspector-resource-size-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--fgd-accent); }
.zenfg-inspector-resource-lifetime { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); overflow-wrap: anywhere; }
.zenfg-inspector-resource-order-label { display: none; }
.zenfg-inspector-inspector-summary .zenfg-inspector-resource-order-label { display: inline; }
.zenfg-inspector .zenfg-inspector-resource-lifetime .zenfg-inspector-relation-button { min-height: 24px; padding: 0 2px; font: inherit; white-space: nowrap; }
.zenfg-inspector-resource-accesses { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--fgd-space-2); }
.zenfg-inspector-resource-access {
  display: inline-flex; align-items: baseline; gap: var(--fgd-space-1); min-height: 24px; padding: 0; border: 0;
  border-radius: var(--fgd-radius-sm); background: transparent; color: var(--fgd-text); cursor: pointer;
  font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); white-space: nowrap;
}
.zenfg-inspector-resource-access > span, .zenfg-inspector-resource-access-mode { color: color-mix(in srgb, var(--fgd-graph-read) 90%, var(--fgd-text)); }
.zenfg-inspector-resource-access[data-access='write'] > span,
.zenfg-inspector-resource-access-mode[data-access='write'] { color: color-mix(in srgb, var(--fgd-graph-write) 90%, var(--fgd-text)); }
.zenfg-inspector-resource-access strong { color: var(--fgd-text); font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); font-variant-numeric: tabular-nums; }
.zenfg-inspector-resource-access:disabled { cursor: default; }
.zenfg-inspector-resource-access:disabled > span { color: var(--fgd-muted); }
.zenfg-inspector-resource-access:hover:enabled { text-decoration: underline; }
.zenfg-inspector-resource-table .zenfg-inspector-resource-accesses { flex-wrap: nowrap; }
.zenfg-inspector-resource-culled { display: block; min-height: calc(var(--fgd-font-size-small) * 1.4); color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector .zenfg-inspector-resource-table button:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
.zenfg-inspector-view-toolbar > button[hidden] { display: none; }
.zenfg-inspector-resource-notes { min-width: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-resource-notes > summary { width: fit-content; cursor: pointer; padding: var(--fgd-space-1); }
.zenfg-inspector-resource-notes[open] { flex-basis: 100%; }
.zenfg-inspector-resource-notes > p { max-height: 120px; overflow: auto; margin: var(--fgd-space-1) 0; overflow-wrap: anywhere; }
.zenfg-inspector-resource-notes > summary:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 2px; }
.zenfg-inspector-resource-access-filters { display: flex; flex-wrap: wrap; gap: var(--fgd-space-1); margin: var(--fgd-space-2) 0; }
.zenfg-inspector-resource-access-filters > button { min-height: 26px; padding: 2px 6px; font-size: var(--fgd-font-size-small); }
.zenfg-inspector-resource-access-filters > button[aria-pressed='true'] { border-color: var(--fgd-accent); background: var(--fgd-accent-soft); color: var(--fgd-accent); }
.zenfg-inspector-resource-access-records { display: grid; gap: var(--fgd-space-1); margin: var(--fgd-space-1) 0; padding-left: 18px; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-resource-access-records li { padding-left: 2px; overflow-wrap: anywhere; }
.zenfg-inspector-resource-pass-state { display: flex; flex-wrap: wrap; align-items: center; gap: var(--fgd-space-2); color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-resource-pass-state [data-state='culled'] { color: var(--fgd-warning); }
@container zenfg-inspector-main (width < 800px) {
  .zenfg-inspector .zenfg-inspector-resource-table,
  .zenfg-inspector .zenfg-inspector-resource-table tbody { display: block; width: 100%; min-width: 0; }
  .zenfg-inspector .zenfg-inspector-resource-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .zenfg-inspector .zenfg-inspector-resource-table tbody tr {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--fgd-space-2); row-gap: 3px;
    padding: var(--fgd-space-2); border-bottom: 1px solid var(--fgd-border-subtle);
  }
  .zenfg-inspector .zenfg-inspector-resource-table td[data-resource-column] { position: static; display: block; height: auto; padding: 0; border-bottom: 0; }
  .zenfg-inspector .zenfg-inspector-resource-table [data-resource-column='name'] { grid-column: 1 / -1; grid-row: 1; }
  .zenfg-inspector .zenfg-inspector-resource-table [data-resource-column='size'] { grid-column: 1 / -1; grid-row: 2; }
  .zenfg-inspector .zenfg-inspector-resource-table [data-resource-column='lifetime'] { grid-column: 1; grid-row: 3; }
  .zenfg-inspector .zenfg-inspector-resource-table [data-resource-column='access'] { grid-column: 2; grid-row: 3; }
  .zenfg-inspector .zenfg-inspector-resource-table [data-resource-column='size']::before { display: none; }
  .zenfg-inspector-resource-size { min-height: 24px; grid-template-columns: auto minmax(0, 1fr) var(--fgd-resource-size-width, 9ch); gap: var(--fgd-space-2); }
  .zenfg-inspector-resource-size-label { display: inline; grid-column: 1; color: var(--fgd-muted); font-family: var(--fgd-font-ui); }
  .zenfg-inspector-resource-size-bar { grid-column: 2; }
  .zenfg-inspector-resource-size-value { grid-column: 3; }
  .zenfg-inspector-resource-culled:empty { display: none; }
  .zenfg-inspector-resource-order-label { display: inline; }
  .zenfg-inspector .zenfg-inspector-resource-table tbody tr:not([data-selection-key]) { display: block; }
  .zenfg-inspector .zenfg-inspector-resource-table td[colspan] { padding: var(--fgd-space-2); }
}
`;
