import type cytoscape from 'cytoscape';
import type { ELK } from 'elkjs/lib/elk-api';

import type { GraphRenderer, GraphRenderRequest } from './panelGraphRenderer.ts';
import {
    applyGraphLayout,
    layoutGraphScene,
    syncExpandedGroupLabelGeometry,
    type GraphLayoutResult,
    type GraphPosition,
} from './panelGraphLayout.ts';
import {
    selectionKey,
    type GraphScene,
    type GraphSceneEdge,
    type GraphSceneElementId,
    type GraphSceneNode,
} from './panelGraphScene.ts';
import {
    createGraphStyles,
    expandedGroupLabelMaxWidth,
    GRAPH_GEOMETRY,
    graphEdgeDisplayLabel,
    graphLayoutGeometryKey,
    isOverviewGraphScale,
    nodeDimensions,
} from './panelGraphVisuals.ts';

type Viewport = { readonly pan: GraphPosition; readonly zoom: number };

type GraphRendererRuntime = {
    readonly createCore: (options: cytoscape.CytoscapeOptions) => cytoscape.Core;
    readonly elk: ELK;
};

export type GraphResizeSubscription = { disconnect(): void };

export type GraphRendererEnvironment = {
    readonly createElement: (tagName: string) => HTMLElement;
    readonly loadRuntime: () => Promise<GraphRendererRuntime>;
    readonly layoutScene: (elk: ELK, scene: GraphScene) => Promise<GraphLayoutResult>;
    readonly observeResize?: (element: HTMLElement, onResize: () => void) => GraphResizeSubscription;
};

export class CytoscapeGraphRenderer implements GraphRenderer {
    private readonly canvasHost: HTMLElement;
    private readonly tooltip: HTMLElement;
    private readonly status: HTMLElement;
    private readonly statusMessage: HTMLElement;
    private readonly retryButton: HTMLButtonElement;
    private readonly resizeSubscription: GraphResizeSubscription | undefined;
    private core: cytoscape.Core | undefined;
    private elk: ELK | undefined;
    private loading: Promise<void> | undefined;
    private processing: Promise<void> | undefined;
    private latestRequest: GraphRenderRequest | undefined;
    private appliedScene: GraphScene | undefined;
    private requestVersion = 0;
    private processedVersion = 0;
    private destroyed = false;
    private fitTargetContentKey: string | undefined;
    private forceRelayout = false;
    private anchorElementId: GraphSceneElementId | undefined;
    private anchorTargetContentKey: string | undefined;
    private failedSceneContentKey: string | undefined;
    private overview = false;
    private lastTap: { readonly id: string; readonly at: number } | undefined;

    constructor(
        private readonly host: HTMLElement,
        private readonly environment: GraphRendererEnvironment = browserGraphRendererEnvironment,
    ) {
        this.canvasHost = environment.createElement('div');
        this.canvasHost.className = 'zenfg-inspector-graph-canvas';
        this.tooltip = environment.createElement('div');
        this.tooltip.className = 'zenfg-inspector-graph-tooltip';
        this.tooltip.hidden = true;
        this.status = environment.createElement('div');
        this.status.className = 'zenfg-inspector-graph-status';
        this.status.hidden = true;
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');
        this.statusMessage = environment.createElement('span');
        this.retryButton = environment.createElement('button') as HTMLButtonElement;
        this.retryButton.type = 'button';
        this.retryButton.textContent = 'Retry';
        this.retryButton.hidden = true;
        this.retryButton.addEventListener('click', () => this.relayout());
        this.status.append(this.statusMessage, this.retryButton);
        this.host.replaceChildren(this.canvasHost, this.status, this.tooltip);
        this.resizeSubscription = environment.observeResize?.(host, () => this.core?.resize());
    }

    render(request: GraphRenderRequest): void {
        if (this.destroyed) return;
        this.latestRequest = request;
        if (request.fit) {
            this.fitTargetContentKey = request.scene.contentKey;
        } else if (this.fitTargetContentKey !== request.scene.contentKey) {
            this.fitTargetContentKey = undefined;
        }
        if (request.anchorElementId !== undefined) {
            this.anchorElementId = request.anchorElementId;
            this.anchorTargetContentKey = request.scene.contentKey;
        } else if (this.anchorTargetContentKey !== request.scene.contentKey) {
            this.anchorElementId = undefined;
            this.anchorTargetContentKey = undefined;
        }
        if (this.failedSceneContentKey && this.failedSceneContentKey !== request.scene.contentKey) {
            this.failedSceneContentKey = undefined;
            this.hideStatus();
        }

        const version = ++this.requestVersion;
        if (this.failedSceneContentKey === request.scene.contentKey) {
            this.syncInteraction(request);
            this.processedVersion = version;
            return;
        }
        if (!this.processing && this.core && this.appliedScene?.contentKey === request.scene.contentKey && !this.forceRelayout) {
            this.appliedScene = request.scene;
            this.syncInteraction(request);
            this.consumeFitIfCurrentTarget();
            this.consumeAnchorIfCurrentTarget();
            this.processedVersion = version;
            return;
        }
        this.scheduleProcessing();
    }

    resize(): void {
        this.core?.resize();
    }

    fit(): void {
        const targetContentKey = this.latestRequest?.scene.contentKey;
        if (targetContentKey) this.fitTargetContentKey = targetContentKey;
        if (!this.core || !this.appliedScene) return;
        this.core.resize();
        this.core.fit(undefined, GRAPH_GEOMETRY.fitPadding);
        this.updateSemanticZoom();
        if (!this.targetNeedsApply()) this.fitTargetContentKey = undefined;
    }

    relayout(): void {
        if (!this.latestRequest || this.destroyed) return;
        this.failedSceneContentKey = undefined;
        this.forceRelayout = true;
        this.fitTargetContentKey = this.latestRequest.scene.contentKey;
        this.anchorElementId = undefined;
        this.anchorTargetContentKey = undefined;
        this.hideTooltip();
        ++this.requestVersion;
        this.scheduleProcessing();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.requestVersion++;
        this.resizeSubscription?.disconnect();
        this.hideTooltip();
        this.core?.destroy();
        this.core = undefined;
        this.elk = undefined;
        this.loading = undefined;
        this.latestRequest = undefined;
        this.appliedScene = undefined;
        this.fitTargetContentKey = undefined;
        this.anchorElementId = undefined;
        this.anchorTargetContentKey = undefined;
        this.host.replaceChildren();
    }

    private scheduleProcessing(): void {
        if (this.processing || this.destroyed) return;
        this.processing = this.processRequests().finally(() => {
            this.processing = undefined;
            if (!this.destroyed
                && !this.failedSceneContentKey
                && this.processedVersion !== this.requestVersion) {
                this.scheduleProcessing();
            }
        });
    }

    private async processRequests(): Promise<void> {
        while (!this.destroyed && this.processedVersion !== this.requestVersion) {
            let version = this.requestVersion;
            let request = this.latestRequest;
            if (!request) return;

            if (request.scene.nodes.length === 0) {
                this.hideTooltip();
                if (this.core) replaceElements(this.core, request.scene);
                this.appliedScene = request.scene;
                this.forceRelayout = false;
                if (this.fitTargetContentKey === request.scene.contentKey) this.fitTargetContentKey = undefined;
                this.consumeAnchorIfCurrentTarget();
                this.syncInteraction(request);
                this.showStatus('empty', 'No graph elements in this view.');
                this.processedVersion = version;
                continue;
            }

            try {
                if (!this.core) this.showStatus('loading', 'Loading graph runtime…');
                await this.ensureRuntime();
                const runtimeRequest = this.resolveCurrentRequest(version, request.scene.contentKey);
                if (!runtimeRequest) continue;
                ({ version, request } = runtimeRequest);
                const core = this.core!;
                if (this.appliedScene?.contentKey === request.scene.contentKey && !this.forceRelayout) {
                    this.appliedScene = request.scene;
                    this.syncInteraction(request);
                    this.consumeFitIfCurrentTarget();
                    this.consumeAnchorIfCurrentTarget();
                    this.hideStatus();
                    this.processedVersion = version;
                    continue;
                }

                this.hideTooltip();
                const previousViewport = viewport(core);
                const anchorElementId = this.anchorTargetContentKey === request.scene.contentKey
                    ? this.anchorElementId
                    : undefined;
                const anchorBefore = anchorElementId === undefined
                    ? undefined
                    : renderedPosition(core, anchorElementId);
                const topologyChanged = this.appliedScene?.topologyKey !== request.scene.topologyKey;
                const geometryChanged = !this.appliedScene
                    || graphLayoutGeometryKey(this.appliedScene) !== graphLayoutGeometryKey(request.scene);
                let laidOut = false;

                if (geometryChanged || this.forceRelayout) {
                    this.showStatus('layout', 'Laying out graph…');
                    const result = await this.environment.layoutScene(this.elk!, request.scene);
                    const layoutRequest = this.resolveCurrentRequest(version, request.scene.contentKey);
                    if (!layoutRequest) continue;
                    ({ version, request } = layoutRequest);
                    if (topologyChanged || !this.appliedScene) replaceElements(core, request.scene);
                    else updateElementData(core, request.scene);
                    applyGraphLayout(core, request.scene, result);
                    laidOut = true;
                } else {
                    updateElementData(core, request.scene);
                }

                syncExpandedGroupLabelGeometry(core);
                this.appliedScene = request.scene;
                this.forceRelayout = false;
                this.failedSceneContentKey = undefined;
                this.syncInteraction(request);
                core.resize();
                if (this.fitTargetContentKey === request.scene.contentKey) {
                    core.fit(undefined, GRAPH_GEOMETRY.fitPadding);
                    this.fitTargetContentKey = undefined;
                } else if (laidOut && anchorBefore && anchorElementId) {
                    restoreViewport(core, previousViewport);
                    const anchorAfter = renderedPosition(core, anchorElementId);
                    if (anchorAfter) core.panBy({ x: anchorBefore.x - anchorAfter.x, y: anchorBefore.y - anchorAfter.y });
                } else {
                    restoreViewport(core, previousViewport);
                }
                this.consumeAnchorIfCurrentTarget();
                this.updateSemanticZoom(true);
                this.hideStatus();
                this.processedVersion = version;
            } catch (error) {
                const failedRequest = this.resolveCurrentRequest(version, request.scene.contentKey);
                if (!failedRequest) continue;
                ({ version, request } = failedRequest);
                this.forceRelayout = false;
                this.failedSceneContentKey = request.scene.contentKey;
                this.processedVersion = version;
                this.showStatus(
                    'error',
                    `Failed to render graph: ${error instanceof Error ? error.message : String(error)}`,
                    true,
                );
                return;
            }
        }
    }

    private async ensureRuntime(): Promise<void> {
        if (this.core || this.destroyed) return;
        this.loading ??= this.loadRuntime().catch((error) => {
            this.loading = undefined;
            throw error;
        });
        await this.loading;
    }

    private async loadRuntime(): Promise<void> {
        const runtime = await this.environment.loadRuntime();
        if (this.destroyed) return;
        this.canvasHost.textContent = '';
        this.elk = runtime.elk;
        this.core = runtime.createCore({
            container: this.canvasHost,
            elements: [],
            style: createGraphStyles(),
            layout: { name: 'preset' },
            minZoom: 0.03,
            maxZoom: 4,
            wheelSensitivity: 1.3,
            boxSelectionEnabled: false,
            autoungrabify: true,
            autounselectify: true,
        });
        this.bindEvents(this.core);
    }

    private bindEvents(core: cytoscape.Core): void {
        const selectElement = (event: cytoscape.EventObject) => {
            const request = this.interactiveRequest();
            if (!request) return;
            const id = event.target.id() as GraphSceneElementId;
            const selection = request.scene.interaction.selectionByElementId.get(id);
            if (selection) request.onSelect(selection);
            const now = performance.now();
            if (this.lastTap?.id === id && now - this.lastTap.at <= 350 && selection?.kind === 'group') {
                request.onToggleGroup(selection.pathKey);
                this.lastTap = undefined;
            } else {
                this.lastTap = { id, at: now };
            }
        };
        core.on('tap', 'node', selectElement);
        core.on('tap', 'edge', selectElement);
        core.on('tap', (event) => {
            if (event.target === core) this.lastTap = undefined;
        });
        const hoverElement = (event: cytoscape.EventObject) => {
            const request = this.interactiveRequest();
            if (!request) return;
            const id = event.target.id() as GraphSceneElementId;
            const selection = request.scene.interaction.selectionByElementId.get(id);
            if (selection) request.onHover(selection);
            const title = event.target.data('tooltip') as string | undefined;
            if (title) {
                this.tooltip.textContent = title;
                this.tooltip.hidden = false;
                this.positionTooltip(event.renderedPosition);
            }
        };
        core.on('mouseover', 'node', hoverElement);
        core.on('mouseover', 'edge', hoverElement);
        const moveTooltip = (event: cytoscape.EventObject) => this.positionTooltip(event.renderedPosition);
        core.on('mousemove', 'node', moveTooltip);
        core.on('mousemove', 'edge', moveTooltip);
        const clearHover = () => {
            this.hideTooltip();
            this.latestRequest?.onHover(undefined);
        };
        core.on('mouseout', 'node', clearHover);
        core.on('mouseout', 'edge', clearHover);
        core.on('zoom', () => this.updateSemanticZoom());
    }

    private interactiveRequest(): GraphRenderRequest | undefined {
        const request = this.latestRequest;
        return request && this.appliedScene?.contentKey === request.scene.contentKey ? request : undefined;
    }

    private syncInteraction(request: GraphRenderRequest): void {
        const core = this.core;
        if (!core || this.appliedScene?.topologyKey !== request.scene.topologyKey) return;
        core.batch(() => {
            core.elements().removeClass('semantic-selected semantic-hover');
            if (request.hovered) {
                for (const id of request.scene.interaction.relatedElementIdsBySelection.get(selectionKey(request.hovered)) ?? []) {
                    core.getElementById(id).addClass('semantic-hover');
                }
            }
            if (request.selected) {
                for (const id of request.scene.interaction.primaryElementIdsBySelection.get(selectionKey(request.selected)) ?? []) {
                    core.getElementById(id).addClass('semantic-selected');
                }
            }
        });
    }

    private consumeFitIfCurrentTarget(): void {
        const targetContentKey = this.latestRequest?.scene.contentKey;
        if (!targetContentKey
            || this.fitTargetContentKey !== targetContentKey
            || !this.core
            || this.targetNeedsApply()) return;
        this.core.resize();
        this.core.fit(undefined, GRAPH_GEOMETRY.fitPadding);
        this.fitTargetContentKey = undefined;
        this.updateSemanticZoom();
    }

    private consumeAnchorIfCurrentTarget(): void {
        const targetContentKey = this.latestRequest?.scene.contentKey;
        if (!targetContentKey || this.anchorTargetContentKey !== targetContentKey) return;
        this.anchorElementId = undefined;
        this.anchorTargetContentKey = undefined;
    }

    private targetNeedsApply(): boolean {
        const target = this.latestRequest?.scene;
        if (!target || !this.appliedScene) return target !== undefined;
        return this.forceRelayout || this.appliedScene.contentKey !== target.contentKey;
    }

    private updateSemanticZoom(force = false): void {
        const core = this.core;
        if (!core) return;
        const overview = isOverviewGraphScale(core.zoom());
        if (!force && overview === this.overview) return;
        this.overview = overview;
        core.batch(() => {
            for (const node of core.nodes()) {
                node.data('displayLabel', overview ? node.data('overviewLabel') : node.data('detailLabel'));
            }
            for (const edge of core.edges()) {
                edge.data('displayLabel', overview ? '' : edge.data('detailLabel'));
            }
        });
    }

    private positionTooltip(position: GraphPosition): void {
        const maxX = Math.max(8, this.host.clientWidth - this.tooltip.offsetWidth - 8);
        const maxY = Math.max(8, this.host.clientHeight - this.tooltip.offsetHeight - 8);
        this.tooltip.style.left = `${Math.max(8, Math.min(maxX, position.x + 12))}px`;
        this.tooltip.style.top = `${Math.max(8, Math.min(maxY, position.y + 12))}px`;
    }

    private hideTooltip(): void {
        this.tooltip.hidden = true;
        this.tooltip.textContent = '';
        this.lastTap = undefined;
    }

    private showStatus(kind: 'loading' | 'layout' | 'empty' | 'error', message: string, retry = false): void {
        this.status.dataset.state = kind;
        this.statusMessage.textContent = message;
        this.retryButton.hidden = !retry;
        this.status.hidden = false;
        this.host.setAttribute('aria-busy', kind === 'loading' || kind === 'layout' ? 'true' : 'false');
    }

    private hideStatus(): void {
        this.status.hidden = true;
        this.retryButton.hidden = true;
        this.host.setAttribute('aria-busy', 'false');
    }

    private resolveCurrentRequest(
        version: number,
        contentKey: string,
    ): { readonly version: number; readonly request: GraphRenderRequest } | undefined {
        if (this.destroyed) return undefined;
        const request = this.latestRequest;
        if (!request) return undefined;
        if (version === this.requestVersion || request.scene.contentKey === contentKey) {
            return { version: this.requestVersion, request };
        }
        return undefined;
    }
}

const browserGraphRendererEnvironment: GraphRendererEnvironment = {
    createElement: (tagName) => document.createElement(tagName),
    loadRuntime: async () => {
        const [cytoscapeModule, elkModule] = await Promise.all([
            import('cytoscape'),
            import('elkjs/lib/elk.bundled.js'),
        ]);
        return {
            createCore: cytoscapeModule.default,
            elk: new elkModule.default(),
        };
    },
    layoutScene: layoutGraphScene,
    observeResize: (element, onResize) => {
        if (typeof ResizeObserver === 'undefined') return { disconnect: () => undefined };
        const view = element.ownerDocument.defaultView;
        let animationFrame: number | undefined;
        const observer = new ResizeObserver(() => {
            if (!view || animationFrame !== undefined) return;
            animationFrame = view.requestAnimationFrame(() => {
                animationFrame = undefined;
                onResize();
            });
        });
        observer.observe(element);
        return {
            disconnect: () => {
                observer.disconnect();
                if (animationFrame !== undefined) {
                    view?.cancelAnimationFrame(animationFrame);
                    animationFrame = undefined;
                }
            },
        };
    },
};

function replaceElements(core: cytoscape.Core, scene: GraphScene): void {
    const definitions: cytoscape.ElementDefinition[] = [
        ...scene.nodes.map(nodeDefinition),
        ...scene.edges.map(edgeDefinition),
    ];
    core.startBatch();
    core.elements().remove();
    core.add(definitions);
    core.endBatch();
}

export function updateElementData(core: cytoscape.Core, scene: GraphScene): void {
    core.batch(() => {
        for (const node of scene.nodes) {
            const element = core.getElementById(node.id);
            if (element.nonempty()) element.data(nodeRenderableData(node));
        }
        for (const edge of scene.edges) {
            const element = core.getElementById(edge.id);
            if (element.nonempty()) element.data(edgeRenderableData(edge));
        }
    });
}

function nodeDefinition(node: GraphSceneNode): cytoscape.ElementDefinition {
    return {
        group: 'nodes',
        data: {
            id: node.id,
            parent: node.parentId,
            ...nodeRenderableData(node),
        },
    };
}

function nodeRenderableData(node: GraphSceneNode): Record<string, unknown> {
    const dimensions = nodeDimensions(node);
    const labelMaxWidth = node.kind === 'group' && node.collapsed
        ? expandedGroupLabelMaxWidth(dimensions.width)
        : 160;
    return {
        kind: node.kind,
        passKind: node.kind === 'pass' || node.kind === 'culled-pass' ? node.passKind : undefined,
        resourceKind: node.kind === 'resource' ? node.resourceKind : undefined,
        collapsed: node.kind === 'group' && node.collapsed ? 1 : 0,
        hasCulled: node.kind === 'group' && node.culledNodeCount > 0 ? 1 : 0,
        depthBand: node.kind === 'group' ? node.depthBand : undefined,
        detailLabel: node.label,
        overviewLabel: node.overviewLabel,
        displayLabel: node.label,
        tooltip: node.title,
        labelMaxWidth,
        width: dimensions.width,
        height: dimensions.height,
    };
}

function edgeDefinition(edge: GraphSceneEdge): cytoscape.ElementDefinition {
    return {
        group: 'edges',
        data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            ...edgeRenderableData(edge),
        },
    };
}

function edgeRenderableData(edge: GraphSceneEdge): Record<string, unknown> {
    const detailLabel = graphEdgeDisplayLabel(edge);
    return {
        kind: edge.kind,
        dependencyKind: edge.kind === 'dependency' ? edge.dependencyKind : undefined,
        accessMode: edge.kind === 'access' ? edge.accessMode : undefined,
        dashed: edge.kind === 'access' && edge.dashed ? 1 : 0,
        detailLabel,
        displayLabel: detailLabel,
        tooltip: edge.title,
    };
}

function viewport(core: cytoscape.Core): Viewport {
    return { pan: { ...core.pan() }, zoom: core.zoom() };
}

function restoreViewport(core: cytoscape.Core, state: Viewport): void {
    core.zoom(state.zoom);
    core.pan(state.pan);
}

function renderedPosition(core: cytoscape.Core, id: GraphSceneElementId): GraphPosition | undefined {
    const element = core.getElementById(id);
    return element.nonempty() && element.isNode() ? { ...element.renderedPosition() } : undefined;
}

export {
    createCytoscapeEdgeRouteData,
    createElkLayoutGraph,
    layoutGraphScene,
} from './panelGraphLayout.ts';
export type {
    CytoscapeEdgeRouteData,
    GraphEdgeRoute,
    GraphLayoutResult,
    GraphPosition,
} from './panelGraphLayout.ts';
export {
    createGraphStyles,
    expandedGroupLabelMaxWidth,
    graphEdgeDisplayLabel,
    graphLayoutGeometryKey,
    isOverviewGraphScale,
} from './panelGraphVisuals.ts';
