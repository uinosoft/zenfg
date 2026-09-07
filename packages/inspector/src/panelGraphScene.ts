import type {
    FrameGraphDebugAccessEdge,
    FrameGraphDebugEdge,
    FrameGraphDebugGroup,
    FrameGraphDebugNode,
    FrameGraphDebugResource,
    FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';
import { formatGpuDuration, labelNode, labelResource } from './panelDomHelpers.ts';
import { declarationEntrances } from './debugCaptureModel.ts';
import type { GraphFlowRelation, Selection } from './panelTypes.ts';

export type GraphSceneElementId = string;

type GraphSceneNodeBase = {
    readonly id: GraphSceneElementId;
    readonly label: string;
    readonly overviewLabel: string;
    readonly title: string;
    readonly parentId?: GraphSceneElementId;
};

export type PassSceneNode = GraphSceneNodeBase & {
    readonly kind: 'pass';
    readonly nodeId: string;
    readonly passKind: FrameGraphDebugNode['kind'];
    readonly executionSegmentIndex?: number;
    readonly gpuDurationMicros?: number;
};

export type GroupSceneNode = GraphSceneNodeBase & {
    readonly kind: 'group';
    readonly groupId: string;
    readonly groupPathKey: string;
    readonly collapsed: boolean;
    readonly depthBand: 0 | 1;
    readonly childNodeIds: readonly GraphSceneElementId[];
    readonly representedNodeIds: readonly string[];
    readonly retainedNodeCount: number;
    readonly culledNodeCount: number;
    readonly gpuWorkDurationMicros: number;
    readonly timedNodeCount: number;
    readonly timingEligibleNodeCount: number;
};

export type ResourceSceneNode = GraphSceneNodeBase & {
    readonly kind: 'resource';
    readonly resourceId: string;
    readonly resourceKind: FrameGraphDebugResource['kind'];
};

export type RootSceneNode = GraphSceneNodeBase & {
    readonly kind: 'root';
    readonly rootKey: string;
    readonly resourceId: string;
    readonly resourceKind: FrameGraphDebugResource['kind'];
};
export type GraphSceneNode = PassSceneNode | GroupSceneNode | ResourceSceneNode | RootSceneNode;

type GraphSceneEdgeBase = {
    readonly id: GraphSceneElementId;
    readonly from: GraphSceneElementId;
    readonly to: GraphSceneElementId;
    readonly title: string;
    readonly resourceId: string;
};

export type GraphSceneEdge = GraphSceneEdgeBase & {
    readonly kind: 'flow' | 'ordering';
    readonly relations: readonly GraphFlowRelation[];
    readonly underlyingDependencies: readonly FrameGraphDebugEdge[];
    readonly underlyingDependencyCount: number;
};

export type GraphSemanticReferences = {
    readonly nodeIds: readonly string[];
    readonly groupPathKeys: readonly string[];
    readonly resourceIds: readonly string[];
    readonly accessIds: readonly string[];
    readonly dependencies: readonly FrameGraphDebugEdge[];
};

export type GraphSceneInteractionIndex = {
    readonly selectionByElementId: ReadonlyMap<GraphSceneElementId, Selection>;
    readonly primaryElementIdsBySelection: ReadonlyMap<string, readonly GraphSceneElementId[]>;
    readonly hoverElementIdsBySelection: ReadonlyMap<string, readonly GraphSceneElementId[]>;
    readonly resourceElementIdsByResourceId: ReadonlyMap<string, readonly GraphSceneElementId[]>;
    readonly semanticReferencesByElementId: ReadonlyMap<GraphSceneElementId, GraphSemanticReferences>;
};

export type GraphScene = {
    readonly nodes: readonly GraphSceneNode[];
    readonly edges: readonly GraphSceneEdge[];
    readonly topologyKey: string;
    readonly contentKey: string;
    readonly interaction: GraphSceneInteractionIndex;
};

export type CreateGraphSceneOptions = {
    readonly groupsEnabled: boolean;
    readonly expandedGroupPaths: ReadonlySet<string>;
};

type MutableInteractionIndex = {
    readonly selectionByElementId: Map<GraphSceneElementId, Selection>;
    readonly primaryElementIdsBySelection: Map<string, GraphSceneElementId[]>;
    readonly hoverElementIdsBySelection: Map<string, GraphSceneElementId[]>;
    readonly resourceElementIdsByResourceId: Map<string, GraphSceneElementId[]>;
    readonly semanticReferencesByElementId: Map<GraphSceneElementId, GraphSemanticReferences>;
};

export function createGraphScene(
    snapshot: FrameGraphDebugViewModel,
    options: CreateGraphSceneOptions,
): GraphScene {
    return createFrameFlowScene(snapshot, options.groupsEnabled, options.expandedGroupPaths);
}

export function graphGroupElementId(pathKey: string): GraphSceneElementId {
    return `group:${pathKey}`;
}

export function selectionKey(selection: Selection): string {
    switch (selection.kind) {
        case 'node':
            return `node:${selection.id}`;
        case 'group':
            return `group:${selection.pathKey}`;
        case 'resource':
            return `resource:${selection.id}`;
        case 'allocation':
            return `allocation:${selection.id}`;
        case 'root':
            return `root:${selection.key}`;
        case 'culled':
            return `culled:${selection.index}`;
        case 'segment':
            return `segment:${selection.index}`;
    }
}

function createFrameFlowScene(
    snapshot: FrameGraphDebugViewModel,
    groupsEnabled: boolean,
    expandedGroupPaths: ReadonlySet<string>,
): GraphScene {
    const interaction = createMutableInteractionIndex();
    const segmentByNodeId = executionSegmentByNodeId(snapshot);
    const groupsById = new Map(snapshot.debugGroups.map((group) => [group.id, group]));
    const useGroups = groupsEnabled && snapshot.debugGroups.length > 0;
    const isExpanded = (group: FrameGraphDebugGroup) => expandedGroupPaths.has(group.pathKey);
    const hasVisibleAncestors = (group: FrameGraphDebugGroup) => group.ancestorIds
        .slice(0, -1)
        .every((id) => isExpanded(groupsById.get(id)!));
    const retainedIds = new Set(snapshot.nodes.map((node) => node.id));
    const usedResourceIds = new Set([
        ...snapshot.accessEdges.filter((access) => retainedIds.has(access.nodeId)).map((access) => access.resource.id),
        ...snapshot.roots.flatMap((root) => root.resource ? [root.resource.id] : []),
    ]);
    const resources = snapshot.resources.filter((resource) => usedResourceIds.has(resource.id));
    const populatedGroupIds = new Set<string>();
    for (const item of [...snapshot.nodes, ...resources]) {
        for (const id of groupsById.get(item.debugGroupId ?? '')?.ancestorIds ?? []) populatedGroupIds.add(id);
    }
    const visibleResources = resources.filter((resource) => !useGroups || resource.debugGroupId === undefined
        || groupsById.get(resource.debugGroupId)!.ancestorIds.every((id) => isExpanded(groupsById.get(id)!)));
    const includedGroups = useGroups
        ? snapshot.debugGroups.filter((group) => populatedGroupIds.has(group.id) && hasVisibleAncestors(group))
        : [];
    const includedGroupIds = new Set(includedGroups.map((group) => group.id));
    const representedNodeIdsByGroupId = new Map<string, string[]>();
    for (const node of snapshot.nodes) {
        const group = node.debugGroupId === undefined ? undefined : groupsById.get(node.debugGroupId);
        for (const groupId of group?.ancestorIds ?? []) {
            const represented = representedNodeIdsByGroupId.get(groupId) ?? [];
            represented.push(node.id);
            representedNodeIdsByGroupId.set(groupId, represented);
        }
    }
    const visiblePasses = snapshot.nodes.filter((node) => {
        if (!useGroups || node.debugGroupId === undefined) return true;
        return groupsById.get(node.debugGroupId)!.ancestorIds.every((id) => isExpanded(groupsById.get(id)!));
    });
    const visiblePassIds = new Set(visiblePasses.map((node) => node.id));
    const includedGroupsByParentId = indexByOptionalId(includedGroups, (group) => group.parentId);
    const visiblePassesByGroupId = indexByOptionalId(visiblePasses, (node) => node.debugGroupId);

    const groupNodes: GroupSceneNode[] = includedGroups.map((group) => {
        const id = graphGroupElementId(group.pathKey);
        const collapsed = !isExpanded(group);
        const representedNodeIds = representedNodeIdsByGroupId.get(group.id) ?? [];
        const childNodeIds = collapsed ? [] : [
            ...(includedGroupsByParentId.get(group.id) ?? [])
                .map((child) => graphGroupElementId(child.pathKey)),
            ...(visiblePassesByGroupId.get(group.id) ?? [])
                .map((node) => passElementId(node.id)),
            ...visibleResources.filter((resource) => resource.debugGroupId === group.id).map((resource) => resourceElementId(resource.id)),
        ];
        const node: GroupSceneNode = {
            id,
            kind: 'group',
            groupId: group.id,
            groupPathKey: group.pathKey,
            label: createGroupLabel(group, collapsed),
            overviewLabel: `${collapsed ? '▸' : '▾'} ${group.label}`,
            title: createGroupTitle(group),
            parentId: group.parentId !== undefined && includedGroupIds.has(group.parentId)
                ? graphGroupElementId(groupsById.get(group.parentId)!.pathKey)
                : undefined,
            collapsed,
            depthBand: group.ancestorIds.length % 2 as 0 | 1,
            childNodeIds,
            representedNodeIds,
            retainedNodeCount: group.summary.retainedNodeCount,
            culledNodeCount: group.summary.culledNodeCount,
            gpuWorkDurationMicros: group.summary.gpuWorkDurationMicros,
            timedNodeCount: group.summary.timedNodeCount,
            timingEligibleNodeCount: group.summary.timingEligibleNodeCount,
        };
        const selection: Selection = { kind: 'group', pathKey: group.pathKey };
        registerElement(interaction, node.id, selection, {
            nodeIds: representedNodeIds,
            groupPathKeys: [group.pathKey],
            resourceIds: [
                ...group.summary.inputResources.map((resource) => resource.id),
                ...group.summary.outputResources.map((resource) => resource.id),
            ],
            accessIds: [],
            dependencies: [],
        });
        return node;
    });

    const passNodes: PassSceneNode[] = visiblePasses.map((node) => {
        const segment = segmentByNodeId.get(node.id);
        const sceneNode: PassSceneNode = {
            id: passElementId(node.id),
            kind: 'pass',
            nodeId: node.id,
            passKind: node.kind,
            executionSegmentIndex: segment?.index,
            gpuDurationMicros: node.gpuDurationMicros,
            label: formatGraphNodeLabel(`${segmentLabel(segment)} ${labelNode(node)}`),
            overviewLabel: shortGraphLabel(labelNode(node)),
            title: createNodeTitle(node, segment, snapshot),
            parentId: useGroups && node.debugGroupId !== undefined
                ? graphGroupElementId(groupsById.get(node.debugGroupId)!.pathKey)
                : undefined,
        };
        const selection: Selection = { kind: 'node', id: node.id };
        registerElement(interaction, sceneNode.id, selection, emptyReferences({ nodeIds: [node.id] }));
        return sceneNode;
    });

    const representativeByNodeId = new Map<string, GraphSceneElementId>();
    for (const node of snapshot.nodes) {
        if (visiblePassIds.has(node.id)) {
            representativeByNodeId.set(node.id, passElementId(node.id));
            continue;
        }
        const group = groupsById.get(node.debugGroupId!)!;
        const collapsedAncestorId = group.ancestorIds.find((id) => !isExpanded(groupsById.get(id)!));
        representativeByNodeId.set(node.id, graphGroupElementId(groupsById.get(collapsedAncestorId!)!.pathKey));
    }

    for (const node of snapshot.nodes) {
        const representative = representativeByNodeId.get(node.id)!;
        setSelectionElements(interaction, { kind: 'node', id: node.id }, [representative]);
    }
    if (useGroups) {
        for (const group of snapshot.debugGroups) {
            if (includedGroupIds.has(group.id)) continue;
            const collapsedAncestorId = group.ancestorIds.find((id) => !isExpanded(groupsById.get(id)!));
            if (collapsedAncestorId !== undefined) {
                const representative = graphGroupElementId(groupsById.get(collapsedAncestorId)!.pathKey);
                setSelectionElements(interaction, { kind: 'group', pathKey: group.pathKey }, [representative]);
            }
        }
    }

    const representativeByResourceId = new Map<string, string>();
    for (const resource of resources) {
        const collapsed = useGroups ? groupsById.get(resource.debugGroupId ?? '')?.ancestorIds.find((id) => !isExpanded(groupsById.get(id)!)) : undefined;
        const representative = collapsed ? graphGroupElementId(groupsById.get(collapsed)!.pathKey) : resourceElementId(resource.id);
        representativeByResourceId.set(resource.id, representative);
    }
    const resourceNodes: ResourceSceneNode[] = visibleResources.map((resource) => {
        const origin = resource.origin === 'transient' ? 'Created' : resource.origin === 'imported' ? 'Imported' : 'Surface';
        const node: ResourceSceneNode = {
            id: resourceElementId(resource.id), kind: 'resource', resourceId: resource.id, resourceKind: resource.kind,
            label: origin + ' · ' + (resource.kind === 'buffer' ? 'Buffer' : 'Texture') + '\n' + formatGraphResourceLabel(labelResource(resource)),
            overviewLabel: origin + '\n' + formatGraphResourceLabel(shortGraphLabel(labelResource(resource))),
            title: createResourceTitle(resource, snapshot, snapshot.accessesByResourceId.get(resource.id) ?? [])
                + '\nDeclaration entrance, not a complete initial-content provenance graph.',
            parentId: useGroups && resource.debugGroupId ? graphGroupElementId(groupsById.get(resource.debugGroupId)!.pathKey) : undefined,
        };
        registerElement(interaction, node.id, { kind: 'resource', id: resource.id }, emptyReferences({ resourceIds: [resource.id] }));
        interaction.resourceElementIdsByResourceId.set(resource.id, [node.id]);
        return node;
    });
    const rootNodes: RootSceneNode[] = [];
    const aggregates = new Map<string, { from: string; to: string; resourceId: string; relations: GraphFlowRelation[] }>();
    const addRelation = (from: string, to: string, resourceId: string, relation: GraphFlowRelation) => {
        if (from === to) return;
        const key = JSON.stringify([from, to, resourceId]);
        const entry = aggregates.get(key) ?? { from, to, resourceId, relations: [] };
        entry.relations.push(relation);
        aggregates.set(key, entry);
    };
    for (const dependency of snapshot.edges) {
        addRelation(representativeByNodeId.get(dependency.fromNodeId)!, representativeByNodeId.get(dependency.toNodeId)!, dependency.resource.id,
            { role: dependency.kind, nodeIds: [dependency.fromNodeId, dependency.toNodeId], dependency });
    }
    for (const access of declarationEntrances(snapshot.nodes, snapshot.accessEdges, snapshot.edges)) {
        addRelation(representativeByResourceId.get(access.resource.id)!, representativeByNodeId.get(access.nodeId)!, access.resource.id,
            { role: 'declaration', nodeIds: [access.nodeId] });
    }
    const rootOccurrences = new Map<string, number>();
    const rangesByRootFamily = new Map<string, Set<string>>();
    for (const root of snapshot.roots) {
        if (!root.resource) continue;
        const family = JSON.stringify([root.resource.id, root.reason]);
        const ranges = rangesByRootFamily.get(family) ?? new Set<string>();
        ranges.add(root.key);
        rangesByRootFamily.set(family, ranges);
    }
    for (const root of snapshot.roots) {
        if (!root.resource) {
            if (root.nodeId) {
                const representative = representativeByNodeId.get(root.nodeId)!;
                setSelectionElements(interaction, { kind: 'root', key: root.key }, [representative]);
            }
            continue;
        }
        const occurrence = rootOccurrences.get(root.key) ?? 0;
        rootOccurrences.set(root.key, occurrence + 1);
        const id = 'root:' + root.key + (occurrence ? ':' + occurrence : '');
        const resource = snapshot.resourceById.get(root.resource.id)!;
        const rangeLabel = root.range?.kind === 'buffer' ? `bytes ${root.range.offset}–${root.range.offset + root.range.size}`
            : root.range ? root.range.regions.map((r) => `mip ${r.baseMipLevel}+${r.mipLevelCount} · ${r.baseDepthSlice !== undefined ? 'D' + r.baseDepthSlice + '+' + r.depthSliceCount : 'L' + r.baseArrayLayer + '+' + r.arrayLayerCount} · ${r.aspect}`).join('; ') : 'Range unavailable';
        const rangeSummary = root.range?.kind === 'texture'
            ? root.range.regions.map((r) => `m${r.baseMipLevel}+${r.mipLevelCount} ${r.baseDepthSlice !== undefined ? 'D' + r.baseDepthSlice + '+' + r.depthSliceCount : 'L' + r.baseArrayLayer + '+' + r.arrayLayerCount} ${r.aspect === 'depth-only' ? 'depth' : r.aspect === 'stencil-only' ? 'stencil' : 'all'}`).join('; ')
            : rangeLabel;
        const reasonLabel = root.reason.split('-').map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ');
        const disambiguate = rangesByRootFamily.get(JSON.stringify([resource.id, root.reason]))!.size > 1;
        rootNodes.push({
            id, kind: 'root', rootKey: root.key, resourceId: resource.id, resourceKind: resource.kind,
            label: reasonLabel + '\n' + formatGraphResourceLabel(labelResource(resource))
                + (disambiguate ? '\n' + formatGraphResourceLabel(rangeSummary) : ''),
            overviewLabel: reasonLabel + '\n' + formatGraphResourceLabel(shortGraphLabel(labelResource(resource))),
            title: labelResource(resource) + '\n' + root.reason + '\n' + rangeLabel
                + (root.resolution ? '\nProducers: ' + (root.resolution.producerNodeIds.join(', ') || 'none') + '\nInitial contents: ' + root.resolution.usesInitialContents : '\nOutput sources unavailable in Legacy capture.'),
        });
        registerElement(interaction, id, { kind: 'root', key: root.key },
            emptyReferences({ resourceIds: [resource.id], nodeIds: root.resolution?.producerNodeIds ?? [] }));
        for (const nodeId of root.resolution?.producerNodeIds ?? []) {
            addRelation(representativeByNodeId.get(nodeId)!, id, resource.id, { role: 'output-producer', nodeIds: [nodeId], rootKey: root.key });
        }
        if (root.resolution?.usesInitialContents) addRelation(representativeByResourceId.get(resource.id)!, id, resource.id,
            { role: 'output-initial', nodeIds: [], rootKey: root.key });
    }
    const edges: GraphSceneEdge[] = [...aggregates.entries()].map(([key, entry]) => {
        const underlyingDependencies = entry.relations.flatMap((relation) => relation.dependency ? [relation.dependency] : []);
        const edge: GraphSceneEdge = {
            id: 'flow:' + key, ...entry,
            kind: entry.relations.every((relation) => relation.role === 'ordering') ? 'ordering' : 'flow',
            title: labelResource(snapshot.resourceById.get(entry.resourceId)!) + '\n'
                + unique(entry.relations.map((relation) => relation.role)).join(' · '),
            underlyingDependencies, underlyingDependencyCount: underlyingDependencies.length,
        };
        const selection: Selection = { kind: 'resource', id: entry.resourceId };
        registerElement(interaction, edge.id, selection, emptyReferences({
            nodeIds: unique(entry.relations.flatMap((relation) => relation.nodeIds)), resourceIds: [entry.resourceId], dependencies: underlyingDependencies,
        }));
        const resourceElements = interaction.resourceElementIdsByResourceId.get(entry.resourceId) ?? [];
        resourceElements.push(edge.id);
        interaction.resourceElementIdsByResourceId.set(entry.resourceId, resourceElements);
        return edge;
    });
    for (const [resourceId, elements] of interaction.resourceElementIdsByResourceId) {
        const selection: Selection = { kind: 'resource', id: resourceId };
        setSelectionElements(interaction, selection, elements);
        interaction.hoverElementIdsBySelection.set(selectionKey(selection), [...elements]);
    }
    return finalizeScene([...groupNodes, ...passNodes, ...resourceNodes, ...rootNodes], edges, interaction);
}

function finalizeScene(
    nodes: readonly GraphSceneNode[],
    edges: readonly GraphSceneEdge[],
    interaction: MutableInteractionIndex,
): GraphScene {
    const topologyKey = JSON.stringify({
        nodes: nodes.map((node) => [node.id, node.kind, node.parentId, node.kind === 'group' ? node.collapsed : undefined]),
        edges: edges.map((edge) => [edge.id, edge.kind, edge.from, edge.to]),
    });
    const contentKey = JSON.stringify({
        nodes: nodes.map((node) => [
            node.id,
            node.kind,
            node.parentId,
            node.label,
            node.overviewLabel,
            node.title,
            node.kind === 'pass' ? node.passKind : undefined,
            (node.kind === 'resource' || node.kind === 'root') ? node.resourceKind : undefined,
            node.kind === 'group' ? node.collapsed : undefined,
            node.kind === 'group' ? node.depthBand : undefined,
            node.kind === 'group' ? node.culledNodeCount > 0 : undefined,
        ]),
        edges: edges.map((edge) => [
            edge.id,
            edge.kind,
            edge.from,
            edge.to,
            edge.title,
            edge.relations,
        ]),
    });
    return {
        nodes,
        edges,
        topologyKey,
        contentKey,
        interaction,
    };
}

function createMutableInteractionIndex(): MutableInteractionIndex {
    return {
        selectionByElementId: new Map(),
        primaryElementIdsBySelection: new Map(),
        hoverElementIdsBySelection: new Map(),
        resourceElementIdsByResourceId: new Map(),
        semanticReferencesByElementId: new Map(),
    };
}

function registerElement(
    interaction: MutableInteractionIndex,
    elementId: GraphSceneElementId,
    selection: Selection,
    references: GraphSemanticReferences,
): void {
    interaction.selectionByElementId.set(elementId, selection);
    setSelectionElements(interaction, selection, [elementId]);
    interaction.hoverElementIdsBySelection.set(selectionKey(selection), [elementId]);
    interaction.semanticReferencesByElementId.set(elementId, references);
}

function setSelectionElements(
    interaction: MutableInteractionIndex,
    selection: Selection,
    primary: readonly GraphSceneElementId[],
): void {
    interaction.primaryElementIdsBySelection.set(selectionKey(selection), [...primary]);
}

function emptyReferences(overrides: Partial<GraphSemanticReferences>): GraphSemanticReferences {
    return {
        nodeIds: [],
        groupPathKeys: [],
        resourceIds: [],
        accessIds: [],
        dependencies: [],
        ...overrides,
    };
}

function passElementId(nodeId: string): GraphSceneElementId {
    return `pass:${nodeId}`;
}

function resourceElementId(resourceId: string): GraphSceneElementId {
    return `resource:${resourceId}`;
}

function formatGraphNodeLabel(label: string): string {
    return formatGraphLabel(label, 20, 3);
}

function formatGraphResourceLabel(label: string): string {
    const singleLine = label.replace(/\s+/g, ' ').trim();
    // Reserve conservative monospace cells for CJK/emoji fallback glyphs as well.
    const glyphs = [...singleLine];
    const cells = (glyph: string) => /\p{Mark}/u.test(glyph) ? 0 : glyph.codePointAt(0)! > 255 ? 2 : 1;
    if (glyphs.reduce((sum, glyph) => sum + cells(glyph), 0) <= 18) return singleLine;
    let result = '';
    let width = 0;
    for (const glyph of glyphs) {
        if (width + cells(glyph) > 17) break;
        result += glyph;
        width += cells(glyph);
    }
    return result + '…';
}

function formatGraphLabel(label: string, maxLineLength: number, maxLines: number): string {
    if (label.length <= maxLineLength) return label;
    const chunks = label.match(/[^.]+\.?/g) ?? [label];
    const lines: string[] = [];
    let current = '';
    let truncated = false;
    for (const chunk of chunks) {
        const next = current ? `${current}${chunk}` : chunk;
        if (current && next.length > maxLineLength) {
            lines.push(current);
            current = chunk;
            if (lines.length === maxLines) {
                truncated = true;
                break;
            }
            continue;
        }
        if (!current && chunk.length > maxLineLength) {
            const wrapped = splitLongGraphLabelChunk(chunk, maxLineLength);
            for (const line of wrapped) {
                if (lines.length === maxLines) {
                    truncated = true;
                    break;
                }
                lines.push(line);
            }
            current = '';
            if (truncated) break;
            continue;
        }
        current = next;
    }
    if (current && lines.length < maxLines) lines.push(current);
    else if (current) truncated = true;
    if (lines.length > maxLines) {
        lines.length = maxLines;
        truncated = true;
    }
    if (truncated && lines.length > 0) {
        const line = lines[lines.length - 1]!;
        lines[lines.length - 1] = line.length < maxLineLength
            ? `${line}…`
            : `${line.slice(0, Math.max(1, maxLineLength - 1))}…`;
    }
    return lines.join('\n');
}

function splitLongGraphLabelChunk(label: string, maxLineLength: number): string[] {
    const chunks = label.match(/[^\s_\-/]+[\s_\-/]*/g) ?? [label];
    const lines: string[] = [];
    let current = '';
    for (const chunk of chunks) {
        const next = current ? `${current}${chunk}` : chunk;
        if (current && next.length > maxLineLength) {
            lines.push(current);
            current = chunk;
        } else if (!current && chunk.length > maxLineLength) {
            for (let index = 0; index < chunk.length; index += maxLineLength) {
                lines.push(chunk.slice(index, index + maxLineLength));
            }
        } else {
            current = next;
        }
    }
    if (current) lines.push(current);
    return lines;
}

function shortGraphLabel(label: string): string {
    const parts = label.split(/[./]/).filter(Boolean);
    const last = parts[parts.length - 1] ?? label;
    const short = parts.length > 1 && (/^\d+$/.test(last) || /^view#\d+$/.test(last))
        ? `${parts[parts.length - 2]}.${last}`
        : last;
    return short.length <= 18 ? short : `${short.slice(0, 17)}…`;
}

function createGroupLabel(group: FrameGraphDebugGroup, collapsed: boolean): string {
    const summary = group.summary;
    const gpu = summary.timingEligibleNodeCount === 0
        ? 'no timed passes'
        : `Σ ${(summary.gpuWorkDurationMicros / 1000).toFixed(3)} ms ${summary.timedNodeCount}/${summary.timingEligibleNodeCount}`;
    return `${collapsed ? '▸' : '▾'} ${group.label} · ${summary.retainedNodeCount} retained · ${summary.culledNodeCount} culled · ${gpu}`;
}

function createNodeTitle(
    node: FrameGraphDebugNode,
    segment: FrameGraphDebugViewModel['executionSegments'][number] | undefined,
    snapshot: FrameGraphDebugViewModel,
): string {
    return [
        labelNode(node),
        `kind: ${node.kind}`,
        `group: ${debugGroupPathForId(node.debugGroupId, snapshot)}`,
        `segment: ${segment ? `${segment.index}:${segment.kind}` : '-'}`,
        `gpu: ${node.kind === 'external-submission' ? 'opaque' : `${formatGpuDuration(node)} ms`}`,
        `reads: ${node.reads.map((access) => labelResource(access.resource)).join(', ') || '-'}`,
        `writes: ${node.writes.map((access) => labelResource(access.resource)).join(', ') || '-'}`,
    ].join('\n');
}

function createGroupTitle(group: FrameGraphDebugGroup): string {
    const summary = group.summary;
    return [
        group.path.join(' / '),
        `retained: ${summary.retainedNodeCount}`,
        `culled: ${summary.culledNodeCount}`,
        `inputs: ${summary.inputResources.map(labelResource).join(', ') || '-'}`,
        `outputs: ${summary.outputResources.map(labelResource).join(', ') || '-'}`,
        `transient registered/accessed: ${summary.registeredTransientResourceCount}/${summary.accessedTransientResourceCount}`,
        `physical allocations: ${summary.physicalAllocationCount}`,
        `segments: ${summary.executionSegmentCount}`,
        `opaque: ${summary.externalSubmissionCount}`,
        `Σ GPU work: ${(summary.gpuWorkDurationMicros / 1000).toFixed(3)} ms (${summary.timedNodeCount}/${summary.timingEligibleNodeCount})`,
    ].join('\n');
}

function createResourceTitle(
    resource: FrameGraphDebugResource,
    snapshot: FrameGraphDebugViewModel,
    accesses: readonly FrameGraphDebugAccessEdge[],
): string {
    return [
        labelResource(resource),
        `kind: ${resource.kind}`,
        `origin: ${resource.origin}`,
        `registered in: ${debugGroupPathForId(resource.debugGroupId, snapshot)}`,
        `lifetime: ${resource.lifetime ? `${resource.lifetime.firstUse}-${resource.lifetime.lastUse}` : '-'}`,
        `physical: ${resource.physicalResourceId ?? '-'}`,
        `reads: ${accesses.filter((access) => access.mode === 'read').length}`,
        `writes: ${accesses.filter((access) => access.mode === 'write').length}`,
    ].join('\n');
}

function debugGroupPathForId(groupId: string | undefined, snapshot: FrameGraphDebugViewModel): string {
    if (groupId === undefined) return '-';
    return snapshot.debugGroups.find((group) => group.id === groupId)?.path.join(' / ') ?? `#${groupId}`;
}

function executionSegmentByNodeId(snapshot: FrameGraphDebugViewModel) {
    return new Map(snapshot.executionSegments.flatMap((segment) => segment.nodeIds.map((nodeId) => [nodeId, segment] as const)));
}

function segmentLabel(segment: FrameGraphDebugViewModel['executionSegments'][number] | undefined): string {
    return segment ? `[S${segment.index}]` : '[S-]';
}

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)];
}

function indexByOptionalId<T>(
    values: readonly T[],
    getId: (value: T) => string | undefined,
): ReadonlyMap<string | undefined, readonly T[]> {
    const result = new Map<string | undefined, T[]>();
    for (const value of values) {
        const id = getId(value);
        const indexed = result.get(id) ?? [];
        indexed.push(value);
        result.set(id, indexed);
    }
    return result;
}
