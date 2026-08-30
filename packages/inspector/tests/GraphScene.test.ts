import assert from 'node:assert/strict';
import test from 'node:test';

import { BufferAccess, TextureAccess } from './accessKinds.ts';
import { createLegacyDebugViewModel, type LegacyFrameGraphCapture } from './legacySnapshotFixture.ts';
import {
    createGraphScene,
    graphGroupElementId,
    indexAccessesByResourceId,
    selectionKey,
    type AccessSceneEdge,
    type DependencySceneEdge,
    type GroupSceneNode,
} from '../src/panelGraphScene.ts';

test('creates the exact retained pass DAG when diagnostic groups are disabled', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const scene = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: false,
        expandedGroupPaths: new Set(),
    });

    assert.deepEqual(scene.nodes.map((node) => node.id), ['pass:node:1', 'pass:node:2', 'pass:node:3']);
    assert.deepEqual(scene.edges.map((edge) => [edge.from, edge.to]), [
        ['pass:node:1', 'pass:node:2'],
        ['pass:node:2', 'pass:node:3'],
    ]);
    assert.equal(scene.nodes.some((node) => node.kind === 'group'), false);
});

test('projects collapsed groups while keeping compound hierarchy in the scene', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const outer = snapshot.debugGroups[0]!;
    const bloom = snapshot.debugGroups[1]!;
    const collapsed = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set(),
    });
    const outerId = graphGroupElementId(outer.pathKey);

    assert.deepEqual(collapsed.nodes.map((node) => node.id), [outerId, 'pass:node:1', 'pass:node:3']);
    assert.equal(collapsed.nodes.some((node) => node.kind === 'group' && node.groupPathKey === snapshot.debugGroups[2]!.pathKey), false);
    assert.deepEqual(collapsed.edges.map((edge) => [edge.from, edge.to, edge.resourceId]), [
        ['pass:node:1', outerId, 'resource:1'],
        [outerId, 'pass:node:3', 'resource:2'],
    ]);
    assert.deepEqual(
        collapsed.interaction.primaryElementIdsBySelection.get(selectionKey({ kind: 'node', id: 'node:2' })),
        [outerId],
    );
    assert.deepEqual(
        collapsed.interaction.primaryElementIdsBySelection.get(selectionKey({ kind: 'group', pathKey: bloom.pathKey })),
        [outerId],
    );

    const rootExpanded = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set([outer.pathKey]),
    });
    const outerNode = rootExpanded.nodes.find((node): node is GroupSceneNode => node.kind === 'group' && node.groupId === outer.id)!;
    const bloomNode = rootExpanded.nodes.find((node): node is GroupSceneNode => node.kind === 'group' && node.groupId === bloom.id)!;
    assert.equal(outerNode.collapsed, false);
    assert.equal(outerNode.label.includes('\n'), false);
    assert.match(outerNode.label, /1 retained · 1 culled/);
    assert.equal(bloomNode.collapsed, true);
    assert.equal(bloomNode.label.includes('\n'), false);
    assert.match(bloomNode.label, /1 retained · 0 culled/);
    assert.equal(bloomNode.parentId, outerNode.id);
    assert.notEqual(bloomNode.depthBand, outerNode.depthBand);
    assert.deepEqual(outerNode.childNodeIds, [bloomNode.id]);

    const fullyExpanded = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set([outer.pathKey, bloom.pathKey]),
    });
    assert.equal(fullyExpanded.nodes.filter((node) => node.kind === 'group').length, 2);
    assert.equal(fullyExpanded.nodes.find((node) => node.id === 'pass:node:2')?.parentId, graphGroupElementId(bloom.pathKey));
    assert.deepEqual(fullyExpanded.edges.map((edge) => [edge.from, edge.to]), [
        ['pass:node:1', 'pass:node:2'],
        ['pass:node:2', 'pass:node:3'],
    ]);
    assert.deepEqual(
        fullyExpanded.interaction.primaryElementIdsBySelection.get(selectionKey({ kind: 'group', pathKey: outer.pathKey })),
        [graphGroupElementId(outer.pathKey)],
    );
});

test('folds representative dependencies per resource and gives value dependencies priority', () => {
    const capture = createGroupedCapture();
    const snapshot = createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            dependencies: [
                ...capture.compilation.dependencies,
                { fromNodeId: 1, toNodeId: 2, resourceId: 1, kind: 'ordering' },
            ],
        },
    });
    const scene = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set(),
    });
    const edge = scene.edges.find((candidate): candidate is DependencySceneEdge => (
        candidate.kind === 'dependency' && candidate.resourceId === 'resource:1'
    ))!;
    assert.equal(edge.dependencyKind, 'value');
    assert.equal(edge.underlyingDependencyCount, 2);
    assert.equal(scene.interaction.semanticReferencesByElementId.get(edge.id)?.dependencies.length, 2);
});

test('eliminates dependencies internal to one collapsed representative', () => {
    const capture = createGroupedCapture();
    const snapshot = createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            nodes: [
				...capture.compilation.nodes.slice(0, 2),
                { id: 5, kind: 'compute', label: 'bloom-finish', sideEffect: false, debugGroupId: 2 },
				...capture.compilation.nodes.slice(2),
            ],
            dependencies: [
                ...capture.compilation.dependencies,
                { fromNodeId: 2, toNodeId: 5, resourceId: 2, kind: 'ordering' },
            ],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2, 5, 3] }],
        },
    });
    const scene = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: true, expandedGroupPaths: new Set(),
    });

    assert.equal(scene.edges.some((edge) => edge.from === edge.to), false);
    assert.equal(scene.edges.some((edge) => edge.kind === 'dependency'
        && edge.underlyingDependencies.some((dependency) => dependency.toNodeId === 'node:5')), false);
    assert.deepEqual(scene.edges.map((edge) => [edge.from, edge.to]), [
        ['pass:node:1', graphGroupElementId(snapshot.debugGroups[0]!.pathKey)],
        [graphGroupElementId(snapshot.debugGroups[0]!.pathKey), 'pass:node:3'],
    ]);
});

test('keeps duplicate sibling groups independently expandable', () => {
    const capture = createGroupedCapture();
    const snapshot = createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            debugGroups: [...capture.compilation.debugGroups!, { id: 4, parentId: 1, label: ' Bloom ' }],
            nodes: [
				...capture.compilation.nodes.slice(0, 2),
                { id: 5, kind: 'compute', label: 'second-bloom', sideEffect: false, debugGroupId: 4 },
				...capture.compilation.nodes.slice(2),
            ],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2, 5, 3] }],
        },
    });
    const [outer, firstBloom, , secondBloom] = snapshot.debugGroups;
    assert.notEqual(firstBloom!.pathKey, secondBloom!.pathKey);

    const scene = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set([outer!.pathKey, firstBloom!.pathKey]),
    });
    assert.ok(scene.nodes.some((node) => node.id === 'pass:node:2'));
    assert.equal(scene.nodes.some((node) => node.id === 'pass:node:5'), false);
    assert.ok(scene.nodes.some((node) => node.kind === 'group' && node.groupId === secondBloom!.id));
});

test('creates a renderer-independent resource access scene including culled passes', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const accessesByResourceId = indexAccessesByResourceId(snapshot.accessEdges);
    assert.deepEqual(accessesByResourceId.get('resource:1')?.map((access) => access.accessId), ['access:1', 'access:2']);
    assert.deepEqual(accessesByResourceId.get('resource:2')?.map((access) => access.accessId), ['access:3', 'access:4']);
    assert.deepEqual(accessesByResourceId.get('resource:3')?.map((access) => access.accessId), ['access:5']);
    const scene = createGraphScene(snapshot, {
        mode: 'resources',
        groupsEnabled: true,
        expandedGroupPaths: new Set(),
    });

    assert.ok(scene.nodes.some((node) => node.kind === 'culled-pass' && node.nodeId === 'node:4'));
    assert.ok(scene.nodes.some((node) => node.kind === 'resource' && node.resourceId === 'resource:3'));
    const culledAccess = scene.edges.find((edge): edge is AccessSceneEdge => edge.kind === 'access' && edge.accessId === 'access:5');
    assert.equal(culledAccess?.from, 'culled-pass:0:node:4');
    assert.equal(culledAccess?.to, 'resource:resource:3');
    assert.equal(culledAccess?.dashed, true);
    assert.match(culledAccess?.title ?? '', /buffer: 16\+32/);
    const readAccess = scene.edges.find((edge): edge is AccessSceneEdge => edge.kind === 'access' && edge.accessId === 'access:2')!;
    assert.equal(readAccess.from, 'resource:resource:1');
    assert.equal(readAccess.to, 'pass:node:2');
    assert.match(readAccess.title, /texture: mip 1\+1/);
    assert.deepEqual(scene.interaction.semanticReferencesByElementId.get(readAccess.id)?.accessIds, ['access:2']);
    const resourceKey = selectionKey({ kind: 'resource', id: 'resource:1' });
    assert.deepEqual(scene.interaction.primaryElementIdsBySelection.get(resourceKey), ['resource:resource:1']);
    assert.deepEqual(scene.interaction.relatedElementIdsBySelection.get(resourceKey), [
        'resource:resource:1',
        'access:access:1:resource:1',
        'access:access:2:resource:1',
    ]);
    assert.equal(scene.interaction.selectionByElementId.get('access:access:2:resource:1')?.kind, 'resource');
});

test('changes content keys for tooltip-only metadata without changing topology keys', () => {
    const capture = createGroupedCapture();
    const first = createGraphScene(createLegacyDebugViewModel(capture), {
        mode: 'resources', groupsEnabled: true, expandedGroupPaths: new Set(),
    });
    const changed = createGraphScene(createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            resources: capture.compilation.resources.map((resource) => resource.id === 2
				? { ...resource, lifetime: { firstUse: 1, lastUse: 2 } }
                : resource),
        },
    }), {
        mode: 'resources', groupsEnabled: true, expandedGroupPaths: new Set(),
    });
    assert.equal(first.topologyKey, changed.topologyKey);
    assert.notEqual(first.contentKey, changed.contentKey);
});

function createGroupedCapture(): LegacyFrameGraphCapture {
    return {
        compilation: {
            debugGroups: [
                { id: 1, label: 'PostFX' },
                { id: 2, parentId: 1, label: 'Bloom' },
                { id: 3, parentId: 1, label: 'Culled Only' },
            ],
            nodes: [
                { id: 1, kind: 'render', label: 'scene', sideEffect: false },
                { id: 2, kind: 'render', label: 'bloom', sideEffect: false, debugGroupId: 2 },
                { id: 3, kind: 'render', label: 'present', sideEffect: true },
            ],
            culledNodes: [
                { id: 4, kind: 'compute', label: 'unused', sideEffect: false, debugGroupId: 3, reason: 'not-reachable-from-root' },
            ],
            resources: [
                { id: 1, kind: 'texture', label: 'scene-color', origin: 'imported', usage: 0x14 },
                { id: 2, kind: 'texture', label: 'postfx-color', origin: 'transient', usage: 0x14, debugGroupId: 2, physicalAllocationId: 1 },
                { id: 3, kind: 'buffer', label: 'unused-buffer', origin: 'transient', usage: 0x80, debugGroupId: 3 },
            ],
            accesses: [
                {
                    id: 1,
                    nodeId: 1,
                    resourceId: 1,
                    access: TextureAccess.ColorAttachmentWrite,
                    mode: 'write',
                    contents: 'overwrite',
                    producesValue: true,
                    order: 0,
                    textureRegion: { baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, aspect: 'all' },
                },
                {
                    id: 2,
                    nodeId: 2,
                    resourceId: 1,
                    access: TextureAccess.Sampled,
                    mode: 'read',
                    producesValue: false,
                    order: 1,
                    textureRegion: { baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, aspect: 'all' },
                },
                { id: 3, nodeId: 2, resourceId: 2, access: TextureAccess.ColorAttachmentWrite, mode: 'write', contents: 'overwrite', producesValue: true, order: 1 },
                { id: 4, nodeId: 3, resourceId: 2, access: TextureAccess.Sampled, mode: 'read', producesValue: false, order: 2 },
                {
                    id: 5,
                    nodeId: 4,
                    resourceId: 3,
                    access: BufferAccess.StorageWrite,
                    mode: 'write',
                    contents: 'overwrite',
                    producesValue: true,
                    bufferRange: { offset: 16, size: 32 },
                },
            ],
            dependencies: [
                { fromNodeId: 1, toNodeId: 2, resourceId: 1, kind: 'value' },
                { fromNodeId: 2, toNodeId: 3, resourceId: 2, kind: 'value' },
            ],
            roots: [{ reason: 'side-effect', nodeId: 3 }],
            allocations: [{ id: 1, kind: 'texture', compatibilityClassId: 1 }],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2, 3] }],
        },
        gpuTiming: {
            status: 'available',
            frameIndex: 2,
            frameDurationMicros: 55,
            nodes: [
                { nodeId: 1, kind: 'render', durationMicros: 20 },
                { nodeId: 2, kind: 'render', durationMicros: 25 },
                { nodeId: 3, kind: 'render', durationMicros: 10 },
            ],
        },
        resourcePool: {
            acquireCount: 1,
            reuseCount: 0,
            createdCount: 1,
            retainedCount: 1,
            estimatedRetainedBytes: 64,
        },
    };
}
