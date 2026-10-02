export const GRAPH_CONTROLS_STYLES = `
.zenfg-inspector-graph-toolbar {
  position: absolute; z-index: 5; top: var(--fgd-space-2); left: var(--fgd-space-2); right: var(--fgd-space-2);
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 6px; pointer-events: none;
}
.zenfg-inspector-graph-toolbar > * { pointer-events: auto; }
.zenfg-inspector-graph-action-controls {
  position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0;
}
.zenfg-inspector-graph-action-controls > button,
.zenfg-inspector-graph-search > button { box-shadow: var(--fgd-shadow); }
.zenfg-inspector-graph-toolbar [hidden] { display: none !important; }
.zenfg-inspector-graph-display-popover {
  position: absolute; top: calc(100% + 6px); right: 0; width: 220px; max-width: calc(100cqw - 32px);
  display: flex; flex-direction: column; gap: 5px; padding: 10px; border: 1px solid var(--fgd-border);
  border-radius: var(--fgd-radius-sm); background: var(--fgd-surface-raised); box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-graph-display-popover > strong { margin: 0 3px 2px; color: var(--fgd-muted); font-size: var(--fgd-font-size-small); font-weight: 500; }
.zenfg-inspector-graph-display-popover > button { justify-content: flex-start; text-align: left; }
.zenfg-inspector-graph-display-check { margin-left: auto; color: var(--fgd-accent); }
.zenfg-inspector-graph-display-popover > button[aria-pressed='false'] > .zenfg-inspector-graph-display-check { visibility: hidden; }
.zenfg-inspector-graph-zoom-controls {
  position: absolute; z-index: 5; right: var(--fgd-space-2); bottom: var(--fgd-space-2);
  display: flex; align-items: center; gap: 2px; max-width: calc(100% - 16px); padding: 3px;
  border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); background: var(--fgd-surface-raised); box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-graph-zoom-controls > button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; min-width: 28px; height: 28px; padding: 0; border-color: transparent; background: transparent;
}
.zenfg-inspector-graph-zoom-controls > button[aria-label='Reset graph zoom to 100%'] { width: 45px; min-width: 45px; }
.zenfg-inspector-graph-zoom-controls > button:hover:not(:disabled) { border-color: var(--fgd-border); background: var(--fgd-panel); }
.zenfg-inspector-graph-zoom-value { min-width: 46px; color: var(--fgd-text-secondary); text-align: center; font: var(--fgd-font-size-small)/1 var(--fgd-font-mono); }
.zenfg-inspector-graph-control-separator { height: 16px; width: 1px; margin: 0 3px; background: var(--fgd-border); }
@container zenfg-inspector-main (max-width: 600px) {
  .zenfg-inspector-graph-focus-action > .zenfg-inspector-button-label { display: none; }
  .zenfg-inspector-graph-focus-action { width: var(--fgd-control-height); padding-inline: 0; }
}
`;
