import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { CytoscapeGraphRenderer } from './panelCytoscapeGraphRenderer.ts';
import { createGraphScene, type GraphScene } from './panelGraphScene.ts';
import { createGraphLegend } from './panelGraphVisuals.ts';
import type { GraphViewState, Selection } from './panelTypes.ts';

type GraphSceneCacheEntry = {
    readonly snapshot: FrameGraphDebugViewModel;
    readonly optionsKey: string;
    readonly scene: GraphScene;
};

const graphSceneCache = new WeakMap<GraphViewState, GraphSceneCacheEntry>();

export function renderGraphView(
    graphView: GraphViewState,
    snapshot: FrameGraphDebugViewModel,
    selected: Selection | undefined,
    hovered: Selection | undefined,
    onSelect: (selection: Selection) => void,
    onHover: (selection: Selection | undefined) => void,
    onToggleGroup: (pathKey: string) => void,
): void {
    const scene = resolveGraphScene(graphView, snapshot);
    renderGraphLegend(graphView.legend, scene);
	const elementCount = scene.nodes.length + scene.edges.length;
	const layoutElementBudget = graphView.layoutElementBudget ?? Number.MAX_SAFE_INTEGER;
	if (elementCount > layoutElementBudget) {
		graphView.renderer?.destroy();
		graphView.renderer = undefined;
		const notice = document.createElement('div');
		notice.className = 'zenfg-inspector-graph-status';
		notice.dataset.state = 'empty';
		notice.setAttribute('role', 'status');
		notice.textContent = `Automatic layout disabled: ${elementCount} graph elements exceed the ${layoutElementBudget} element budget. Passes, Resources, Memory, Diagnostics, and raw data remain available.`;
		graphView.host.replaceChildren(notice);
		return;
	}
	graphView.renderer ??= new CytoscapeGraphRenderer(graphView.host);
    graphView.renderer.render({
        scene,
        selected,
        hovered,
        fit: graphView.fitOnNextRender,
        anchorElementId: graphView.anchorElementIdOnNextRender,
        onSelect,
        onHover,
        onToggleGroup,
    });
    graphView.fitOnNextRender = false;
    graphView.anchorElementIdOnNextRender = undefined;
}

export function resolveGraphScene(
    graphView: GraphViewState,
    snapshot: FrameGraphDebugViewModel,
): GraphScene {
    const optionsKey = JSON.stringify([
        graphView.graphMode,
        graphView.groupsEnabled,
        [...graphView.expandedGroupPaths].sort(),
    ]);
    const cached = graphSceneCache.get(graphView);
    if (cached?.snapshot === snapshot && cached.optionsKey === optionsKey) return cached.scene;
    const scene = createGraphScene(snapshot, {
        mode: graphView.graphMode,
        groupsEnabled: graphView.groupsEnabled,
        expandedGroupPaths: graphView.expandedGroupPaths,
    });
    graphSceneCache.set(graphView, { snapshot, optionsKey, scene });
    return scene;
}

export function fitGraph(graphView: GraphViewState): void {
    graphView.renderer?.fit();
}

export function resizeGraph(graphView: GraphViewState): void {
    graphView.renderer?.resize();
}

export function destroyGraph(graphView: GraphViewState): void {
    graphView.renderer?.destroy();
    graphView.renderer = undefined;
    graphSceneCache.delete(graphView);
}

function renderGraphLegend(host: HTMLElement | undefined, scene: GraphScene): void {
    if (!host) return;
    const entries = createGraphLegend(scene);
    const key = entries.map((entry) => entry.key).join('|');
    if (host.dataset.legendKey === key) return;
    host.dataset.legendKey = key;
    host.replaceChildren(...entries.map((entry) => {
        const item = document.createElement('span');
        item.className = 'zenfg-inspector-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'zenfg-inspector-legend-swatch';
        swatch.dataset.shape = entry.shape;
        if (entry.lineStyle) swatch.dataset.lineStyle = entry.lineStyle;
        if (entry.hollowArrow) swatch.dataset.hollowArrow = 'true';
        swatch.style.setProperty('--zenfg-inspector-legend-color', entry.color);
        const label = document.createElement('span');
        label.textContent = entry.label;
        item.append(swatch, label);
        return item;
    }));
}
