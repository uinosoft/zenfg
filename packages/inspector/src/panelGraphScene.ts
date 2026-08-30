import type {
    FrameGraphDebugAccessEdge,
    FrameGraphDebugEdge,
    FrameGraphDebugGroup,
    FrameGraphDebugNode,
    FrameGraphDebugResource,
    FrameGraphDebugResourceRef,
    FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';
import { formatGpuDuration, labelNode, labelResource } from './panelDomHelpers.ts';
import type { GraphViewMode, Selection } from './panelTypes.ts';

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

export type CulledPassSceneNode = GraphSceneNodeBase & {
    readonly kind: 'culled-pass';
    readonly culledIndex: number;
    readonly nodeId: string;
    readonly passKind: FrameGraphDebugNode['kind'];
    readonly reason: string;
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

export type GraphSceneNode = PassSceneNode | CulledPassSceneNode | GroupSceneNode | ResourceSceneNode;

type GraphSceneEdgeBase = {
    readonly id: GraphSceneElementId;
    readonly from: GraphSceneElementId;
    readonly to: GraphSceneElementId;
    readonly label?: string;
    readonly title: string;
    readonly resourceId: string;
};

export type DependencySceneEdge = GraphSceneEdgeBase & {
    readonly kind: 'dependency';
    readonly dependencyKind: FrameGraphDebugEdge['kind'];
    readonly underlyingDependencies: readonly FrameGraphDebugEdge[];
    readonly underlyingDependencyCount: number;
};

export type AccessSceneEdge = GraphSceneEdgeBase & {
    readonly kind: 'access';
    readonly accessId: string;
    readonly accessMode: FrameGraphDebugAccessEdge['mode'];
    readonly access: FrameGraphDebugAccessEdge['access'];
    readonly dashed: boolean;
};

export type GraphSceneEdge = DependencySceneEdge | AccessSceneEdge;

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
    readonly relatedElementIdsBySelection: ReadonlyMap<string, readonly GraphSceneElementId[]>;
    readonly semanticReferencesByElementId: ReadonlyMap<GraphSceneElementId, GraphSemanticReferences>;
};

export type GraphScene = {
    readonly mode: GraphViewMode;
    readonly nodes: readonly GraphSceneNode[];
    readonly edges: readonly GraphSceneEdge[];
    readonly topologyKey: string;
    readonly contentKey: string;
    readonly interaction: GraphSceneInteractionIndex;
};

export type CreateGraphSceneOptions = {
    readonly mode: GraphViewMode;
    readonly groupsEnabled: boolean;
    readonly expandedGroupPaths: ReadonlySet<string>;
};

type MutableInteractionIndex = {
    readonly selectionByElementId: Map<GraphSceneElementId, Selection>;
    readonly primaryElementIdsBySelection: Map<string, GraphSceneElementId[]>;
    readonly relatedElementIdsBySelection: Map<string, GraphSceneElementId[]>;
    readonly semanticReferencesByElementId: Map<GraphSceneElementId, GraphSemanticReferences>;
};

export function createGraphScene(
    snapshot: FrameGraphDebugViewModel,
    options: CreateGraphSceneOptions,
): GraphScene {
    return options.mode === 'resources'
        ? createResourceGraphScene(snapshot)
        : createPassGraphScene(snapshot, options.groupsEnabled, options.expandedGroupPaths);
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
            return `root:${selection.index}`;
        case 'culled':
            return `culled:${selection.index}`;
        case 'segment':
            return `segment:${selection.index}`;
    }
}

function createPassGraphScene(
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
    const includedGroups = useGroups
        ? snapshot.debugGroups.filter((group) => group.summary.retainedNodeCount > 0 && hasVisibleAncestors(group))
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
        setSelectionElements(interaction, { kind: 'node', id: node.id }, [representative], [representative]);
    }
    if (useGroups) {
        for (const group of snapshot.debugGroups) {
            if (includedGroupIds.has(group.id)) continue;
            const collapsedAncestorId = group.ancestorIds.find((id) => !isExpanded(groupsById.get(id)!));
            if (collapsedAncestorId !== undefined) {
                const representative = graphGroupElementId(groupsById.get(collapsedAncestorId)!.pathKey);
                setSelectionElements(interaction, { kind: 'group', pathKey: group.pathKey }, [representative], [representative]);
            }
        }
    }

    const dependencyEdges = useGroups
        ? createFoldedDependencyEdges(snapshot.edges, representativeByNodeId)
        : snapshot.edges.map((edge, index) => createDependencySceneEdge(
            edge,
            passElementId(edge.fromNodeId),
            passElementId(edge.toNodeId),
            [edge],
            index,
        ));
    for (const edge of dependencyEdges) {
        const selection: Selection = { kind: 'resource', id: edge.resourceId };
        interaction.selectionByElementId.set(edge.id, selection);
        appendSelectionElement(interaction.primaryElementIdsBySelection, selection, edge.id);
        appendSelectionElement(interaction.relatedElementIdsBySelection, selection, edge.id);
        interaction.semanticReferencesByElementId.set(edge.id, {
            nodeIds: unique(edge.underlyingDependencies.flatMap((dependency) => [dependency.fromNodeId, dependency.toNodeId])),
            groupPathKeys: [],
            resourceIds: [edge.resourceId],
            accessIds: [],
            dependencies: edge.underlyingDependencies,
        });
    }

    return finalizeScene('passes', [...groupNodes, ...passNodes], dependencyEdges, interaction);
}

function createResourceGraphScene(snapshot: FrameGraphDebugViewModel): GraphScene {
    const interaction = createMutableInteractionIndex();
    const segmentByNodeId = executionSegmentByNodeId(snapshot);
    const accessesByResourceId = indexAccessesByResourceId(snapshot.accessEdges);
    const passNodes: PassSceneNode[] = snapshot.nodes.map((node) => {
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
        };
        registerElement(
            interaction,
            sceneNode.id,
            { kind: 'node', id: node.id },
            emptyReferences({ nodeIds: [node.id] }),
        );
        return sceneNode;
    });
    const culledNodes: CulledPassSceneNode[] = snapshot.culledNodes.map((culled, index) => {
        const sceneNode: CulledPassSceneNode = {
            id: culledPassElementId(index, culled.node.id),
            kind: 'culled-pass',
            culledIndex: index,
            nodeId: culled.node.id,
            passKind: culled.node.kind,
            reason: culled.reason,
            label: `${formatGraphNodeLabel(labelNode(culled.node))}\n(culled)`,
            overviewLabel: `${shortGraphLabel(labelNode(culled.node))} (culled)`,
            title: createCulledNodeTitle(culled),
        };
        registerElement(
            interaction,
            sceneNode.id,
            { kind: 'culled', index },
            emptyReferences({ nodeIds: [culled.node.id] }),
        );
        return sceneNode;
    });
    const resourceNodes: ResourceSceneNode[] = snapshot.resources.map((resource) => {
        const sceneNode: ResourceSceneNode = {
            id: resourceElementId(resource.id),
            kind: 'resource',
            resourceId: resource.id,
            resourceKind: resource.kind,
            label: formatGraphResourceLabel(labelResource(resource)),
            overviewLabel: shortGraphLabel(labelResource(resource)),
            title: createResourceTitle(resource, snapshot, accessesByResourceId.get(resource.id) ?? []),
        };
        registerElement(
            interaction,
            sceneNode.id,
            { kind: 'resource', id: resource.id },
            emptyReferences({ resourceIds: [resource.id] }),
        );
        return sceneNode;
    });
    const culledNodeIds = new Map(snapshot.culledNodes.map((culled, index) => [
        culled.node.id,
        culledPassElementId(index, culled.node.id),
    ]));
    const accessEdges: AccessSceneEdge[] = snapshot.accessEdges.map((access) => {
        const passId = culledNodeIds.get(access.nodeId) ?? passElementId(access.nodeId);
        const resourceId = resourceElementId(access.resource.id);
        const edge: AccessSceneEdge = {
            id: accessElementId(access.accessId, access.resource.id),
            kind: 'access',
            from: access.mode === 'write' ? passId : resourceId,
            to: access.mode === 'write' ? resourceId : passId,
            label: access.access,
            title: createAccessTitle(access),
            resourceId: access.resource.id,
            accessId: access.accessId,
            accessMode: access.mode,
            access: access.access,
            dashed: culledNodeIds.has(access.nodeId),
        };
        const selection: Selection = { kind: 'resource', id: access.resource.id };
        interaction.selectionByElementId.set(edge.id, selection);
        appendSelectionElement(interaction.relatedElementIdsBySelection, selection, edge.id);
        interaction.semanticReferencesByElementId.set(edge.id, {
            nodeIds: [access.nodeId],
            groupPathKeys: [],
            resourceIds: [access.resource.id],
            accessIds: [access.accessId],
            dependencies: [],
        });
        return edge;
    });

    return finalizeScene('resources', [...passNodes, ...culledNodes, ...resourceNodes], accessEdges, interaction);
}

export function indexAccessesByResourceId(
    accesses: readonly FrameGraphDebugAccessEdge[],
): ReadonlyMap<string, readonly FrameGraphDebugAccessEdge[]> {
    const result = new Map<string, FrameGraphDebugAccessEdge[]>();
    for (const access of accesses) {
        const resourceAccesses = result.get(access.resource.id);
        if (resourceAccesses) {
            resourceAccesses.push(access);
        } else {
            result.set(access.resource.id, [access]);
        }
    }
    return result;
}

function createFoldedDependencyEdges(
    dependencies: readonly FrameGraphDebugEdge[],
    representativeByNodeId: ReadonlyMap<string, GraphSceneElementId>,
): DependencySceneEdge[] {
    const dependenciesByKey = new Map<string, {
        readonly from: GraphSceneElementId;
        readonly to: GraphSceneElementId;
        readonly resource: FrameGraphDebugResourceRef;
        readonly dependencies: FrameGraphDebugEdge[];
    }>();
    for (const dependency of dependencies) {
        const from = representativeByNodeId.get(dependency.fromNodeId)!;
        const to = representativeByNodeId.get(dependency.toNodeId)!;
        if (from === to) continue;
        const key = JSON.stringify([from, to, dependency.resource.id]);
        const existing = dependenciesByKey.get(key);
        if (existing) {
            existing.dependencies.push(dependency);
        } else {
            dependenciesByKey.set(key, { from, to, resource: dependency.resource, dependencies: [dependency] });
        }
    }
    return [...dependenciesByKey.values()].map((entry, index) => createDependencySceneEdge(
        entry.dependencies.find((dependency) => dependency.kind === 'value') ?? entry.dependencies[0]!,
        entry.from,
        entry.to,
        entry.dependencies,
        index,
    ));
}

function createDependencySceneEdge(
    dependency: FrameGraphDebugEdge,
    from: GraphSceneElementId,
    to: GraphSceneElementId,
    underlyingDependencies: readonly FrameGraphDebugEdge[],
    occurrence: number,
): DependencySceneEdge {
    const dependencyKind = underlyingDependencies.some((edge) => edge.kind === 'value') ? 'value' : 'ordering';
    return {
        id: `dependency:${JSON.stringify([from, to, dependency.resource.id, occurrence])}`,
        kind: 'dependency',
        from,
        to,
        title: `${labelResource(dependency.resource)}${underlyingDependencies.length > 1
            ? `\n${underlyingDependencies.length} folded dependencies`
            : ''}`,
        resourceId: dependency.resource.id,
        dependencyKind,
        underlyingDependencies,
        underlyingDependencyCount: underlyingDependencies.length,
    };
}

function finalizeScene(
    mode: GraphViewMode,
    nodes: readonly GraphSceneNode[],
    edges: readonly GraphSceneEdge[],
    interaction: MutableInteractionIndex,
): GraphScene {
    const topologyKey = JSON.stringify({
        mode,
        nodes: nodes.map((node) => [node.id, node.kind, node.parentId, node.kind === 'group' ? node.collapsed : undefined]),
        edges: edges.map((edge) => [edge.id, edge.kind, edge.from, edge.to]),
    });
    const contentKey = JSON.stringify({
        mode,
        nodes: nodes.map((node) => [
            node.id,
            node.kind,
            node.parentId,
            node.label,
            node.overviewLabel,
            node.title,
            node.kind === 'pass' || node.kind === 'culled-pass' ? node.passKind : undefined,
            node.kind === 'resource' ? node.resourceKind : undefined,
            node.kind === 'group' ? node.collapsed : undefined,
            node.kind === 'group' ? node.depthBand : undefined,
            node.kind === 'group' ? node.culledNodeCount > 0 : undefined,
        ]),
        edges: edges.map((edge) => [
            edge.id,
            edge.kind,
            edge.from,
            edge.to,
            edge.label,
            edge.title,
            edge.kind === 'dependency' ? edge.dependencyKind : undefined,
            edge.kind === 'access' ? edge.accessMode : undefined,
            edge.kind === 'access' ? edge.dashed : undefined,
        ]),
    });
    return {
        mode,
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
        relatedElementIdsBySelection: new Map(),
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
    setSelectionElements(interaction, selection, [elementId], [elementId]);
    interaction.semanticReferencesByElementId.set(elementId, references);
}

function setSelectionElements(
    interaction: MutableInteractionIndex,
    selection: Selection,
    primary: readonly GraphSceneElementId[],
    related: readonly GraphSceneElementId[],
): void {
    interaction.primaryElementIdsBySelection.set(selectionKey(selection), [...primary]);
    interaction.relatedElementIdsBySelection.set(selectionKey(selection), [...related]);
}

function appendSelectionElement(
    map: Map<string, GraphSceneElementId[]>,
    selection: Selection,
    elementId: GraphSceneElementId,
): void {
    const key = selectionKey(selection);
    const elementIds = map.get(key) ?? [];
    if (!elementIds.includes(elementId)) elementIds.push(elementId);
    map.set(key, elementIds);
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

function culledPassElementId(index: number, nodeId: string): GraphSceneElementId {
    return `culled-pass:${index}:${nodeId}`;
}

function resourceElementId(resourceId: string): GraphSceneElementId {
    return `resource:${resourceId}`;
}

function accessElementId(accessId: string, resourceId: string): GraphSceneElementId {
    return `access:${accessId}:${resourceId}`;
}

function formatGraphNodeLabel(label: string): string {
    return formatGraphLabel(label, 20, 3);
}

function formatGraphResourceLabel(label: string): string {
    return formatGraphLabel(label, 18, 3);
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

function createCulledNodeTitle(culled: FrameGraphDebugViewModel['culledNodes'][number]): string {
    return [
        `${labelNode(culled.node)} (culled)`,
        `kind: ${culled.node.kind}`,
        `reason: ${culled.reason}`,
        `reads: ${culled.node.reads.map((access) => labelResource(access.resource)).join(', ') || '-'}`,
        `writes: ${culled.node.writes.map((access) => labelResource(access.resource)).join(', ') || '-'}`,
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

function createAccessTitle(access: FrameGraphDebugAccessEdge): string {
    return [
        `#${access.accessId} ${access.mode}`,
        labelResource(access.resource),
        `access: ${access.access}`,
        access.mode === 'write' ? `contents: ${access.contents}` : undefined,
        access.mode === 'write' ? `result: ${access.producesValue ? 'produced' : 'discarded'}` : undefined,
        access.textureViewId === undefined ? undefined : `texture view: #${access.textureViewId}`,
        access.textureRegion ? `texture: mip ${access.textureRegion.baseMipLevel}+${access.textureRegion.mipLevelCount}, layer ${access.textureRegion.baseArrayLayer ?? 0}+${access.textureRegion.arrayLayerCount ?? 1}, depth ${access.textureRegion.baseDepthSlice ?? 0}+${access.textureRegion.depthSliceCount ?? 1}, ${access.textureRegion.aspect}` : undefined,
        access.bufferRange ? `buffer: ${access.bufferRange.offset}+${access.bufferRange.size ?? 'end'}` : undefined,
    ].filter(Boolean).join('\n');
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
