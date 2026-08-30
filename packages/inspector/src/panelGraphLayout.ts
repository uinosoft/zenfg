import type cytoscape from 'cytoscape';
import type { ELK, ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';

import type { GraphScene, GraphSceneElementId, GraphSceneNode } from './panelGraphScene.ts';
import { expandedGroupLabelMaxWidth, GRAPH_GEOMETRY, nodeDimensions } from './panelGraphVisuals.ts';

export type GraphPosition = { readonly x: number; readonly y: number };
export type GraphEdgeRoute = {
    readonly startPoint: GraphPosition;
    readonly bendPoints: readonly GraphPosition[];
    readonly endPoint: GraphPosition;
};
export type GraphLayoutResult = {
    readonly positions: ReadonlyMap<GraphSceneElementId, GraphPosition>;
    readonly routes: ReadonlyMap<GraphSceneElementId, GraphEdgeRoute>;
};

export type CytoscapeEdgeRouteData = {
    readonly sourceEndpoint: string;
    readonly targetEndpoint: string;
    readonly segmentWeights: string;
    readonly segmentDistances: string;
};

export async function layoutGraphScene(elk: ELK, scene: GraphScene): Promise<GraphLayoutResult> {
    const graph = createElkLayoutGraph(scene);
    const layout = await elk.layout(graph);
    const positions = new Map<GraphSceneElementId, GraphPosition>();
    collectLayoutPositions(layout, 0, 0, positions);
    const nodeOffsets = new Map<GraphSceneElementId, GraphPosition>();
    collectLayoutOffsets(layout, 0, 0, nodeOffsets);
    const routes = new Map<GraphSceneElementId, GraphEdgeRoute>();
    collectEdgeRoutes(layout, 0, 0, nodeOffsets, routes);
    return { positions, routes };
}

export function createElkLayoutGraph(scene: GraphScene): ElkNode {
    const childrenByParent = new Map<GraphSceneElementId | undefined, GraphSceneNode[]>();
    const portsByNode = new Map<GraphSceneElementId, ElkPort[]>();
    const elkEdges = scene.edges.map((edge): ElkExtendedEdge => {
        const sourcePortId = `${edge.id}:source`;
        const targetPortId = `${edge.id}:target`;
        appendPort(portsByNode, edge.from, {
            id: sourcePortId,
            width: 1,
            height: 1,
            layoutOptions: { 'elk.port.side': 'EAST' },
        });
        appendPort(portsByNode, edge.to, {
            id: targetPortId,
            width: 1,
            height: 1,
            layoutOptions: { 'elk.port.side': 'WEST' },
        });
        return {
            id: edge.id,
            sources: [sourcePortId],
            targets: [targetPortId],
        };
    });
    for (const node of scene.nodes) {
        const children = childrenByParent.get(node.parentId) ?? [];
        children.push(node);
        childrenByParent.set(node.parentId, children);
    }
    const createNode = (node: GraphSceneNode): ElkNode => {
        const children = childrenByParent.get(node.id)?.map(createNode);
        const dimensions = nodeDimensions(node);
        return {
            id: node.id,
            width: dimensions.width,
            height: dimensions.height,
            children,
            ports: portsByNode.get(node.id),
            layoutOptions: children?.length ? {
                'elk.algorithm': 'layered',
                'elk.direction': 'RIGHT',
                'elk.edgeRouting': 'ORTHOGONAL',
                'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
                'elk.portConstraints': 'FIXED_SIDE',
                'elk.layered.mergeEdges': 'false',
                'elk.layered.mergeHierarchyEdges': 'false',
                'elk.padding': elkPadding(),
                'elk.spacing.nodeNode': '36',
                'elk.layered.spacing.nodeNodeBetweenLayers': '72',
                'elk.spacing.edgeEdge': '10',
                'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
            } : {
                'elk.portConstraints': 'FIXED_SIDE',
            },
        };
    };
    return {
        id: 'root',
        children: (childrenByParent.get(undefined) ?? []).map(createNode),
        edges: elkEdges,
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.layered.mergeEdges': 'false',
            'elk.layered.mergeHierarchyEdges': 'false',
            'elk.spacing.nodeNode': '42',
            'elk.layered.spacing.nodeNodeBetweenLayers': '88',
            'elk.spacing.edgeNode': '20',
            'elk.spacing.edgeEdge': '10',
            'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
            'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        },
    };
}

export function applyGraphLayout(core: cytoscape.Core, scene: GraphScene, layout: GraphLayoutResult): void {
    applyPositions(core, layout.positions);
    core.batch(() => {
        for (const edge of scene.edges) {
            const route = layout.routes.get(edge.id);
            const cytoscapeEdge = core.getElementById(edge.id);
            if (cytoscapeEdge.empty()) continue;
            const sourceNode = core.getElementById(edge.from);
            const targetNode = core.getElementById(edge.to);
            const routeData = sourceNode.nonempty() && targetNode.nonempty()
                ? createCytoscapeEdgeRouteData(route, sourceNode.position(), targetNode.position())
                : undefined;
            cytoscapeEdge
                .removeClass('elk-route elk-segments')
                .removeData('sourceEndpoint', 'targetEndpoint', 'segmentWeights', 'segmentDistances');
            if (!routeData) continue;
            cytoscapeEdge.data(routeData).addClass('elk-route');
            if (route!.bendPoints.length > 0) cytoscapeEdge.addClass('elk-segments');
        }
    });
}

export function syncExpandedGroupLabelGeometry(core: cytoscape.Core): void {
    const groups = core.nodes('node[kind = "group"][collapsed = 0]');
    for (let iteration = 0; iteration < 2; iteration++) {
        const updates = groups.map((node) => ({
            node,
            labelMaxWidth: expandedGroupLabelMaxWidth(node.outerWidth()),
        }));
        core.batch(() => {
            for (const update of updates) update.node.data('labelMaxWidth', update.labelMaxWidth);
        });
    }
}

export function createCytoscapeEdgeRouteData(
    route: GraphEdgeRoute | undefined,
    sourceCenter: GraphPosition,
    targetCenter: GraphPosition,
): CytoscapeEdgeRouteData | undefined {
    if (!route || !isValidRoute(route)) return undefined;
    const segments = route.bendPoints.map((point) => segmentFromPoint(route.startPoint, route.endPoint, point));
    return {
        sourceEndpoint: endpointOffset(route.startPoint, sourceCenter),
        targetEndpoint: endpointOffset(route.endPoint, targetCenter),
        segmentWeights: segments.map((segment) => segment.weight).join(' '),
        segmentDistances: segments.map((segment) => segment.distance).join(' '),
    };
}

function elkPadding(): string {
    const padding = GRAPH_GEOMETRY.elkGroupPadding;
    return `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`;
}

function appendPort(
    portsByNode: Map<GraphSceneElementId, ElkPort[]>,
    nodeId: GraphSceneElementId,
    port: ElkPort,
): void {
    const ports = portsByNode.get(nodeId) ?? [];
    ports.push(port);
    portsByNode.set(nodeId, ports);
}

function collectLayoutPositions(
    node: ElkNode,
    offsetX: number,
    offsetY: number,
    positions: Map<GraphSceneElementId, GraphPosition>,
): void {
    for (const child of node.children ?? []) {
        const x = offsetX + (child.x ?? 0);
        const y = offsetY + (child.y ?? 0);
        positions.set(child.id, {
            x: x + (child.width ?? 0) / 2,
            y: y + (child.height ?? 0) / 2,
        });
        collectLayoutPositions(child, x, y, positions);
    }
}

function collectLayoutOffsets(
    node: ElkNode,
    offsetX: number,
    offsetY: number,
    offsets: Map<GraphSceneElementId, GraphPosition>,
): void {
    offsets.set(node.id, { x: offsetX, y: offsetY });
    for (const child of node.children ?? []) {
        collectLayoutOffsets(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0), offsets);
    }
}

function collectEdgeRoutes(
    node: ElkNode,
    offsetX: number,
    offsetY: number,
    nodeOffsets: ReadonlyMap<GraphSceneElementId, GraphPosition>,
    routes: Map<GraphSceneElementId, GraphEdgeRoute>,
): void {
    for (const edge of node.edges ?? []) {
        if (edge.sections?.length !== 1) continue;
        const section = edge.sections[0];
        if (!section) continue;
        // ELK may keep hierarchy edges on an ancestor while expressing their sections in container-local coordinates.
        const containerOffset = edge.container === undefined ? undefined : nodeOffsets.get(edge.container);
        const routeOffsetX = containerOffset?.x ?? offsetX;
        const routeOffsetY = containerOffset?.y ?? offsetY;
        routes.set(edge.id, {
            startPoint: offsetPoint(section.startPoint, routeOffsetX, routeOffsetY),
            bendPoints: (section.bendPoints ?? []).map((point) => offsetPoint(point, routeOffsetX, routeOffsetY)),
            endPoint: offsetPoint(section.endPoint, routeOffsetX, routeOffsetY),
        });
    }
    for (const child of node.children ?? []) {
        collectEdgeRoutes(
            child,
            offsetX + (child.x ?? 0),
            offsetY + (child.y ?? 0),
            nodeOffsets,
            routes,
        );
    }
}

function offsetPoint(point: GraphPosition, offsetX: number, offsetY: number): GraphPosition {
    return { x: point.x + offsetX, y: point.y + offsetY };
}

function isValidRoute(route: GraphEdgeRoute): boolean {
    const dx = route.endPoint.x - route.startPoint.x;
    const dy = route.endPoint.y - route.startPoint.y;
    return isFinitePoint(route.startPoint)
        && isFinitePoint(route.endPoint)
        && dx * dx + dy * dy > Number.EPSILON
        && route.bendPoints.every(isFinitePoint);
}

function isFinitePoint(point: GraphPosition): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function endpointOffset(point: GraphPosition, center: GraphPosition): string {
    return `${point.x - center.x}px ${point.y - center.y}px`;
}

function applyPositions(core: cytoscape.Core, positions: ReadonlyMap<GraphSceneElementId, GraphPosition>): void {
    core.batch(() => {
        for (const [id, position] of positions) {
            const node = core.getElementById(id);
            if (node.nonempty() && node.isNode() && !node.isParent()) node.position(position);
        }
    });
}

function segmentFromPoint(source: GraphPosition, target: GraphPosition, point: GraphPosition) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return { weight: 0.5, distance: 0 };
    const weight = ((point.x - source.x) * dx + (point.y - source.y) * dy) / lengthSquared;
    const projectedX = source.x + weight * dx;
    const projectedY = source.y + weight * dy;
    const length = Math.sqrt(lengthSquared);
    const distance = ((point.x - projectedX) * -dy + (point.y - projectedY) * dx) / length;
    return { weight, distance };
}
