export const GRAPH_LEGEND_STYLES = `
.zenfg-inspector-graph-legend-control { display: contents; }
.zenfg-inspector-graph-legend-toggle {
  position: absolute; z-index: 5; left: var(--fgd-space-2); bottom: var(--fgd-space-2);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: var(--fgd-control-height); padding: 0 9px; border: 1px solid var(--fgd-border);
  border-radius: var(--fgd-radius-sm); background: var(--fgd-surface-raised); color: var(--fgd-text-secondary);
  box-shadow: var(--fgd-shadow); font: 600 var(--fgd-font-size-small)/1 var(--fgd-font-ui); cursor: pointer;
}
.zenfg-inspector-graph-legend-toggle:hover,
.zenfg-inspector-graph-legend-toggle[aria-expanded='true'] {
  border-color: var(--fgd-accent); color: var(--fgd-accent); background: var(--fgd-accent-soft);
}
.zenfg-inspector-graph-legend-popover {
  position: absolute; z-index: 6; left: var(--fgd-space-2);
  bottom: calc(var(--fgd-space-2) + var(--fgd-control-height) + 6px);
  width: 360px; max-width: calc(100% - 2 * var(--fgd-space-2));
  max-height: calc(100% - var(--fgd-control-height) - 72px);
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
  background: var(--fgd-surface-raised); box-shadow: var(--fgd-shadow);
  font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-graph-legend-header {
  display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between;
  gap: 8px; padding: 4px 6px 4px 10px; border-bottom: 1px solid var(--fgd-border-subtle);
  color: var(--fgd-text-secondary);
}
.zenfg-inspector-graph-legend-header > strong { font-weight: 600; }
.zenfg-inspector-graph-legend-header > button {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  padding: 0; border: 1px solid transparent; border-radius: var(--fgd-radius-sm);
  background: transparent; color: var(--fgd-muted); cursor: pointer;
}
.zenfg-inspector-graph-legend-header > button:hover { background: var(--fgd-surface-hover); color: var(--fgd-text); }
.zenfg-inspector-graph-legend-popover .zenfg-inspector-graph-legend {
  display: flex; flex: 0 1 auto; flex-direction: column; align-items: stretch; gap: var(--fgd-space-2);
  min-height: 0; overflow: auto; padding: 10px; border: 0;
  font-size: var(--fgd-font-size-small); line-height: 1.5; white-space: normal;
}
.zenfg-inspector-graph-legend-popover .zenfg-inspector-legend-group + .zenfg-inspector-legend-group {
  border-left: 0; border-top: 1px solid var(--fgd-border-subtle); padding: var(--fgd-space-2) 0 0;
}
.zenfg-inspector-legend-group { flex-wrap: wrap; }
`;
