import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeDimensions } from '../src/panelGraphVisuals.ts';
import { createDebugViewModel, rootKey } from '../src/debugCaptureModel.ts';
import type { FrameGraphSnapshotGpuTimings, FrameGraphSnapshotNodeKind } from '@zenfg/snapshot';
import { resolveSelectedDetail, selectionExists } from '../src/panelSelection.ts';

import { BufferAccess, TextureAccess } from './accessKinds.ts';
import { createLegacyDebugViewModel, type LegacyFrameGraphCapture } from './legacySnapshotFixture.ts';
import {
    createGraphScene,
    graphGroupElementId,
    selectionKey,
    type GraphSceneEdge,
    type GroupSceneNode,
} from '../src/panelGraphScene.ts';

test('resource labels prioritize roles, wrap names and show ranges only for ambiguous root families', () => {
    const base = createLegacyDebugViewModel(createGroupedCapture());
    const longName = 'Very.long.resource.name.that.must.be.truncated';
    const resource = { ...base.resources[0]!, label: longName };
    const roots = [0, 1].map((mip) => ({ key: `mip-${mip}`, reason: 'output' as const, resourceId: resource.id, resource,
        range: { kind: 'texture' as const, regions: [{ baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, aspect: 'all' }] },
        resolution: { producerNodeIds: ['node:1'], usesInitialContents: false },
    }));
    for (const expandedGroupPaths of [new Set<string>(), new Set(base.debugGroups.map((group) => group.pathKey))]) {
        const snapshot = { ...base, resources: [resource, ...base.resources.slice(1)], resourceById: new Map(base.resourceById).set(resource.id, resource), roots };
        const scene = createGraphScene(snapshot, { groupsEnabled: true, expandedGroupPaths });
        const entrance = scene.nodes.find((node) => node.kind === 'resource' && node.resourceId === resource.id)!;
        assert.equal(entrance.label, 'Imported · Texture\nVery.long.\nresource.name.tha…');
        assert.ok(entrance.title.includes(longName));
        const outputs = scene.nodes.filter((node) => node.kind === 'root');
        assert.equal(outputs.length, 2);
        assert.notEqual(outputs[0]!.label, outputs[1]!.label);
        assert.ok(outputs.every((node) => node.label.startsWith('Output\n') && node.label.split('\n').length === 4));
        assert.ok(outputs.every((node) => node.overviewLabel.split('\n').length === 2));
        const single = createGraphScene({ ...snapshot, roots: roots.slice(0, 1) }, { groupsEnabled: true, expandedGroupPaths });
        assert.equal(single.nodes.find((node) => node.kind === 'root')!.label.split('\n').length, 3);
        const legacy = createGraphScene({ ...snapshot, roots: [{ ...roots[0]!, range: undefined, resolution: undefined }] }, { groupsEnabled: false, expandedGroupPaths });
        assert.match(legacy.nodes.find((node) => node.kind === 'root')!.title, /Range unavailable/);
        const wide = { ...resource, label: '资源名称非常长而且不能自动换行😀' };
        const wideScene = createGraphScene({ ...snapshot, resources: [wide, ...base.resources.slice(1)] },
            { groupsEnabled: false, expandedGroupPaths });
        const wideEntrance = wideScene.nodes.find((node) => node.kind === 'resource' && node.resourceId === resource.id)!;
        assert.equal(wideEntrance.label.split('\n').length, 3);
        assert.ok([...wideEntrance.label.split('\n')[1]!].length <= 9);
    }
});

test('resource names use a second line only when needed and grow node height', () => {
    const base = createLegacyDebugViewModel(createGroupedCapture());
    for (const [name, formatted] of [
        ['surface', 'surface'],
        ['monocular.stable-range', 'monocular.\nstable-range'],
        ['model/depth/history', 'model/depth/\nhistory'],
        ['abcdefghijklmnopqrstuvwxyz0123456789EXTRA', 'abcdefghijklmnopqr\nstuvwxyz012345678…'],
    ]) {
        const resource = { ...base.resources[0]!, label: name! };
        const scene = createGraphScene({ ...base,
            resources: [resource, ...base.resources.slice(1)],
            resourceById: new Map(base.resourceById).set(resource.id, resource),
            roots: [{ key: 'name', reason: 'persistent-state', resourceId: resource.id, resource }],
        }, { groupsEnabled: false, expandedGroupPaths: new Set() });
        const entrance = scene.nodes.find(node => node.kind === 'resource' && node.resourceId === resource.id)!;
        const output = scene.nodes.find(node => node.kind === 'root')!;
        assert.equal(entrance.label, 'Imported · Texture\n' + formatted);
        assert.equal(output.label, 'Persistent State\n' + formatted);
        assert.equal(nodeDimensions(entrance).height, name === 'surface' ? 58 : 75);
        assert.equal(nodeDimensions(output).height, nodeDimensions(entrance).height);
        assert.equal(entrance.overviewLabel.split('\n').length, 2);
        assert.equal(output.overviewLabel.split('\n').length, 2);
        assert.ok(output.title.includes(name!));
    }
});

test('creates the exact retained pass DAG when diagnostic groups are disabled', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const scene = createGraphScene(snapshot, {

        groupsEnabled: false,
        expandedGroupPaths: new Set(),
    });

    assert.deepEqual(scene.nodes.filter((node) => node.kind === 'pass' || node.kind === 'group').map((node) => node.id), ['pass:node:1', 'pass:node:2', 'pass:node:3']);
    assert.deepEqual(scene.edges.filter((edge) => edge.underlyingDependencyCount > 0).map((edge) => [edge.from, edge.to]), [
        ['pass:node:1', 'pass:node:2'],
        ['pass:node:2', 'pass:node:3'],
    ]);
    assert.equal(scene.nodes.some((node) => node.kind === 'group'), false);
});

test('all resource origins and output reasons use role-first two-line labels', () => {
    const base = createLegacyDebugViewModel(createGroupedCapture());
    for (const [origin, label] of [['transient', 'Created'], ['imported', 'Imported'], ['surface', 'Surface']] as const) {
        for (const kind of ['buffer', 'texture'] as const) {
            const resource = { ...base.resources[0]!, origin, kind };
            const roots = (['output', 'present', 'readback', 'debug-capture', 'persistent-state'] as const).map((reason) => ({
                key: reason, reason, resourceId: resource.id, resource,
            }));
            const scene = createGraphScene({ ...base, resources: [resource, ...base.resources.slice(1)], resourceById: new Map(base.resourceById).set(resource.id, resource), roots },
                { groupsEnabled: false, expandedGroupPaths: new Set() });
            const entrance = scene.nodes.find((node) => node.kind === 'resource')!;
            assert.equal(entrance.label.split('\n')[0], `${label} · ${kind === 'buffer' ? 'Buffer' : 'Texture'}`);
            assert.equal(entrance.overviewLabel.split('\n')[0], label);
            assert.deepEqual(scene.nodes.filter((node) => node.kind === 'root').map((node) => node.label.split('\n')[0]),
                ['Output', 'Present', 'Readback', 'Debug Capture', 'Persistent State']);
            assert.ok(scene.nodes.filter((node) => node.kind === 'root').every((node) => node.label.split('\n').length === 2));
        }
    }
});

test('projects collapsed groups while keeping compound hierarchy in the scene', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const outer = snapshot.debugGroups[0]!;
    const bloom = snapshot.debugGroups[1]!;
    const collapsed = createGraphScene(snapshot, {

        groupsEnabled: true,
        expandedGroupPaths: new Set(),
    });
    const outerId = graphGroupElementId(outer.pathKey);

    assert.deepEqual(collapsed.nodes.filter((node) => node.kind === 'pass' || node.kind === 'group').map((node) => node.id), [outerId, 'pass:node:1', 'pass:node:3']);
    assert.equal(collapsed.nodes.some((node) => node.kind === 'group' && node.groupPathKey === snapshot.debugGroups[2]!.pathKey), false);
    assert.deepEqual(collapsed.edges.filter((edge) => edge.underlyingDependencyCount > 0).map((edge) => [edge.from, edge.to, edge.resourceId]), [
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

        groupsEnabled: true,
        expandedGroupPaths: new Set([outer.pathKey, bloom.pathKey]),
    });
    assert.equal(fullyExpanded.nodes.filter((node) => node.kind === 'group').length, 2);
    assert.equal(fullyExpanded.nodes.find((node) => node.id === 'pass:node:2')?.parentId, graphGroupElementId(bloom.pathKey));
    assert.deepEqual(fullyExpanded.edges.filter((edge) => edge.underlyingDependencyCount > 0).map((edge) => [edge.from, edge.to]), [
        ['pass:node:1', 'pass:node:2'],
        ['pass:node:2', 'pass:node:3'],
    ]);
    assert.deepEqual(
        fullyExpanded.interaction.primaryElementIdsBySelection.get(selectionKey({ kind: 'group', pathKey: outer.pathKey })),
        [graphGroupElementId(outer.pathKey)],
    );
});

test('group graph labels and tooltips distinguish uncollected, partial, complete, and real zero GPU work', () => {
    const source = createLegacyDebugViewModel(createGroupedCapture()).protocol;
    const graph = { ...source.graph, nodes: source.graph.nodes.map((node) => ({ ...node, groupId: 'group:1' })) };
    const cases: readonly { timings: FrameGraphSnapshotGpuTimings; expected: string }[] = [
        { timings: { status: 'unavailable', reason: 'not collected' }, expected: 'Not collected' },
        { timings: { status: 'available', frameSpanMicros: 0, nodes: [] }, expected: 'Not collected' },
        { timings: { status: 'available', frameSpanMicros: 0, nodes: [{ nodeId: 'node:1', durationMicros: 0 }] }, expected: '0.000 ms · Partial · 1/3 timed' },
        { timings: { status: 'available', frameSpanMicros: 1000, nodes: [{ nodeId: 'node:1', durationMicros: 1000 }] }, expected: '1.000 ms · Partial · 1/3 timed' },
        { timings: { status: 'available', frameSpanMicros: 0, nodes: [1, 2, 3].map((id) => ({ nodeId: `node:${id}`, durationMicros: 0 })) }, expected: '0.000 ms · Complete · 3/3 timed' },
        { timings: { status: 'available', frameSpanMicros: 6000, nodes: [1, 2, 3].map((id) => ({ nodeId: `node:${id}`, durationMicros: id * 1000 })) }, expected: '6.000 ms · Complete · 3/3 timed' },
    ];
    for (const { timings, expected } of cases) {
        const snapshot = createDebugViewModel({ ...source, graph, timings: { gpu: timings } });
        for (const expanded of [false, true]) {
            const scene = createGraphScene(snapshot, { groupsEnabled: true,
                expandedGroupPaths: new Set(expanded ? snapshot.debugGroups.map((group) => group.pathKey) : []),
            });
            const group = scene.nodes.find((node) => node.kind === 'group' && node.groupId === 'group:1')!;
            assert.ok(group.label.endsWith(`Measured pass sum: ${expected}`), group.label);
            assert.ok(group.title.endsWith(`Measured pass sum: ${expected}`), group.title);
            assert.doesNotMatch(group.title, /Σ GPU work/);
            if (expected === 'Not collected') assert.doesNotMatch(group.label + group.title, /0\.000 ms/);
        }
    }
    const noEligible = createDebugViewModel({ ...source, graph: { ...graph,
        nodes: graph.nodes.map((node) => ({ ...node, kind: 'copy' })),
    }, timings: { gpu: { status: 'unavailable', reason: 'not applicable' } } });
    const group = createGraphScene(noEligible, { groupsEnabled: true, expandedGroupPaths: new Set() })
        .nodes.find((node) => node.kind === 'group' && node.groupId === 'group:1')!;
    assert.ok(group.label.endsWith('Measured pass sum: Not applicable'));
    assert.ok(group.title.endsWith('Measured pass sum: Not applicable'));
    assert.doesNotMatch(group.label + group.title, /0\.000 ms|Not collected/);
});

test('group graph tooltips distinguish missing allocation reports from a valid empty report', () => {
    const source = createLegacyDebugViewModel(createGroupedCapture()).protocol;
    const graph = { ...source.graph, resources: source.graph.resources.map(({ allocationId: _allocationId, ...resource }) => resource) };
    for (const available of [false, true]) {
        const snapshot = createDebugViewModel({ ...source, graph, memory: { ...source.memory,
            allocationReport: available ? { status: 'available', allocations: [] } : { status: 'unavailable', reason: 'not captured' },
        } });
        const group = createGraphScene(snapshot, { groupsEnabled: true, expandedGroupPaths: new Set() })
            .nodes.find((node) => node.kind === 'group')!;
        const allocationLine = group.title.split('\n').find((line) => line.startsWith('physical allocations:'));
        assert.equal(allocationLine, `physical allocations: ${available ? '0' : 'Not collected'}`);
    }
});

test('pass graph tooltips distinguish GPU eligibility, opaque work, missing measurements, and zero duration', () => {
    const source = createLegacyDebugViewModel(createGroupedCapture()).protocol;
    const cases: readonly [FrameGraphSnapshotNodeKind, number | undefined, string][] = [
        ['render', undefined, 'Not collected'], ['compute', undefined, 'Not collected'],
        ['render', 0, '0.000 ms'], ['compute', 250, '0.250 ms'],
        ['copy', undefined, 'Not applicable'], ['clear-buffer', undefined, 'Not applicable'],
        ['command', undefined, 'Not applicable'], ['external-submission', undefined, 'Opaque'],
    ];
    for (const [kind, duration, expected] of cases) {
        const nodes = source.graph.nodes.map((node) => node.id === 'node:1' ? { ...node, kind } : node);
        const snapshot = createDebugViewModel({ ...source, graph: { ...source.graph, nodes },
            timings: { gpu: duration === undefined ? { status: 'unavailable', reason: 'not captured' }
                : { status: 'available', frameSpanMicros: duration, nodes: [{ nodeId: 'node:1', durationMicros: duration }] } },
        });
        const node = createGraphScene(snapshot, { groupsEnabled: false, expandedGroupPaths: new Set() })
            .nodes.find((node) => node.kind === 'pass' && node.nodeId === 'node:1')!;
        const gpu = node.title.split('\n').find((line) => line.startsWith('gpu:'));
        assert.equal(gpu, `gpu: ${expected}`, kind);
        assert.doesNotMatch(node.title, /gpu: - ms/);
    }
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

        groupsEnabled: true,
        expandedGroupPaths: new Set(),
    });
    const edge = scene.edges.find((candidate): candidate is GraphSceneEdge => (
        candidate.underlyingDependencyCount > 0 && candidate.resourceId === 'resource:1'
    ))!;
    assert.equal(edge.kind, 'flow');
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
         groupsEnabled: true, expandedGroupPaths: new Set(),
    });

    assert.equal(scene.edges.some((edge) => edge.from === edge.to), false);
    assert.equal(scene.edges.some((edge) => edge.underlyingDependencyCount > 0
        && edge.underlyingDependencies.some((dependency) => dependency.toNodeId === 'node:5')), false);
    assert.deepEqual(scene.edges.filter((edge) => edge.underlyingDependencyCount > 0).map((edge) => [edge.from, edge.to]), [
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

        groupsEnabled: true,
        expandedGroupPaths: new Set([outer!.pathKey, firstBloom!.pathKey]),
    });
    assert.ok(scene.nodes.some((node) => node.id === 'pass:node:2'));
    assert.equal(scene.nodes.some((node) => node.id === 'pass:node:5'), false);
    assert.ok(scene.nodes.some((node) => node.kind === 'group' && node.groupId === secondBloom!.id));
});

test('creates declaration entrances only for retained topology boundaries', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const scene = createGraphScene(snapshot, { groupsEnabled: false, expandedGroupPaths: new Set() });
    assert.deepEqual(scene.nodes.filter((node) => node.kind === 'resource').map((node) => node.resourceId), ['resource:1', 'resource:2']);
    assert.deepEqual(scene.edges.filter((edge) => edge.relations.some((relation) => relation.role === 'declaration')).map((edge) => [edge.from, edge.to]), [
        ['resource:resource:1', 'pass:node:1'], ['resource:resource:2', 'pass:node:2'],
    ]);
    assert.ok(scene.nodes.every((node) => node.kind !== ('culled-pass' as string)));
    assert.ok(scene.edges.every((edge) => !('label' in edge)));
    assert.ok(scene.nodes.find((node) => node.id === 'resource:resource:1')?.label.includes('Imported'));
    assert.ok(scene.nodes.find((node) => node.id === 'resource:resource:1')?.label.startsWith('Imported · Texture\n'));
    assert.deepEqual(scene.interaction.hoverElementIdsBySelection.get('node:node:1'), ['pass:node:1']);
    const declaration = scene.edges.find((edge) => edge.relations[0]?.role === 'declaration')!;
    const selected = scene.interaction.selectionByElementId.get(declaration.id)!;
    assert.deepEqual(selected, { kind: 'resource', id: declaration.resourceId });
    assert.equal((resolveSelectedDetail(snapshot, selected) as { id: string }).id, declaration.resourceId);
});

test('root selection follows normalized identity across array reorder, but not ambiguous Legacy roots', () => {
    const snapshot = createLegacyDebugViewModel(createGroupedCapture());
    const resource = snapshot.resources[2]!;
    const roots = [0, 8].map((offset) => {
        const declaration = { reason: 'output' as const, resourceId: resource.id, range: { kind: 'buffer' as const, offset, size: 8 } };
        return { ...declaration, resource, key: rootKey(declaration) };
    });
    const selection = { kind: 'root' as const, key: roots[0]!.key };
    const reordered = { ...snapshot, roots: [...roots].reverse() };
    assert.equal(selectionExists(reordered, selection), true);
    assert.equal(resolveSelectedDetail(reordered, selection), roots[0]);
    const legacy = { reason: 'output' as const, resourceId: resource.id, resource };
    const ambiguous = { ...snapshot, roots: [legacy, legacy].map((root) => ({ ...root, key: rootKey(root) })) };
    assert.equal(selectionExists(ambiguous, { kind: 'root', key: rootKey(legacy) }), false);
});

test('ordering dependencies also suppress redundant declaration entrances', () => {
    const capture = createGroupedCapture();
    const snapshot = createLegacyDebugViewModel({ ...capture, compilation: { ...capture.compilation,
        dependencies: capture.compilation.dependencies.map((edge) => ({ ...edge, kind: 'ordering' as const })),
        accesses: [...capture.compilation.accesses, { ...capture.compilation.accesses[0]!, id: 99 }],
    } });
    const scene = createGraphScene(snapshot, { groupsEnabled: false, expandedGroupPaths: new Set() });
    assert.equal(scene.edges.filter((edge) => edge.relations.some((relation) => relation.role === 'declaration')).length, 2);
    assert.equal(scene.edges.filter((edge) => edge.kind === 'ordering').length, 2);
});

test('outputs retain exact producer and initial-content relations, including root-only resources', () => {
    const base = createLegacyDebugViewModel(createGroupedCapture());
    const resource = { id: 'resource:initial', kind: 'buffer' as const, origin: 'imported' as const, initialContents: 'defined' as const, usageFlags: [] };
    const roots = [
        { key: 'mixed', reason: 'output' as const, resourceId: 'resource:1', resource: base.resources[0]!, range: { kind: 'texture' as const, regions: [{ baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 3, aspect: 'all' }] }, resolution: { producerNodeIds: ['node:1', 'node:2'], usesInitialContents: true } },
        { key: 'initial', reason: 'readback' as const, resourceId: resource.id, resource, range: { kind: 'buffer' as const, offset: 0, size: 16 }, resolution: { producerNodeIds: [], usesInitialContents: true } },
        { key: 'legacy', reason: 'debug-capture' as const, resourceId: 'resource:1', resource: base.resources[0]! },
    ];
    const resources = [...base.resources.map((entry) => entry.id === 'resource:1' ? { ...entry, initialContents: 'defined' as const } : entry), resource];
    const scene = createGraphScene({ ...base, resources, resourceById: new Map(resources.map((entry) => [entry.id, entry])), roots }, { groupsEnabled: false, expandedGroupPaths: new Set() });
    assert.equal(scene.nodes.filter((node) => node.kind === 'root').length, 3);
    assert.deepEqual(scene.edges.filter((edge) => edge.to === 'root:mixed').map((edge) => edge.from), ['pass:node:1', 'pass:node:2', 'resource:resource:1']);
    assert.equal(scene.edges.filter((edge) => edge.to === 'root:initial').length, 1);
    assert.equal(scene.edges.filter((edge) => edge.to === 'root:legacy').length, 0);
    assert.equal(scene.interaction.selectionByElementId.get('root:mixed')?.kind, 'root');
});

test('resource-only groups remain visible and fold initial output without inferring relation roles', () => {
    const base = createLegacyDebugViewModel(createGroupedCapture());
    const resource = { ...base.resources[2]!, origin: 'imported' as const, initialContents: 'defined' as const };
    const root = { key: 'only', reason: 'output' as const, resourceId: resource.id, resource, resolution: { producerNodeIds: [], usesInitialContents: true } };
    const resources = base.resources.map((entry) => entry.id === resource.id ? resource : entry);
    const scene = createGraphScene({ ...base, resources, resourceById: new Map(resources.map((entry) => [entry.id, entry])), roots: [root] }, { groupsEnabled: true, expandedGroupPaths: new Set() });
    const edge = scene.edges.find((edge) => edge.to === 'root:only')!;
    assert.ok(edge.from.startsWith('group:'));
    assert.deepEqual(edge.relations.map((relation) => relation.role), ['output-initial']);
});

test('changes content keys for tooltip-only metadata without changing topology keys', () => {
    const capture = createGroupedCapture();
    const first = createGraphScene(createLegacyDebugViewModel(capture), {
         groupsEnabled: false, expandedGroupPaths: new Set(),
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
         groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    assert.equal(first.topologyKey, changed.topologyKey);
    assert.notEqual(first.contentKey, changed.contentKey);
});

test('indexes only resource entrances and edges by logical ID, independent of ranges and allocations', () => {
    const capture = createGroupedCapture();
    const base = createLegacyDebugViewModel({ ...capture, compilation: { ...capture.compilation,
        resources: capture.compilation.resources.map((resource) => resource.kind === 'texture'
            ? { ...resource, label: 'same-name', physicalAllocationId: 1 } : resource),
        dependencies: [...capture.compilation.dependencies,
            { fromNodeId: 2, toNodeId: 3, resourceId: 1, kind: 'ordering' }],
    } });
    const resource = base.resources[0]!;
    const roots = [0, 1].map((mip) => ({
        key: `mip:${mip}`, reason: 'output' as const, resourceId: resource.id, resource,
        range: { kind: 'texture' as const, regions: [{ baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, aspect: 'all' }] },
        resolution: { producerNodeIds: ['node:1'], usesInitialContents: true },
    }));
    const snapshot = { ...base, roots };
    for (const expandedGroupPaths of [new Set<string>(), new Set(base.debugGroups.map((group) => group.pathKey))]) {
        const scene = createGraphScene(snapshot, { groupsEnabled: true, expandedGroupPaths });
        for (const resource of base.resources) {
            const expected = [
                ...scene.nodes.filter((node) => node.kind === 'resource' && node.resourceId === resource.id).map((node) => node.id),
                ...scene.edges.filter((edge) => edge.resourceId === resource.id).map((edge) => edge.id),
            ];
            assert.deepEqual(scene.interaction.resourceElementIdsByResourceId.get(resource.id) ?? [], expected);
            assert.deepEqual(scene.interaction.primaryElementIdsBySelection.get(`resource:${resource.id}`) ?? [], expected);
            assert.deepEqual(scene.interaction.hoverElementIdsBySelection.get(`resource:${resource.id}`) ?? [], expected);
            for (const edge of scene.edges.filter((edge) => edge.resourceId === resource.id)) {
                assert.deepEqual(scene.interaction.selectionByElementId.get(edge.id), { kind: 'resource', id: resource.id });
                assert.equal(edge.title, 'same-name\n' + [...new Set(edge.relations.map((relation) => relation.role))].join(' · '));
            }
        }
        const roles = scene.edges.filter((edge) => edge.resourceId === resource.id).flatMap((edge) => edge.relations.map((relation) => relation.role));
        assert.deepEqual(new Set(roles), new Set(['declaration', 'value', 'ordering', 'output-producer', 'output-initial']));
        for (const node of scene.nodes) {
            const selection = scene.interaction.selectionByElementId.get(node.id)!;
            if (node.kind !== 'resource') assert.deepEqual(scene.interaction.hoverElementIdsBySelection.get(selectionKey(selection)), [node.id]);
        }
    }
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
