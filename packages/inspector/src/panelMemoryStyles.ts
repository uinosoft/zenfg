/** Compact capacity summaries and a capture-wide inclusive Pass Order timeline. */
export const PANEL_MEMORY_CSS = `
.zenfg-inspector-memory-view { grid-template-rows: minmax(0, 1fr); container: zenfg-memory / inline-size; }
.zenfg-inspector-memory-scroller { min-width: 0; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.zenfg-inspector-memory-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; padding: 0; border-bottom: 0; background: var(--fgd-canvas); }
.zenfg-inspector-memory-summary > .zenfg-inspector-memory-metric { padding: 10px var(--fgd-space-3) 4px; border: 0; border-radius: 0; background: transparent; }
.zenfg-inspector-memory-summary > .zenfg-inspector-memory-metric + .zenfg-inspector-memory-metric { border-left: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-metric { display: grid; align-content: start; gap: 3px; min-width: 0; }
.zenfg-inspector-memory-metric-label { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-memory-metric strong { color: var(--fgd-text); font: 600 clamp(18px, 3cqi, 22px)/1.3 var(--fgd-font-mono); white-space: normal; overflow-wrap: anywhere; }
.zenfg-inspector-memory-metric .zenfg-inspector-memory-state-value { font: 500 var(--fgd-font-size)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-unit { color: var(--fgd-muted); font: 400 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-metric small { color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-memory-report-state { grid-column: 1 / -1; margin: 0; padding: var(--fgd-space-3); color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); overflow-wrap: anywhere; }
.zenfg-inspector-memory-allocation-stats { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px var(--fgd-space-3); padding: var(--fgd-space-1) var(--fgd-space-3) var(--fgd-space-2); border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-allocation-stats .zenfg-inspector-memory-metric { display: flex; align-items: baseline; gap: var(--fgd-space-1); }
.zenfg-inspector-memory-allocation-stats strong { font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); }
.zenfg-inspector-memory-allocation-stats > p { margin: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-pool { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--fgd-space-2) var(--fgd-space-4); padding: var(--fgd-space-2) var(--fgd-space-3); border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-pool > h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.zenfg-inspector-memory-pool-metrics { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: var(--fgd-space-2) var(--fgd-space-4); min-width: 0; }
.zenfg-inspector-memory-pool-metrics .zenfg-inspector-memory-metric { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 6px; }
.zenfg-inspector-memory-pool-metrics strong { font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-mono); }
.zenfg-inspector-memory-pool-metrics > p { margin: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-controls { position: sticky; top: 0; z-index: 4; min-width: 0; background: var(--fgd-canvas); border-bottom: 1px solid var(--fgd-border); }
.zenfg-inspector-memory-controls .zenfg-inspector-view-toolbar { border-bottom: 0; gap: var(--fgd-space-2); padding: var(--fgd-space-2); }
.zenfg-inspector-memory-estimate-details { min-width: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-estimate-details > summary { display: flex; align-items: center; gap: var(--fgd-space-1); width: fit-content; min-height: 24px; cursor: pointer; list-style: none; }
.zenfg-inspector-memory-estimate-details > summary::-webkit-details-marker { display: none; }
.zenfg-inspector-memory-estimate-details[open] { flex-basis: 100%; }
.zenfg-inspector-memory-estimate-details[open] > summary > svg { transform: rotate(90deg); }
.zenfg-inspector-memory-estimate-content { max-height: 144px; overflow: auto; padding: var(--fgd-space-2) 0; font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-memory-estimate-content > p { margin: var(--fgd-space-2) 0 0; overflow-wrap: anywhere; }
.zenfg-inspector-memory-estimate-facts { display: grid; gap: 4px; margin: 0; }
.zenfg-inspector-memory-estimate-facts > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--fgd-space-2); }
.zenfg-inspector-memory-estimate-facts dt { color: var(--fgd-muted); }
.zenfg-inspector-memory-estimate-facts dd { min-width: 0; margin: 0; font-family: var(--fgd-font-mono); overflow-wrap: anywhere; }
.zenfg-inspector-memory-timeline { display: grid; align-content: start; grid-template-columns: minmax(0, 1fr); min-width: 0; padding: 0 var(--fgd-space-2) var(--fgd-space-2); }

.zenfg-inspector-memory-axis, .zenfg-inspector-memory-resource, .zenfg-inspector-memory-allocation {
  display: grid; grid-template-columns: clamp(260px, 34cqi, 420px) max(88px, calc(var(--fgd-memory-range-width, 5ch) + 8px)) minmax(0, 1fr) max(104px, var(--fgd-memory-size-width, 11ch));
  align-items: center; column-gap: var(--fgd-space-2); min-width: 0; padding: 4px var(--fgd-space-2);
  font: var(--fgd-font-size-small)/1.4 var(--fgd-font-mono);
}
.zenfg-inspector-memory-axis { position: static; min-height: 34px; padding-block: 4px; margin: 0 calc(var(--fgd-space-2) + 1px); color: var(--fgd-muted); background: var(--fgd-canvas); }
.zenfg-inspector-memory-axis > span { min-width: 0; font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-axis > :last-child { text-align: right; }
.zenfg-inspector-memory-axis-track, .zenfg-inspector .zenfg-inspector-memory-track { grid-column: 3; position: relative; min-width: 0; height: 24px; }
.zenfg-inspector-memory-axis-track { height: 20px; border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-axis-track > span { position: absolute; bottom: 2px; left: clamp(var(--fgd-memory-tick-half-width), var(--fgd-memory-tick-position), calc(100% - var(--fgd-memory-tick-half-width))); padding: 0; border: 0; transform: translateX(-50%); font: var(--fgd-font-size-small)/1.3 var(--fgd-font-mono); }
.zenfg-inspector-memory-allocation-group { min-width: 0; margin-block: 2px; border: 1px solid transparent; border-bottom-color: var(--fgd-border-subtle); }
.zenfg-inspector-memory-allocation-group.is-expanded { border-color: var(--fgd-border-subtle); border-radius: var(--fgd-radius-sm); overflow: hidden; }
.zenfg-inspector-memory-allocation { min-height: 54px; margin: 0; border: 0; background: var(--fgd-surface); scroll-margin-block: 4px; }
.zenfg-inspector-memory-allocation-resources { min-width: 0; }
.zenfg-inspector-memory-allocation-group.is-expanded > .zenfg-inspector-memory-allocation { border-bottom: 1px solid var(--fgd-border-subtle); }
.zenfg-inspector-memory-resource { min-height: 38px; border-bottom: 1px solid var(--fgd-border-subtle); scroll-margin-block: 4px; }
.zenfg-inspector-memory-resource:last-child { border-bottom: 0; }
.zenfg-inspector-memory-name { min-width: 0; }
.zenfg-inspector-memory-allocation-resources .zenfg-inspector-memory-name { padding-left: 42px; }
.zenfg-inspector-memory-identity { display: grid; gap: 2px; min-width: 0; }
.zenfg-inspector-memory-title { display: flex; align-items: center; gap: var(--fgd-space-1); min-width: 0; }
.zenfg-inspector .zenfg-inspector-memory-title > .zenfg-inspector-object-name.zenfg-inspector-relation-button { flex: 0 1 auto; width: auto; align-items: center; }
.zenfg-inspector .zenfg-inspector-memory-title > .zenfg-inspector-memory-allocation-link { flex: 1 1 auto; }
.zenfg-inspector-memory-attributes { display: flex; align-items: baseline; gap: 3px 6px; min-width: 0; color: var(--fgd-muted); font: var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
.zenfg-inspector-memory-allocation .zenfg-inspector-memory-attributes { padding-left: 30px; min-height: 20px; }
.zenfg-inspector .zenfg-inspector-memory-preview.zenfg-inspector-object-name { flex: 1 1 0; align-items: center; width: auto; min-height: 20px; font: inherit; }
.zenfg-inspector-memory-member-count { min-width: 0; overflow-wrap: anywhere; }
.zenfg-inspector-memory-toggle-spacer, .zenfg-inspector button.zenfg-inspector-memory-reveal, .zenfg-inspector button.zenfg-inspector-memory-toggle { flex: 0 0 26px; width: 26px; min-width: 26px; height: 26px; min-height: 26px; padding: 0; }
.zenfg-inspector-memory-sharing { flex: 0 0 auto; padding: 1px 4px; border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); color: var(--fgd-text-secondary); font: 500 var(--fgd-font-size-small)/1.3 var(--fgd-font-ui); white-space: nowrap; }
.zenfg-inspector-memory-range { display: grid; gap: 1px; min-width: 0; color: var(--fgd-muted); }
.zenfg-inspector-memory-range .zenfg-inspector-resource-order-label { display: none; }
.zenfg-inspector-memory-coverage-state { color: var(--fgd-muted); font: 10.5px/1.3 var(--fgd-font-ui); }
.zenfg-inspector .zenfg-inspector-memory-track { display: block; padding: 0; border: 0; border-radius: 2px; background: transparent; color: inherit; cursor: pointer; }
.zenfg-inspector .zenfg-inspector-memory-track:disabled { cursor: default; }
.zenfg-inspector-memory-gridline { position: absolute; height: 100%; top: 0; border-left: 1px dotted var(--fgd-border-subtle); pointer-events: none; }
.zenfg-inspector-memory-bar { position: absolute; min-width: 0; top: 7px; height: 10px; border-radius: 2px; pointer-events: none; }
.zenfg-inspector-memory-resource:is(:hover, :focus-within), .zenfg-inspector-memory-allocation:is(:hover, :focus-within) { background: var(--fgd-surface-hover); }
.zenfg-inspector-memory-resource.selected, .zenfg-inspector-memory-allocation.selected { background: var(--fgd-accent-soft); box-shadow: inset 2px 0 var(--fgd-accent); }
.zenfg-inspector-memory-allocation-group.related-allocation > .zenfg-inspector-memory-allocation,
.zenfg-inspector-memory-allocation-group:has(.zenfg-inspector-memory-resource:is(:hover, :focus-within)) > .zenfg-inspector-memory-allocation { box-shadow: inset 2px 0 var(--fgd-accent); }
.zenfg-inspector-memory-resource:is(.selected, :hover, :focus-within) .zenfg-inspector-memory-bar,
.zenfg-inspector-memory-allocation:is(.selected, :hover, :focus-within) .zenfg-inspector-memory-bar { outline: 1px solid var(--fgd-accent); outline-offset: 1px; }
.zenfg-inspector-memory-size { display: grid; justify-items: end; gap: 1px; min-width: 0; color: var(--fgd-text); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.zenfg-inspector-memory-size[data-state='unknown'] { color: var(--fgd-muted); }
.zenfg-inspector-memory-size-label { color: var(--fgd-muted); font: 10.5px/1.3 var(--fgd-font-ui); }
.zenfg-inspector-memory-unallocated { min-width: 0; margin-top: var(--fgd-space-3); border: 1px solid transparent; border-top-color: var(--fgd-border-subtle); }
.zenfg-inspector-memory-unallocated-heading { margin: 0; padding: var(--fgd-space-2); color: var(--fgd-muted); font: 500 var(--fgd-font-size-small)/1.4 var(--fgd-font-ui); }
@container zenfg-memory (width < 800px) {
  .zenfg-inspector-memory-controls .zenfg-inspector-view-toolbar input { flex-basis: 100%; }
  .zenfg-inspector-memory-controls .zenfg-inspector-view-toolbar select { flex: 1 1 120px; width: 120px; min-width: 0; }
  .zenfg-inspector-memory-axis, .zenfg-inspector-memory-resource, .zenfg-inspector-memory-allocation { grid-template-columns: minmax(0, 1fr) auto; row-gap: 3px; }
  .zenfg-inspector-memory-name { grid-column: 1 / -1; grid-row: 1; }
  .zenfg-inspector-memory-range { grid-column: 1; grid-row: 2; }
  .zenfg-inspector-memory-range .zenfg-inspector-resource-order-label { display: inline; }
  .zenfg-inspector-memory-size { grid-column: 2; grid-row: 2; display: flex; justify-content: end; align-items: baseline; flex-wrap: wrap; gap: 2px 4px; }
  .zenfg-inspector-memory-axis-track, .zenfg-inspector .zenfg-inspector-memory-track { grid-column: 1 / -1; grid-row: 3; }
  .zenfg-inspector-memory-axis > :first-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .zenfg-inspector-memory-axis > :nth-child(2) { grid-column: 1; grid-row: 1; }
  .zenfg-inspector-memory-axis > :nth-child(2)::before { content: 'Lifetime · '; }
  .zenfg-inspector-memory-axis > :last-child { grid-column: 2; grid-row: 1; }
  .zenfg-inspector-memory-axis-track { grid-row: 2; }
  .zenfg-inspector-memory-resource, .zenfg-inspector-memory-allocation { padding-block: 6px; }
  .zenfg-inspector-memory-estimate-facts > div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
@container zenfg-memory (width < 480px) {
  .zenfg-inspector-memory-summary .zenfg-inspector-memory-metric-label { min-height: 2.8em; }
}
`;
