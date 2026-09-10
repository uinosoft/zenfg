import type cytoscape from 'cytoscape';

import type { GraphScene, GraphSceneEdge, GraphSceneNode } from './panelGraphScene.ts';
import { GRAPH_VISUAL_THEME, type GraphVisualTheme } from './panelVisualTheme.ts';
import { declarationEntrances, type FrameGraphDebugViewModel } from './debugCaptureModel.ts';

export { GRAPH_VISUAL_THEME } from './panelVisualTheme.ts';


export const GRAPH_GEOMETRY = {
    fitPadding: 28,
    baseFontSize: 13,
    overviewFontThreshold: 9,
    minimumZoomedFontSize: 5,
    groupTitleInset: 8,
    groupTitleLineHeight: 1.2,
    groupPadding: 32,
    elkGroupPadding: { top: 46, right: 24, bottom: 24, left: 24 },
    edgeCornerRadius: 6,
    outputWidth: 208,
    outputTipWidth: 24,
    outputLabelWidth: 160,
} as const;

const ENDPOINT_EDGE_DISTANCES = 'endpoints' as unknown as cytoscape.Css.Edge['edge-distances'];
const EDGE_SEGMENT_RADII = `${GRAPH_GEOMETRY.edgeCornerRadius}px` as unknown as cytoscape.Css.Edge['segment-radii'];

export type GraphLegendEntry = {
    readonly group: 'Execution' | 'Resources' | 'Relationships';
    readonly key: string;
    readonly label: string;
    readonly color: string;
    readonly shape: 'box' | 'cut-rectangle' | 'tag' | 'ellipse' | 'group' | 'line';
    readonly lineStyle?: 'solid' | 'dotted' | 'dashed';
    readonly hollowArrow?: boolean;
};

export function createGraphLegend(snapshot: FrameGraphDebugViewModel, theme: GraphVisualTheme = GRAPH_VISUAL_THEME): readonly GraphLegendEntry[] {
    const nodeEntries = {
        render: nodeLegend('render', 'Render', theme.render.stroke),
        compute: nodeLegend('compute', 'Compute', theme.compute.stroke),
        copy: nodeLegend('copy', 'Copy', theme.copy.stroke),
        'clear-buffer': nodeLegend('clear', 'Clear', theme.clear.stroke),
        command: nodeLegend('command', 'Command', theme.command.stroke),
        'external-submission': { ...nodeLegend('external', 'External', theme.external.stroke), shape: 'cut-rectangle' as const },
    } as const;

    const entries: GraphLegendEntry[] = [];
    const passKinds = new Set(snapshot.nodes.map((node) => node.kind));
    for (const kind of ['render', 'compute', 'copy', 'clear-buffer', 'command', 'external-submission'] as const) {
        if (passKinds.has(kind)) entries.push(nodeEntries[kind]);
    }
    const retained = new Set(snapshot.nodes.map((node) => node.id));
    const used = new Set([
        ...snapshot.accessEdges.filter((access) => retained.has(access.nodeId)).map((access) => access.resource.id),
        ...snapshot.roots.flatMap((root) => root.resource ? [root.resource.id] : []),
    ]);
    const resources = snapshot.resources.filter((resource) => used.has(resource.id));
    if (resources.length) entries.push({ group: 'Resources', key: 'declaration', label: 'Declaration', color: theme.declaration.stroke, shape: 'ellipse' });
    if (snapshot.roots.some((root) => root.resource)) entries.push({ group: 'Resources', key: 'output', label: 'Output', color: theme.output.stroke, shape: 'tag' });
    if ([...snapshot.nodes, ...resources].some((item) => item.debugGroupId !== undefined)) {
        entries.push({ group: 'Relationships', key: 'group', label: 'Group', color: theme.group.stroke, shape: 'group' });
    }
    if (snapshot.edges.some((edge) => edge.kind === 'value')
        || declarationEntrances(snapshot.nodes, snapshot.accessEdges, snapshot.edges).length
        || snapshot.roots.some((root) => root.resource && root.resolution && (root.resolution.usesInitialContents || root.resolution.producerNodeIds.length))) {
        entries.push(edgeLegend('flow', 'Resource Flow', theme.dependency.value, 'solid'));
    }
    if (snapshot.edges.some((edge) => edge.kind === 'ordering')) {
        entries.push({
            ...edgeLegend('ordering', 'Order', theme.dependency.ordering, 'dotted'),
            hollowArrow: true,
        });
    }
    return entries;
}

export function createGraphStyles(theme: GraphVisualTheme = GRAPH_VISUAL_THEME): cytoscape.StylesheetJson {
    return [
        {
            selector: 'core',
            style: {
                'active-bg-color': theme.activeBackground.color,
                'active-bg-opacity': theme.activeBackground.opacity,
                'active-bg-size': theme.activeBackground.size,
            // Cytoscape accepts partial core styles; its Core type marks every property required.
            } satisfies Partial<cytoscape.Css.Core> as cytoscape.Css.Core,
        },
        {
            selector: 'node',
            style: {
                'shape': 'round-rectangle',
                'width': 'data(width)',
                'height': 'data(height)',
                'label': 'data(displayLabel)',
                'text-wrap': 'wrap',
                'text-max-width': 'data(labelMaxWidth)',
                'font-family': theme.fontFamily,
                'font-size': theme.fontSize,
                'min-zoomed-font-size': GRAPH_GEOMETRY.minimumZoomedFontSize,
                'color': theme.text,
                'background-color': theme.surfaceRaised,
                'border-color': theme.group.stroke,
                'border-width': theme.nodeBorderWidth,
                'border-style': 'solid',
                'text-valign': 'center',
                'text-halign': 'center',
                'overlay-opacity': 0,
                'underlay-opacity': 0,
            },
        },
        passStyle('render', theme.render),
        passStyle('compute', theme.compute),
        passStyle('copy', theme.copy),
        passStyle('clear-buffer', theme.clear),
        passStyle('command', theme.command),
        {
            selector: 'node[passKind = "external-submission"]',
            style: {
                'background-color': theme.external.fill,
                'border-color': theme.external.stroke,
                'shape': 'cut-rectangle',
                'corner-radius': '10px',
            },
        },
        {
            selector: 'node[kind = "resource"]',
            style: {
                'shape': 'ellipse',
                'background-color': theme.declaration.fill,
                'border-color': theme.declaration.stroke,
            },
        },
        {
            selector: 'node[kind = "root"]',
            style: {
                'shape': 'polygon',
                'shape-polygon-points': `-1 -1 ${1 - 2 * GRAPH_GEOMETRY.outputTipWidth / GRAPH_GEOMETRY.outputWidth} -1 1 0 ${1 - 2 * GRAPH_GEOMETRY.outputTipWidth / GRAPH_GEOMETRY.outputWidth} 1 -1 1`,
                'background-color': theme.output.fill,
                'border-color': theme.output.stroke,
                'text-max-width': 'data(labelMaxWidth)',
                // Keep a short tip and center the label in the rectangular body.
                'text-margin-x': -GRAPH_GEOMETRY.outputTipWidth / 2 * theme.fontSize / GRAPH_GEOMETRY.baseFontSize,
            },
        },
        {
            selector: 'node[kind = "group"]',
            style: {
                'text-max-width': (element: cytoscape.SingularElementArgument) => `${element.data('labelMaxWidth') as number}px`,
            },
        },
        {
            selector: 'node[kind = "group"][collapsed = 1]',
            style: {
                'background-color': theme.group.fill,
                'border-color': theme.group.stroke,
                'border-width': theme.groupBorderWidth,
                'color': theme.text,
            },
        },
        {
            selector: 'node[kind = "group"][collapsed = 0]',
            style: expandedGroupStyle(theme.group.fill, theme),
        },
        {
            selector: 'node[kind = "group"][collapsed = 0][depthBand = 1]',
            style: { 'background-color': theme.group.alternateFill },
        },
        {
            selector: 'edge',
            style: {
                'width': theme.edgeWidth,
                'line-color': theme.dependency.value,
                'line-opacity': theme.edgeOpacity,
                'target-arrow-color': theme.dependency.value,
                'target-arrow-shape': 'triangle',
                'target-arrow-fill': 'filled',
                'arrow-scale': theme.arrowScale,
                'curve-style': 'straight',
                'label': 'data(displayLabel)',
                'font-family': theme.fontFamily,
                'font-size': 10,
                'min-zoomed-font-size': GRAPH_GEOMETRY.minimumZoomedFontSize,
                'color': theme.text,
                'text-background-color': theme.canvas,
                'text-background-opacity': 0.82,
                'text-background-padding': '2px',
                'text-rotation': 'autorotate',
                'overlay-opacity': 0,
                'underlay-opacity': 0,
            },
        },
        {
            selector: 'edge[kind = "ordering"]',
            style: {
                'line-color': theme.dependency.ordering,
                'target-arrow-color': theme.dependency.ordering,
                'line-style': 'dotted',
                'target-arrow-fill': 'hollow',
                'line-opacity': theme.orderingOpacity,
            },
        },
        {
            selector: 'edge.elk-route',
            style: {
                'source-endpoint': 'data(sourceEndpoint)',
                'target-endpoint': 'data(targetEndpoint)',
                'edge-distances': ENDPOINT_EDGE_DISTANCES,
            },
        },
        {
            selector: 'edge.elk-segments',
            style: {
                'curve-style': 'round-segments',
                'segment-distances': 'data(segmentDistances)',
                'segment-weights': 'data(segmentWeights)',
                'segment-radii': EDGE_SEGMENT_RADII,
            },
        },
        {
            selector: 'node.semantic-hover',
            style: {
                'border-color': theme.hover,
                'border-width': theme.hoverWidth,
                'z-index': 15,
            },
        },
        {
            selector: 'edge.semantic-hover',
            style: {
                'line-color': theme.hover,
                'target-arrow-color': theme.hover,
                'line-opacity': 1,
                'width': theme.hoverWidth,
                'z-index': 15,
            },
        },
        {
            selector: 'node.semantic-selected',
            style: {
                'border-color': theme.selected,
                'border-width': theme.selectedWidth,
                'opacity': 1,
                'z-index': 20,
            },
        },
        {
            selector: 'edge.semantic-selected',
            style: {
                'line-color': theme.selected,
                'target-arrow-color': theme.selected,
                'line-opacity': 1,
                'width': theme.selectedWidth,
                'z-index': 20,
            },
        },
    ];
}

function baseNodeDimensions(node: GraphSceneNode): { readonly width: number; readonly height: number } {
    switch (node.kind) {
        case 'pass':
            return { width: 184, height: node.label.includes('\n') ? 62 : 48 };
        case 'root':
            return { width: GRAPH_GEOMETRY.outputWidth, height: Math.max(58, node.label.split('\n').length * 17 + 24) };
        case 'resource':
            return { width: 184, height: Math.max(58, node.label.split('\n').length * 17 + 24) };
        case 'group':
            return node.collapsed ? { width: 224, height: 68 } : { width: 120, height: 80 };
    }
}

export function nodeDimensions(node: GraphSceneNode, theme: GraphVisualTheme = GRAPH_VISUAL_THEME): { readonly width: number; readonly height: number } {
    const base = baseNodeDimensions(node);
    const scale = theme.fontSize / GRAPH_GEOMETRY.baseFontSize;
    return { width: base.width * scale, height: base.height * scale };
}

/** Fit the already semantic label to its available width after font changes. */
export function fitGraphLabel(label: string, width: number, theme: GraphVisualTheme): string {
    const context = graphTextContext();
    if (context) context.font = theme.fontSize + 'px ' + theme.fontFamily;
    const measure = (text: string) => context?.measureText(text).width ?? [...text].length * theme.fontSize * .62;
    return label.split('\n').map(line => {
        if (measure(line) <= width) return line;
        const chars = [...line];
        while (chars.length && measure(chars.join('') + '…') > width) chars.pop();
        return chars.join('') + '…';
    }).join('\n');
}

let textContext: CanvasRenderingContext2D | null | undefined;
function graphTextContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (textContext === undefined) textContext = document.createElement('canvas').getContext('2d');
    return textContext;
}

export function graphLayoutGeometryKey(scene: GraphScene): string {
    return JSON.stringify({
        topology: scene.topologyKey,
        dimensions: scene.nodes.map((node) => {
            const dimensions = nodeDimensions(node);
            return [node.id, dimensions.width, dimensions.height, node.kind === 'pass' && node.passKind === 'external-submission'];
        }),
    });
}

export function graphEdgeDisplayLabel(_edge: GraphSceneEdge): string {
    return '';
}

export function expandedGroupLabelMaxWidth(outerWidth: number): number {
    return Math.max(80, Math.floor(outerWidth - GRAPH_GEOMETRY.groupTitleInset * 2));
}

export function isOverviewGraphScale(zoom: number, theme: GraphVisualTheme = GRAPH_VISUAL_THEME): boolean {
    return theme.fontSize * zoom < GRAPH_GEOMETRY.overviewFontThreshold;
}

function nodeLegend(key: string, label: string, color: string): GraphLegendEntry {
    return { group: 'Execution', key, label, color, shape: 'box' };
}

function edgeLegend(
    key: string,
    label: string,
    color: string,
    lineStyle: NonNullable<GraphLegendEntry['lineStyle']>,
): GraphLegendEntry {
    return { group: 'Relationships', key, label, color, shape: 'line', lineStyle };
}

function passStyle(
    kind: string,
    colors: { readonly stroke: string; readonly fill: string },
): cytoscape.StylesheetStyle {
    return {
        selector: `node[passKind = "${kind}"]`,
        style: { 'background-color': colors.fill, 'border-color': colors.stroke },
    };
}

function expandedGroupStyle(backgroundColor: string, theme: GraphVisualTheme): cytoscape.Css.Node {
    const geometry = GRAPH_GEOMETRY;
    return {
        'background-color': backgroundColor,
        'background-opacity': theme.groupOpacity,
        'border-color': theme.group.stroke,
        'border-width': theme.groupBorderWidth,
        'padding': `${geometry.groupPadding}px`,
        'compound-sizing-wrt-labels': 'include',
        'min-width': '120px',
        'min-height': '80px',
        'text-valign': 'top-inside',
        'text-halign': 'left-inside',
        'text-justification': 'left',
        'text-margin-x': geometry.groupTitleInset - geometry.groupPadding * 2,
        'text-margin-y': geometry.groupTitleInset - geometry.groupPadding * 2,
        'line-height': geometry.groupTitleLineHeight,
        'color': theme.text,
        'font-weight': 600,
    };
}
