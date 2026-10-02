export const GRAPH_SEARCH_STYLES = `
.zenfg-inspector-graph-search { position: relative; min-width: 0; }
.zenfg-inspector-graph-search > button { box-shadow: var(--fgd-shadow); }
.zenfg-inspector-graph-search-popover {
  position: absolute; z-index: 7; top: calc(100% + var(--fgd-space-2)); left: 0;
  width: 360px; max-width: calc(100cqw - 2 * var(--fgd-space-2)); box-sizing: border-box;
  padding: var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
  background: var(--fgd-surface-raised); box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-graph-search input {
  box-sizing: border-box; width: 100%; min-width: 0; height: var(--fgd-control-height);
  padding: var(--fgd-space-1) var(--fgd-space-2); border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm);
  color: var(--fgd-text); background: var(--fgd-panel); font: var(--fgd-font-size) var(--fgd-font-ui);
}
.zenfg-inspector-graph-search-count {
  margin: var(--fgd-space-2) var(--fgd-space-1) var(--fgd-space-1); color: var(--fgd-muted); font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-graph-search-results { max-height: min(260px, 40vh); overflow: auto; overscroll-behavior: contain; }
.zenfg-inspector-graph-search .zenfg-inspector-graph-search-results > button {
  display: flex; flex-direction: column; align-items: stretch; gap: 2px;
  box-sizing: border-box; width: 100%; height: auto; min-height: var(--fgd-control-height);
  padding: 7px var(--fgd-space-2); margin: 2px 0; border: 1px solid transparent;
  border-radius: var(--fgd-radius-sm); text-align: left; white-space: normal; overflow-wrap: anywhere;
  color: var(--fgd-text); background: transparent; font: var(--fgd-font-size)/1.4 var(--fgd-font-ui); cursor: pointer;
}
.zenfg-inspector-graph-search .zenfg-inspector-graph-search-results > button:hover { color: var(--fgd-text); background: var(--fgd-surface-hover); }
.zenfg-inspector-graph-search .zenfg-inspector-graph-search-results > button[aria-selected='true'] { border-color: var(--fgd-accent); background: var(--fgd-accent-soft); }
.zenfg-inspector-graph-search-label { font-weight: 600; }
.zenfg-inspector-graph-search-metadata,
.zenfg-inspector-graph-search-path { color: var(--fgd-muted); font-size: var(--fgd-font-size-small); }
.zenfg-inspector-graph-search-path { color: var(--fgd-text-secondary); }
`;
