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
    renderGraphLegend(graphView.legend, snapshot);
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
        graphView.groupsEnabled,
        [...graphView.expandedGroupPaths].sort(),
    ]);
    const cached = graphSceneCache.get(graphView);
    if (cached?.snapshot === snapshot && cached.optionsKey === optionsKey) return cached.scene;
    const scene = createGraphScene(snapshot, {
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

function renderGraphLegend(host: HTMLElement | undefined, snapshot: FrameGraphDebugViewModel): void {
    if (!host) return;
    const entries = createGraphLegend(snapshot);
    const key = JSON.stringify(entries);
    if (host.dataset.legendKey === key) return;
    host.dataset.legendKey = key;
    host.replaceChildren();
    let group: HTMLElement | undefined;
    for (const entry of entries) {
        if (group?.getAttribute('aria-label') !== entry.group) {
            group = document.createElement('span');
            group.className = 'zenfg-inspector-legend-group';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', entry.group);
            const heading = document.createElement('span');
            heading.className = 'zenfg-inspector-legend-heading';
            heading.textContent = entry.group;
            group.appendChild(heading);
            host.appendChild(group);
        }
        const item = document.createElement('span');
        item.className = 'zenfg-inspector-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'zenfg-inspector-legend-swatch';
        swatch.dataset.shape = entry.shape;
        if (entry.lineStyle) swatch.dataset.lineStyle = entry.lineStyle;
        if (entry.hollowArrow) swatch.dataset.hollowArrow = 'true';
        swatch.style.setProperty('--zenfg-inspector-legend-color', entry.color);
        if (entry.shape === 'cut-rectangle' || entry.shape === 'tag') {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 20 14');
            svg.setAttribute('aria-hidden', 'true');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', entry.shape === 'tag'
                ? '1,1 12,1 19,7 12,13 1,13'
                : '4,1 16,1 19,4 19,10 16,13 4,13 1,10 1,4');
            svg.appendChild(polygon);
            swatch.appendChild(svg);
        }
        const label = document.createElement('span');
        label.textContent = entry.label;
        item.append(swatch, label);
        group!.appendChild(item);
    }
}
