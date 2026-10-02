import { GRAPH_CONTROLS_STYLES } from './panelGraphControlsStyles.ts';
import { GRAPH_SEARCH_STYLES } from './panelGraphSearchStyles.ts';
import { GRAPH_LEGEND_STYLES } from './panelGraphLegendStyles.ts';

export const PANEL_WORKBENCH_CSS = `
.zenfg-inspector [hidden] { display: none !important; }
.zenfg-inspector { font-size: var(--fgd-font-size); }
.zenfg-inspector-workbench { display: flex; flex-direction: column; gap: 6px; }
.zenfg-inspector-workbench-command-bar,
.zenfg-inspector-feedback { flex: 0 0 auto; }
.zenfg-inspector-workspace { flex: 1 1 0; gap: 0; }
.zenfg-inspector-main { container-name: zenfg-inspector-main; container-type: inline-size; }
.zenfg-inspector-workspace.inspector-open { grid-template-columns: minmax(0, 1fr) 8px var(--fgd-detail-width, 300px); }
.zenfg-inspector-workspace.inspector-open::after { display: none; }
.zenfg-inspector-workspace:not(.detail-drawer) .zenfg-inspector-inspector {
  position: static; width: auto; grid-column: 3; box-shadow: none;
}
.zenfg-inspector-workspace.detail-drawer { grid-template-columns: minmax(0, 1fr); }
.zenfg-inspector-workspace.detail-drawer .zenfg-inspector-inspector {
  position: absolute; z-index: 20; top: 0; right: 0; bottom: 0;
  width: min(340px, calc(100% - 24px)); box-shadow: var(--fgd-shadow);
}
.zenfg-inspector-detail-divider {
  grid-column: 2; cursor: col-resize; touch-action: none; align-self: stretch; border-radius: var(--fgd-radius-sm);
}
.zenfg-inspector-detail-divider:hover,
.zenfg-inspector-detail-divider:focus-visible { background: var(--fgd-accent-soft); outline: 1px solid var(--fgd-accent); }
.zenfg-inspector-detail-backdrop {
  position: absolute; z-index: 10; inset: 0; border: 0; padding: 0; background: var(--fgd-backdrop); cursor: default;
}
.zenfg-inspector-diagnostic-badge { margin-left: 5px; padding: 1px var(--fgd-space-1); border-radius: var(--fgd-radius-sm); color: var(--fgd-warning); background: var(--fgd-surface-raised); font: var(--fgd-font-size-small)/1.2 var(--fgd-font-mono); }
.zenfg-inspector-feedback { border: 1px solid var(--fgd-border); border-radius: var(--fgd-radius-sm); padding: 6px 10px; }
.zenfg-inspector-feedback summary { color: var(--fgd-text-secondary); cursor: pointer; }
.zenfg-inspector-feedback[data-tone='error'] { border-color: var(--fgd-danger); }
.zenfg-inspector-feedback[data-tone='error'] summary { color: var(--fgd-danger); }
.zenfg-inspector-feedback .zenfg-inspector-command-status {
  display: block; max-width: none; max-height: 140px; margin-top: 5px; overflow: auto;
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fgd-font-size-small);
}
.zenfg-inspector-button-label { min-width: 0; }
.zenfg-inspector-view-toolbar input,
.zenfg-inspector-view-toolbar select { height: var(--fgd-control-height); }
.zenfg-inspector-workbench-table { min-width: 620px; font: var(--fgd-font-size-small)/1.5 var(--fgd-font-ui); }
.zenfg-inspector-workbench-table th { font-size: var(--fgd-font-size-small); }
.zenfg-inspector-workbench-table td { height: var(--fgd-row-height); }
.zenfg-inspector-workbench-table [data-column='numeric'] { font-family: var(--fgd-font-mono); }
.zenfg-inspector-relation-button { overflow: hidden; }
.zenfg-inspector-muted { font-size: var(--fgd-font-size-small); }
.zenfg-inspector-graph-viewport { position: relative; isolation: isolate; display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
.zenfg-inspector button:focus-visible,
.zenfg-inspector input:focus-visible,
.zenfg-inspector select:focus-visible,
.zenfg-inspector summary:focus-visible { outline: 2px solid var(--fgd-accent); outline-offset: 1px; }
@container zenfg-inspector (max-width: 720px) {
  .zenfg-inspector-workbench-actions > :is(.zenfg-inspector-import-action, .zenfg-inspector-export-action, .zenfg-inspector-open-inspector) {
    width: var(--fgd-control-height); min-width: var(--fgd-control-height); padding-inline: 0;
  }
  .zenfg-inspector-workbench-actions > :is(.zenfg-inspector-import-action, .zenfg-inspector-export-action, .zenfg-inspector-open-inspector) > .zenfg-inspector-button-label { display: none; }
}
@container zenfg-inspector (max-width: 560px) {
  .zenfg-inspector-workbench-command-bar.branding-hidden { grid-template-columns: minmax(0, 1fr); }
  .zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-tabs { grid-column: 1; grid-row: 2; }
  .zenfg-inspector-workbench-command-bar.branding-hidden .zenfg-inspector-workbench-actions { grid-column: 1; grid-row: 1; justify-content: end; }
}
${GRAPH_CONTROLS_STYLES}
${GRAPH_SEARCH_STYLES}
${GRAPH_LEGEND_STYLES}
`;
