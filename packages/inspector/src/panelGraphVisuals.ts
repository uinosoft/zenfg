import type cytoscape from 'cytoscape';

import type { GraphScene, GraphSceneEdge, GraphSceneNode } from './panelGraphScene.ts';
import { GRAPH_VISUAL_THEME } from './panelVisualTheme.ts';

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
} as const;

const ENDPOINT_EDGE_DISTANCES = 'endpoints' as unknown as cytoscape.Css.Edge['edge-distances'];
const EDGE_SEGMENT_RADII = `${GRAPH_GEOMETRY.edgeCornerRadius}px` as unknown as cytoscape.Css.Edge['segment-radii'];

export type GraphLegendEntry = {
    readonly key: string;
    readonly label: string;
    readonly color: string;
    readonly shape: 'box' | 'ellipse' | 'group' | 'line';
    readonly lineStyle?: 'solid' | 'dotted' | 'dashed';
    readonly hollowArrow?: boolean;
};

const NODE_LEGEND_ENTRIES = {
    render: nodeLegend('render', 'Render', GRAPH_VISUAL_THEME.render.stroke),
    compute: nodeLegend('compute', 'Compute', GRAPH_VISUAL_THEME.compute.stroke),
    copy: nodeLegend('copy', 'Copy', GRAPH_VISUAL_THEME.copy.stroke),
    'clear-buffer': nodeLegend('clear', 'Clear', GRAPH_VISUAL_THEME.clear.stroke),
    command: nodeLegend('command', 'Command', GRAPH_VISUAL_THEME.command.stroke),
    'external-submission': nodeLegend('external', 'External', GRAPH_VISUAL_THEME.external.stroke),
} as const;

export function createGraphLegend(scene: GraphScene): readonly GraphLegendEntry[] {
    const entries: GraphLegendEntry[] = [];
    const passKinds = new Set(scene.nodes.flatMap((node) => node.kind === 'pass' || node.kind === 'culled-pass'
        ? [node.passKind]
        : []));
    for (const kind of ['render', 'compute', 'copy', 'clear-buffer', 'command', 'external-submission'] as const) {
        if (passKinds.has(kind)) entries.push(NODE_LEGEND_ENTRIES[kind]);
    }
    if (scene.nodes.some((node) => node.kind === 'group')) {
        entries.push({ key: 'group', label: 'Group', color: GRAPH_VISUAL_THEME.group.stroke, shape: 'group' });
    }
    if (scene.nodes.some((node) => node.kind === 'resource' && node.resourceKind === 'texture')) {
        entries.push({ key: 'texture', label: 'Texture', color: GRAPH_VISUAL_THEME.texture.stroke, shape: 'ellipse' });
    }
    if (scene.nodes.some((node) => node.kind === 'resource' && node.resourceKind === 'buffer')) {
        entries.push({ key: 'buffer', label: 'Buffer', color: GRAPH_VISUAL_THEME.buffer.stroke, shape: 'ellipse' });
    }
    if (scene.nodes.some((node) => node.kind === 'culled-pass')) {
        entries.push({
            key: 'culled',
            label: 'Culled',
            color: GRAPH_VISUAL_THEME.culled.stroke,
            shape: 'box',
            lineStyle: 'dashed',
        });
    }
    if (scene.edges.some((edge) => edge.kind === 'dependency' && edge.dependencyKind === 'value')) {
        entries.push(edgeLegend('value', 'Value', GRAPH_VISUAL_THEME.dependency.value, 'solid'));
    }
    if (scene.edges.some((edge) => edge.kind === 'dependency' && edge.dependencyKind === 'ordering')) {
        entries.push({
            ...edgeLegend('ordering', 'Order', GRAPH_VISUAL_THEME.dependency.ordering, 'dotted'),
            hollowArrow: true,
        });
    }
    if (scene.edges.some((edge) => edge.kind === 'access' && edge.accessMode === 'read')) {
        entries.push(edgeLegend('read', 'Read', GRAPH_VISUAL_THEME.access.read, 'solid'));
    }
    if (scene.edges.some((edge) => edge.kind === 'access' && edge.accessMode === 'write')) {
        entries.push(edgeLegend('write', 'Write', GRAPH_VISUAL_THEME.access.write, 'solid'));
    }
    return entries;
}

export function createGraphStyles(): cytoscape.StylesheetJson {
    const theme = GRAPH_VISUAL_THEME;
    return [
        {
            selector: 'node',
            style: {
                'shape': 'round-rectangle',
                'width': 'data(width)',
                'height': 'data(height)',
                'label': 'data(displayLabel)',
                'text-wrap': 'wrap',
                'text-max-width': '160px',
                'font-family': 'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                'font-size': GRAPH_GEOMETRY.baseFontSize,
                'min-zoomed-font-size': GRAPH_GEOMETRY.minimumZoomedFontSize,
                'color': theme.text,
                'background-color': theme.surfaceRaised,
                'border-color': theme.group.stroke,
                'border-width': 1.25,
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
                'border-style': 'double',
                'border-width': 3,
            },
        },
        {
            selector: 'node[kind = "culled-pass"]',
            style: {
                'background-color': theme.culled.fill,
                'border-color': theme.culled.stroke,
                'color': theme.muted,
                'border-style': 'dashed',
                'opacity': 0.72,
            },
        },
        {
            selector: 'node[kind = "resource"][resourceKind = "texture"]',
            style: {
                'shape': 'ellipse',
                'background-color': theme.texture.fill,
                'border-color': theme.texture.stroke,
            },
        },
        {
            selector: 'node[kind = "resource"][resourceKind = "buffer"]',
            style: {
                'shape': 'ellipse',
                'background-color': theme.buffer.fill,
                'border-color': theme.buffer.stroke,
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
                'border-width': 2,
                'color': theme.text,
            },
        },
        {
            selector: 'node[kind = "group"][collapsed = 0]',
            style: expandedGroupStyle(theme.group.fill),
        },
        {
            selector: 'node[kind = "group"][collapsed = 0][depthBand = 1]',
            style: { 'background-color': theme.group.alternateFill },
        },
        {
            selector: 'edge',
            style: {
                'width': 1.5,
                'line-color': theme.dependency.value,
                'line-opacity': 0.82,
                'target-arrow-color': theme.dependency.value,
                'target-arrow-shape': 'triangle',
                'target-arrow-fill': 'filled',
                'arrow-scale': 0.8,
                'curve-style': 'straight',
                'label': 'data(displayLabel)',
                'font-family': 'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
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
            selector: 'edge[dependencyKind = "ordering"]',
            style: {
                'line-color': theme.dependency.ordering,
                'target-arrow-color': theme.dependency.ordering,
                'line-style': 'dotted',
                'target-arrow-fill': 'hollow',
                'line-opacity': 0.72,
            },
        },
        {
            selector: 'edge[accessMode = "read"]',
            style: {
                'line-color': theme.access.read,
                'target-arrow-color': theme.access.read,
            },
        },
        {
            selector: 'edge[accessMode = "write"]',
            style: {
                'line-color': theme.access.write,
                'target-arrow-color': theme.access.write,
            },
        },
        {
            selector: 'edge[dashed = 1]',
            style: { 'line-style': 'dashed', 'line-opacity': 0.46, 'opacity': 0.58 },
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
                'border-width': 2,
                'z-index': 15,
            },
        },
        {
            selector: 'edge.semantic-hover',
            style: {
                'line-color': theme.hover,
                'target-arrow-color': theme.hover,
                'line-opacity': 1,
                'width': 2.5,
                'z-index': 15,
            },
        },
        {
            selector: 'node.semantic-selected',
            style: {
                'border-color': theme.selected,
                'border-width': 3,
                'underlay-color': theme.selected,
                'underlay-padding': 5,
                'underlay-opacity': 0.18,
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
                'width': 3,
                'z-index': 20,
            },
        },
    ];
}

export function nodeDimensions(node: GraphSceneNode): { readonly width: number; readonly height: number } {
    switch (node.kind) {
        case 'pass':
            return { width: 184, height: node.label.includes('\n') ? 62 : 48 };
        case 'culled-pass':
            return { width: 184, height: 64 };
        case 'resource':
            return { width: 166, height: node.label.includes('\n') ? 58 : 46 };
        case 'group':
            return node.collapsed ? { width: 224, height: 68 } : { width: 120, height: 80 };
    }
}

export function graphLayoutGeometryKey(scene: GraphScene): string {
    return JSON.stringify({
        topology: scene.topologyKey,
        dimensions: scene.nodes.map((node) => {
            const dimensions = nodeDimensions(node);
            return [node.id, dimensions.width, dimensions.height];
        }),
    });
}

export function graphEdgeDisplayLabel(edge: GraphSceneEdge): string {
    return edge.kind === 'access' ? '' : edge.label ?? '';
}

export function expandedGroupLabelMaxWidth(outerWidth: number): number {
    return Math.max(80, Math.floor(outerWidth - GRAPH_GEOMETRY.groupTitleInset * 2));
}

export function isOverviewGraphScale(zoom: number): boolean {
    return GRAPH_GEOMETRY.baseFontSize * zoom < GRAPH_GEOMETRY.overviewFontThreshold;
}

function nodeLegend(key: string, label: string, color: string): GraphLegendEntry {
    return { key, label, color, shape: 'box' };
}

function edgeLegend(
    key: string,
    label: string,
    color: string,
    lineStyle: NonNullable<GraphLegendEntry['lineStyle']>,
): GraphLegendEntry {
    return { key, label, color, shape: 'line', lineStyle };
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

function expandedGroupStyle(backgroundColor: string): cytoscape.Css.Node {
    const geometry = GRAPH_GEOMETRY;
    return {
        'background-color': backgroundColor,
        'background-opacity': 0.34,
        'border-color': GRAPH_VISUAL_THEME.group.stroke,
        'border-width': 1.5,
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
        'color': GRAPH_VISUAL_THEME.text,
        'font-weight': 600,
    };
}
