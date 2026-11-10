/** Shared single-source pass timing presentation for Overview and Passes. */
export const PANEL_TIMING_CSS = `
.zenfg-inspector .zenfg-inspector-timing-table[data-source] {
  width: 100%; min-width: 0; table-layout: fixed; border-collapse: separate; border-spacing: 0;
  color: var(--fgd-text); font: var(--fgd-font-size)/1.4 var(--fgd-font-ui);
}
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th,
.zenfg-inspector .zenfg-inspector-timing-table[data-source] td {
  min-width: 0; height: 44px; padding: 6px var(--fgd-space-2); vertical-align: middle;
  border-bottom: 1px solid var(--fgd-border-subtle); overflow-wrap: anywhere;
}
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column],
.zenfg-inspector .zenfg-inspector-timing-table[data-source] td[data-timing-column] { max-width: none; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th {
  height: 34px; position: sticky; top: 0; z-index: 2; color: var(--fgd-muted); background: var(--fgd-panel);
  font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); letter-spacing: 0; text-align: left;
}
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column='name'] { width: calc(clamp(220px, 32cqi, 360px) + var(--fgd-timing-name-gutter, 0px)); }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column='order'] { width: 54px; left: auto; text-align: center; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] td[data-timing-column='order'] { position: static; color: var(--fgd-muted); text-align: center; white-space: nowrap; font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); font-variant-numeric: tabular-nums; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column='time'] { width: calc(var(--fgd-font-size-small) * 8); text-align: right; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column='share'] { width: calc(var(--fgd-font-size-small) * 5.5); text-align: right; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] tbody tr:last-child td { border-bottom: 0; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] tbody tr:hover td,
.zenfg-inspector .zenfg-inspector-timing-table[data-source] tbody tr:focus-within td { background: var(--fgd-surface-hover); }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] [data-timing]::before { display: none; content: none; }
.zenfg-inspector-timing-identity { display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 0; }
.zenfg-inspector-timing-attributes { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--fgd-space-2); min-width: 0; }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-name {
  display: flex; gap: 0; width: 100%; min-width: 0; min-height: 24px; max-width: 100%; padding: 0; overflow: hidden;
  border: 0; border-radius: var(--fgd-radius-sm); color: var(--fgd-text-secondary); background: transparent;
  font: var(--fgd-font-size)/1.4 var(--fgd-font-ui); text-align: left; white-space: nowrap; cursor: pointer;
}
.zenfg-inspector-timing-name:hover { color: var(--fgd-text); text-decoration: underline; }
.zenfg-inspector-timing-name-prefix { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.zenfg-inspector-timing-name-suffix { display: flex; flex: 0 0 auto; justify-content: flex-end; max-width: 100%; overflow: hidden; }
.zenfg-inspector-timing-kind {
  --fgd-timing-kind: var(--fgd-muted); flex: 0 0 auto; padding: 1px 5px; border-radius: calc(var(--fgd-radius-sm) - 2px);
  color: color-mix(in srgb, var(--fgd-timing-kind) 90%, var(--fgd-text)); background: color-mix(in srgb, var(--fgd-timing-kind) 10%, var(--fgd-canvas));
  font: 500 var(--fgd-font-size-small)/1.3 var(--fgd-font-ui); white-space: nowrap;
}
.zenfg-inspector-timing-kind[data-kind='render'] { --fgd-timing-kind: var(--fgd-graph-render-stroke); }
.zenfg-inspector-timing-kind[data-kind='compute'] { --fgd-timing-kind: var(--fgd-graph-compute-stroke); }
.zenfg-inspector-timing-kind[data-kind='copy'] { --fgd-timing-kind: var(--fgd-graph-copy-stroke); }
.zenfg-inspector-timing-kind[data-kind='clear-buffer'] { --fgd-timing-kind: var(--fgd-graph-clear-stroke); }
.zenfg-inspector-timing-kind[data-kind='command'] { --fgd-timing-kind: var(--fgd-graph-command-stroke); }
.zenfg-inspector-timing-kind[data-kind='external-submission'] { --fgd-timing-kind: var(--fgd-graph-external-stroke); }
.zenfg-inspector-timing-accesses { display: flex; flex-wrap: wrap; gap: 2px var(--fgd-space-2); align-items: center; font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-timing-access { display: inline-flex; align-items: baseline; gap: var(--fgd-space-1); white-space: nowrap; }
.zenfg-inspector-timing-access[data-access='read'] .zenfg-inspector-timing-access-label { color: color-mix(in srgb, var(--fgd-graph-read) 90%, var(--fgd-text)); }
.zenfg-inspector-timing-access[data-access='write'] .zenfg-inspector-timing-access-label { color: color-mix(in srgb, var(--fgd-graph-write) 90%, var(--fgd-text)); }
.zenfg-inspector-timing-access[data-zero='true'] .zenfg-inspector-timing-access-label { color: var(--fgd-muted); }
.zenfg-inspector-timing-access-count { color: var(--fgd-text); font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); font-variant-numeric: tabular-nums; }
.zenfg-inspector-timing-axis { container: zenfg-timing-plot / inline-size; position: relative; min-width: 0; height: 18px; font-family: var(--fgd-font-mono); }
.zenfg-inspector-timing-axis > span { position: absolute; top: 0; white-space: nowrap; }
.zenfg-inspector-timing-axis > span:first-child { left: 0; }
.zenfg-inspector-timing-axis > span:nth-child(2) { left: 50%; transform: translateX(-50%); }
.zenfg-inspector-timing-axis > span:last-child { right: 0; }
.zenfg-inspector-timing-bar {
  display: flex; align-items: center; width: 100%; height: 16px; min-width: 0;
  background: linear-gradient(to right, transparent calc(50% - .5px), var(--fgd-border-subtle) calc(50% - .5px), var(--fgd-border-subtle) calc(50% + .5px), transparent calc(50% + .5px));
}
.zenfg-inspector-timing-bar > span { display: block; height: 10px; border-radius: 2px; background: var(--fgd-accent); }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-duration,
.zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-percentage {
  color: var(--fgd-text); text-align: right; white-space: nowrap; font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); font-variant-numeric: tabular-nums;
}
.zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-percentage { color: var(--fgd-muted); }
.zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-state { max-width: none; color: var(--fgd-muted); text-align: left; white-space: normal; }
.zenfg-inspector-timing-switch { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); background: var(--fgd-panel); }
.zenfg-inspector-timing-switch > button { min-height: 24px; padding: var(--fgd-space-1) var(--fgd-space-2); border: 0; border-radius: calc(var(--fgd-radius-sm) - 2px); color: var(--fgd-muted); background: transparent; font: 600 var(--fgd-font-size-small)/1 var(--fgd-font-ui); cursor: pointer; }
.zenfg-inspector-timing-switch > button:hover { color: var(--fgd-text); background: var(--fgd-surface-hover); }
.zenfg-inspector-timing-switch > button[aria-pressed='true'] { color: var(--fgd-accent); background: var(--fgd-accent-soft); }
@container zenfg-timing-plot (width < 220px) {
  .zenfg-inspector-timing-axis > span:nth-child(2) { display: none; }
}
@container zenfg-inspector-main (width < 600px) {
  .zenfg-inspector .zenfg-inspector-timing-table[data-source],
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] thead,
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] tbody { display: block; width: 100%; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] thead { position: static; height: auto; overflow: visible; clip-path: none; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] tr { display: grid; grid-template-columns: minmax(0, 1fr) calc(var(--fgd-font-size-small) * 7) calc(var(--fgd-font-size-small) * 4.5); align-items: center; column-gap: var(--fgd-space-2); }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] thead tr { padding-left: var(--fgd-space-2); padding-right: var(--fgd-space-2); }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column] { width: auto; position: static; height: auto; border-bottom: 0; padding: var(--fgd-space-2) 0; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] [data-timing-column='name'] { grid-column: 1 / -1; grid-row: 1; position: static; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] [data-timing-column='plot'] { grid-column: 1; grid-row: 2; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] [data-timing-column='time'] { grid-column: 2; grid-row: 2; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] [data-timing-column='share'] { grid-column: 3; grid-row: 2; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] tbody tr { padding: var(--fgd-space-2); row-gap: var(--fgd-space-1); border-top: 1px solid var(--fgd-border-subtle); }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] td[data-timing-column],
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-state { min-width: 0; height: auto; padding: 0; border-bottom: 0; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] .zenfg-inspector-timing-state { grid-column: 1 / -1; grid-row: 2; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] td[colspan]:not(.zenfg-inspector-timing-state) { grid-column: 1 / -1; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] th[data-timing-column='name'] { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] thead [data-timing-column='plot'],
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] thead [data-timing-column='time'],
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] thead [data-timing-column='share'] { grid-row: 1; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source] th[colspan] { grid-column: 1 / -1; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] tr { grid-template-columns: 36px minmax(0, 1fr) calc(var(--fgd-font-size-small) * 7) calc(var(--fgd-font-size-small) * 4.5); }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] [data-timing-column='order'] { grid-column: 1; grid-row: 1; position: static; align-self: start; min-height: 24px; line-height: 24px; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] [data-timing-column='name'] { grid-column: 2 / -1; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] [data-timing-column='plot'] { grid-column: 1 / 3; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] [data-timing-column='time'] { grid-column: 3; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] [data-timing-column='share'] { grid-column: 4; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] th[data-timing-column='order'] { position: absolute; width: 1px; height: 1px; min-height: 0; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .zenfg-inspector .zenfg-inspector-timing-table[data-source][data-order='true'] th[colspan] { grid-column: 1 / -1; }
  .zenfg-inspector-timing-axis > span:nth-child(2) { display: none; }
}
/* Let the table gutters extend into card padding while keeping text aligned. */
.zenfg-inspector .zenfg-inspector-overview-timings[data-source] { --fgd-timing-name-gutter: var(--fgd-space-2); width: calc(100% + 2 * var(--fgd-space-2)); margin-inline: calc(-1 * var(--fgd-space-2)); }
.zenfg-inspector .zenfg-inspector-overview-timings[data-source] thead > tr { background: var(--fgd-panel); }

`;
