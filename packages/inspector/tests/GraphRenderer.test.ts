import assert from 'node:assert/strict';
import test from 'node:test';

import cytoscape, { type Core, type CytoscapeOptions } from 'cytoscape';
import ELK from 'elkjs/lib/elk.bundled.js';

import { TextureAccess } from './accessKinds.ts';
import { createLegacyDebugViewModel, type LegacyFrameGraphCapture } from './legacySnapshotFixture.ts';
import {
    CytoscapeGraphRenderer,
    createCytoscapeEdgeRouteData,
    createElkLayoutGraph,
    createGraphStyles,
    expandedGroupLabelMaxWidth,
    graphEdgeDisplayLabel,
    graphLayoutGeometryKey,
    isOverviewGraphScale,
    layoutGraphScene,
    type GraphLayoutResult,
    type GraphRendererEnvironment,
    type GraphEdgeRoute,
} from '../src/panelCytoscapeGraphRenderer.ts';
import type { GraphRenderRequest } from '../src/panelGraphRenderer.ts';
import { createGraphScene, graphGroupElementId } from '../src/panelGraphScene.ts';
import { resolveGraphScene } from '../src/panelGraphView.ts';
import { createGraphLegend, GRAPH_VISUAL_THEME } from '../src/panelGraphVisuals.ts';
import type { GraphViewState, Selection } from '../src/panelTypes.ts';

test('converts nested compound groups and cross-hierarchy dependencies for ELK', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const [outer, inner] = snapshot.debugGroups;
    const scene = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set([outer!.pathKey, inner!.pathKey]),
    });
    const graph = createElkLayoutGraph(scene);
    const outerNode = graph.children?.find((node) => node.id === graphGroupElementId(outer!.pathKey));
    const innerNode = outerNode?.children?.find((node) => node.id === graphGroupElementId(inner!.pathKey));

    assert.ok(outerNode);
    assert.ok(innerNode);
    assert.ok(innerNode.children?.some((node) => node.id === 'pass:node:2'));
    const sceneEdge = scene.edges[0]!;
    assert.deepEqual(
        graph.edges?.map((edge) => [edge.sources[0], edge.targets[0]]),
        [[`${sceneEdge.id}:source`, `${sceneEdge.id}:target`]],
    );
    assert.ok(graph.children?.find((node) => node.id === 'pass:node:1')?.ports?.some((port) => port.id === `${sceneEdge.id}:source`));
    assert.ok(innerNode.children?.find((node) => node.id === 'pass:node:2')?.ports?.some((port) => port.id === `${sceneEdge.id}:target`));
    assert.equal(graph.layoutOptions?.['elk.layered.mergeEdges'], 'false');
    assert.equal(graph.layoutOptions?.['elk.layered.mergeHierarchyEdges'], 'false');
    assert.equal(graph.layoutOptions?.['elk.spacing.edgeEdge'], '10');
    assert.equal(graph.layoutOptions?.['elk.layered.spacing.edgeEdgeBetweenLayers'], '10');

    const result = await layoutGraphScene(new ELK(), scene);
    assert.ok(result.positions.has('pass:node:1'));
    assert.ok(result.positions.has('pass:node:2'));
    assert.ok(result.positions.has(graphGroupElementId(outer!.pathKey)));
    assert.ok(result.positions.has(graphGroupElementId(inner!.pathKey)));
    assert.ok(result.routes.has(sceneEdge.id));
});

test('keeps parallel resource dependencies as independent spaced ELK edges and ports', async () => {
    const scene = createGraphScene(createLegacyDebugViewModel(createParallelCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    assert.equal(scene.edges.length, 2);
    assert.deepEqual(new Set(scene.edges.map((edge) => `${edge.from}->${edge.to}`)), new Set(['pass:node:1->pass:node:2']));

    const graph = createElkLayoutGraph(scene);
    assert.equal(graph.edges?.length, 2);
    assert.equal(graph.children?.find((node) => node.id === 'pass:node:1')?.ports?.length, 2);
    assert.equal(graph.children?.find((node) => node.id === 'pass:node:2')?.ports?.length, 2);
    assert.equal(graph.layoutOptions?.['elk.layered.mergeEdges'], 'false');
    assert.equal(graph.layoutOptions?.['elk.layered.mergeHierarchyEdges'], 'false');

    const result = await layoutGraphScene(new ELK(), scene);
    const routes = scene.edges.map((edge) => result.routes.get(edge.id));
    assert.ok(routes.every((route) => route !== undefined));
    assert.notDeepEqual(routes[0], routes[1]);
});

test('accumulates compound offsets into ELK route coordinates', async () => {
    const scene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const edgeId = scene.edges[0]!.id;
    const elk = {
        layout: async () => ({
            id: 'root',
            edges: [{
                id: edgeId,
                sources: ['pass:node:1'],
                targets: ['pass:node:2'],
                container: 'container',
                sections: [{
                    id: 'section',
                    startPoint: { x: 10, y: 20 },
                    bendPoints: [{ x: 30, y: 20 }],
                    endPoint: { x: 30, y: 40 },
                }],
            }],
            children: [{
                id: 'container',
                x: 100,
                y: 200,
                width: 300,
                height: 200,
            }],
        }),
    } as unknown as Parameters<typeof layoutGraphScene>[0];

    const result = await layoutGraphScene(elk, scene);
    assert.deepEqual(result.routes.get(edgeId), {
        startPoint: { x: 110, y: 220 },
        bendPoints: [{ x: 130, y: 220 }],
        endPoint: { x: 130, y: 240 },
    });
});

test('resolves real ELK routes inside nested expanded groups from their container coordinates', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedInternalCapture());
    const [outer, inner] = snapshot.debugGroups;
    const scene = createGraphScene(snapshot, {
        mode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set([outer!.pathKey, inner!.pathKey]),
    });
    const internalEdge = scene.edges.find((edge) => edge.from === 'pass:node:2' && edge.to === 'pass:node:3');
    assert.ok(internalEdge);

    const result = await layoutGraphScene(new ELK(), scene);
    const source = result.positions.get(internalEdge.from);
    const target = result.positions.get(internalEdge.to);
    const route = result.routes.get(internalEdge.id);
    assert.ok(source);
    assert.ok(target);
    assert.ok(route);
    assert.ok(route.startPoint.x > source.x);
    assert.ok(route.endPoint.x < target.x);
});

test('keys layout by topology and node geometry and applies the semantic zoom threshold', () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const passes = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(snapshot, {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });

    const resizedPasses = {
        ...passes,
        nodes: passes.nodes.map((node) => node.id === 'pass:node:1' ? { ...node, label: `${node.label}\nmore` } : node),
    };
    assert.notEqual(graphLayoutGeometryKey(passes), graphLayoutGeometryKey(resources));
    assert.notEqual(graphLayoutGeometryKey(passes), graphLayoutGeometryKey(resizedPasses));
    assert.equal(graphEdgeDisplayLabel({ ...passes.edges[0]!, label: 'dependency' }), 'dependency');
    assert.notEqual(resources.edges[0]!.label, '');
    assert.equal(graphEdgeDisplayLabel(resources.edges[0]!), '');
    assert.equal(isOverviewGraphScale(0.5), true);
    assert.equal(isOverviewGraphScale(1), false);
});

test('keeps node dimensions unchanged while highlighting semantic hover', () => {
    const styles = createGraphStyles();
    const nodeHover = styles.find((entry) => entry.selector === 'node.semantic-hover');
    const edgeHover = styles.find((entry) => entry.selector === 'edge.semantic-hover');

    assert.ok(nodeHover && 'style' in nodeHover);
    assert.equal(Object.hasOwn(nodeHover.style, 'width'), false);
    assert.ok(edgeHover && 'style' in edgeHover);
    assert.equal(Object.hasOwn(edgeHover.style, 'width'), true);
});

test('uses graphite semantic styles and keeps selected state above hover', () => {
    const styles = createGraphStyles();
    const ordering = styles.find((entry) => entry.selector === 'edge[dependencyKind = "ordering"]');
    const external = styles.find((entry) => entry.selector === 'node[passKind = "external-submission"]');
    const hoverIndex = styles.findIndex((entry) => entry.selector === 'node.semantic-hover');
    const selectedIndex = styles.findIndex((entry) => entry.selector === 'node.semantic-selected');

    assert.ok(ordering && 'style' in ordering);
    const orderingStyle = ordering.style as unknown as Record<string, unknown>;
    assert.equal(orderingStyle['line-style'], 'dotted');
    assert.equal(orderingStyle['target-arrow-fill'], 'hollow');
    assert.ok(external && 'style' in external);
    assert.equal((external.style as unknown as Record<string, unknown>)['border-style'], 'double');
    assert.ok(selectedIndex > hoverIndex);
    assert.equal(styles.some((entry) => entry.selector === ':selected'), false);
    assert.equal(
        (styles[selectedIndex] as unknown as { readonly style: Record<string, unknown> }).style['border-color'],
        GRAPH_VISUAL_THEME.selected,
    );
});

test('derives a stable compact legend from the rendered scene', () => {
    const resourceScene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    assert.deepEqual(
        createGraphLegend(resourceScene).map((entry) => entry.key),
        ['render', 'texture', 'read', 'write'],
    );

    const orderingCapture = createNestedCapture();
    const orderingScene = createGraphScene(createLegacyDebugViewModel({
        ...orderingCapture,
        compilation: {
            ...orderingCapture.compilation,
            dependencies: orderingCapture.compilation.dependencies.map((dependency) => ({
                ...dependency,
                kind: 'ordering' as const,
            })),
        },
    }), { mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set() });
    assert.ok(createGraphLegend(orderingScene).some((entry) => entry.key === 'ordering' && entry.hollowArrow));
});

test('uses only straight and rounded ELK route styles without taxi routing', () => {
    const styles = createGraphStyles();
    const serialized = JSON.stringify(styles);
    const baseEdge = styles.find((entry) => entry.selector === 'edge');
    const roundedRoute = styles.find((entry) => entry.selector === 'edge.elk-segments');

    assert.equal(serialized.includes('taxi'), false);
    assert.ok(baseEdge && 'style' in baseEdge);
    assert.equal((baseEdge.style as Record<string, unknown>)['curve-style'], 'straight');
    assert.ok(roundedRoute && 'style' in roundedRoute);
    assert.equal((roundedRoute.style as Record<string, unknown>)['curve-style'], 'round-segments');
    assert.equal((roundedRoute.style as Record<string, unknown>)['segment-radii'], '6px');
});

test('converts ELK endpoints and bends relative to the routed endpoints', () => {
    const route: GraphEdgeRoute = {
        startPoint: { x: 20, y: 10 },
        bendPoints: [{ x: 60, y: 10 }, { x: 60, y: 70 }],
        endPoint: { x: 100, y: 70 },
    };
    const data = createCytoscapeEdgeRouteData(route, { x: 10, y: 10 }, { x: 110, y: 70 });

    assert.ok(data);
    assert.equal(data.sourceEndpoint, '10px 0px');
    assert.equal(data.targetEndpoint, '-10px 0px');
    const weights = data.segmentWeights.split(' ').map(Number);
    const distances = data.segmentDistances.split(' ').map(Number);
    const reconstructed = weights.map((weight, index) => pointFromSegment(
        route.startPoint,
        route.endPoint,
        weight,
        distances[index]!,
    ));
    assertPointsClose(reconstructed, route.bendPoints);
});

test('places expanded group labels inside the compound frame', () => {
    const styles = createGraphStyles();
    const expandedGroup = styles.find((entry) => entry.selector === 'node[kind = "group"][collapsed = 0]');

    assert.ok(expandedGroup && 'style' in expandedGroup);
    const groupStyle = expandedGroup.style as Record<string, unknown>;
    assert.equal(groupStyle['text-halign'], 'left-inside');
    assert.equal(groupStyle['text-valign'], 'top-inside');
    assert.equal(groupStyle['text-justification'], 'left');
});

test('uses the available compound width for expanded group labels', () => {
    assert.equal(expandedGroupLabelMaxWidth(176), 160);
    assert.equal(expandedGroupLabelMaxWidth(816), 800);
});

test('updates content in place while preserving positions, viewport, and ELK routes', async () => {
    const capture = createNestedCapture();
    const firstScene = createGraphScene(createLegacyDebugViewModel(capture), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const changedScene = createGraphScene(createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            nodes: capture.compilation.nodes.map((node) => node.id === 2
                ? { ...node, label: 'postfx.flare' }
                : node),
        },
    }), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    assert.equal(firstScene.topologyKey, changedScene.topologyKey);
    assert.notEqual(firstScene.contentKey, changedScene.contentKey);

    const harness = createRendererHarness();
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(firstScene));
    await waitFor(() => harness.core?.getElementById('pass:node:2').nonempty() === true);
    const core = harness.core!;
    const edge = core.getElementById(firstScene.edges[0]!.id);
    const position = { x: 321, y: 123 };
    core.getElementById('pass:node:2').position(position);
    core.pan({ x: 17, y: 29 });
    core.zoom(1.25);
    edge.addClass('elk-route elk-segments');
    edge.data('sourceEndpoint', '5px 0px');
    edge.data('targetEndpoint', '-5px 0px');
    edge.data('segmentDistances', '12 24');
    edge.data('segmentWeights', '0.25 0.75');

    const firstHoverTarget = core.getElementById('pass:node:2') as unknown as {
        emit: (event: { readonly type: string; readonly renderedPosition: { readonly x: number; readonly y: number } }) => void;
    };
    firstHoverTarget.emit({ type: 'mouseover', renderedPosition: { x: 10, y: 10 } });
    assert.equal(harness.createdElements[1]!.hidden, false);

    renderer.render(graphRequest(changedScene));
    await waitFor(() => core.getElementById('pass:node:2').data('detailLabel') === changedScene.nodes.find((node) => node.id === 'pass:node:2')?.label);
    assert.equal(harness.createdElements[1]!.hidden, true);

    assert.deepEqual(core.getElementById('pass:node:2').position(), position);
    assert.deepEqual(core.pan(), { x: 17, y: 29 });
    assert.equal(core.zoom(), 1.25);
    assert.equal(edge.hasClass('elk-route'), true);
    assert.equal(edge.hasClass('elk-segments'), true);
    assert.equal(edge.data('sourceEndpoint'), '5px 0px');
    assert.equal(edge.data('targetEndpoint'), '-5px 0px');
    assert.equal(edge.data('segmentDistances'), '12 24');
    assert.equal(edge.data('segmentWeights'), '0.25 0.75');
    const hoverTarget = core.getElementById('pass:node:2') as unknown as {
        emit: (event: { readonly type: string; readonly renderedPosition: { readonly x: number; readonly y: number } }) => void;
    };
    hoverTarget.emit({
        type: 'mouseover',
        renderedPosition: { x: 10, y: 10 },
    });
    assert.equal(
        harness.createdElements[1]!.textContent,
        changedScene.nodes.find((node) => node.id === 'pass:node:2')!.title,
    );

    renderer.render(graphRequest(changedScene, { hovered: { kind: 'node', id: 'node:2' } }));
    assert.equal(core.getElementById('pass:node:2').hasClass('semantic-hover'), true);
    renderer.destroy();
});

test('renders bent ELK routes as rounded segments and falls back to straight edges', async (context) => {
    const scene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const edgeId = scene.edges[0]!.id;
    const layouts: GraphLayoutResult[] = [
        testLayout(scene, 10, {
            startPoint: { x: 20, y: 10 },
            bendPoints: [{ x: 40, y: 10 }, { x: 40, y: 50 }],
            endPoint: { x: 60, y: 50 },
        }),
        testLayout(scene, 20, {
            startPoint: { x: 30, y: 20 },
            bendPoints: [],
            endPoint: { x: 70, y: 60 },
        }),
        testLayout(scene, 30, {
            startPoint: { x: Number.NaN, y: 30 },
            bendPoints: [{ x: 50, y: 30 }],
            endPoint: { x: 80, y: 70 },
        }),
    ];
    let layoutIndex = 0;
    const harness = createRendererHarness({
        layoutScene: async () => layouts[layoutIndex++]!,
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    context.after(() => renderer.destroy());
    renderer.render(graphRequest(scene));
    await waitFor(() => harness.core?.getElementById(edgeId).hasClass('elk-segments') === true);
    const edge = harness.core!.getElementById(edgeId);
    assert.equal(edge.hasClass('elk-route'), true);
    assert.equal(edge.data('sourceEndpoint'), '10px 0px');
    assert.equal(edge.style('source-endpoint'), '10px 0px');
    assert.equal(edge.style('edge-distances'), 'endpoints');
    assert.equal(edge.style('curve-style'), 'round-segments');
    assert.equal(edge.style('segment-radii'), '6');

    renderer.relayout();
    await waitFor(() => edge.hasClass('elk-route') && !edge.hasClass('elk-segments'));
    assert.equal(edge.style('curve-style'), 'straight');

    renderer.relayout();
    await waitFor(() => layoutIndex === 3);
    assert.equal(edge.hasClass('elk-route'), false);
    assert.equal(edge.hasClass('elk-segments'), false);
    assert.equal(edge.style('curve-style'), 'straight');
    assert.equal(edge.data('sourceEndpoint'), undefined);
});

test('keeps selection and group double-click interaction on the read-only graph', async (context) => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const group = snapshot.debugGroups[0]!;
    const scene = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: true, expandedGroupPaths: new Set(),
    });
    const selected: Selection[] = [];
    let toggledPath: string | undefined;
    const harness = createRendererHarness();
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    context.after(() => renderer.destroy());
    renderer.render({
        ...graphRequest(scene),
        onSelect: (selection) => selected.push(selection),
        onToggleGroup: (pathKey) => { toggledPath = pathKey; },
    });
    const groupId = graphGroupElementId(group.pathKey);
    await waitFor(() => harness.core?.getElementById(groupId).nonempty() === true);
    const groupNode = harness.core!.getElementById(groupId);
    groupNode.emit('tap');
    groupNode.emit('tap');

    assert.deepEqual(selected, [
        { kind: 'group', pathKey: group.pathKey },
        { kind: 'group', pathKey: group.pathKey },
    ]);
    assert.equal(toggledPath, group.pathKey);
    assert.equal(groupNode.grabbable(), false);
    renderer.render(graphRequest(scene, {
        selected: { kind: 'group', pathKey: group.pathKey },
        hovered: { kind: 'group', pathKey: group.pathKey },
    }));
    assert.equal(groupNode.hasClass('semantic-selected'), true);
    assert.equal(groupNode.hasClass('semantic-hover'), true);
    assert.equal(groupNode.selected(), false);
    assert.equal(groupNode.style('border-color'), 'rgb(56,189,248)');
});

test('keeps target fit pending until the latest layout is applied', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const passes = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(snapshot, {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resourceLayout = deferred<GraphLayoutResult>();
    let resourceLayoutStarted = false;
    const harness = createRendererHarness({
        layoutScene: async (_elk, scene) => {
            if (scene.mode === 'resources') {
                resourceLayoutStarted = true;
                return resourceLayout.promise;
            }
            return testLayout(scene, 10);
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(passes));
    await waitFor(() => harness.core?.getElementById('pass:node:1').nonempty() === true);
    const core = harness.core!;
    const originalFit = core.fit.bind(core);
    let fitCount = 0;
    core.fit = ((...args: unknown[]) => {
        fitCount++;
        return originalFit(...args as [cytoscape.CollectionArgument | undefined, number | undefined]);
    }) as typeof core.fit;

    renderer.render({ ...graphRequest(resources), fit: true });
    await waitFor(() => resourceLayoutStarted);
    renderer.fit();
    assert.equal(fitCount, 1);
    resourceLayout.resolve(testLayout(resources, 100));
    await waitFor(() => core.getElementById('resource:resource:1').nonempty() === true);
    assert.equal(fitCount, 2);
    renderer.destroy();
});

test('does not transfer a pending fit to a superseding scene that did not request it', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const passes = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(snapshot, {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resourceLayout = deferred<GraphLayoutResult>();
    let resourceLayoutStarted = false;
    const harness = createRendererHarness({
        layoutScene: async (_elk, scene) => {
            if (scene.mode === 'resources') {
                resourceLayoutStarted = true;
                return resourceLayout.promise;
            }
            return testLayout(scene, 10);
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(passes));
    await waitFor(() => harness.core?.getElementById('pass:node:1').nonempty() === true);
    const core = harness.core!;
    const originalFit = core.fit.bind(core);
    let fitCount = 0;
    core.fit = ((...args: unknown[]) => {
        fitCount++;
        return originalFit(...args as [cytoscape.CollectionArgument | undefined, number | undefined]);
    }) as typeof core.fit;

    renderer.render({ ...graphRequest(resources), fit: true });
    await waitFor(() => resourceLayoutStarted);
    renderer.render(graphRequest(passes));
    resourceLayout.resolve(testLayout(resources, 100));
    await nextTurn();
    await nextTurn();

    assert.equal(fitCount, 0);
    assert.equal(core.getElementById('pass:node:1').nonempty(), true);
    renderer.destroy();
});

test('keeps the Cytoscape core intact after layout failure and retries successfully', async () => {
    const scene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    let attempts = 0;
    const harness = createRendererHarness({
        layoutScene: async (_elk, nextScene) => {
            if (attempts++ === 0) throw new Error('layout unavailable');
            return testLayout(nextScene, 50);
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(scene));
    await waitFor(() => harness.createdElements[2]!.dataset.state === 'error');
    const core = harness.core!;
    assert.equal(harness.createdElements[3]!.textContent, 'Failed to render graph: layout unavailable');
    assert.equal(harness.createdElements[4]!.hidden, false);

    harness.createdElements[4]!.click();
    await waitFor(() => core.getElementById('pass:node:1').nonempty() === true);
    assert.equal(harness.core, core);
    assert.equal(harness.createdElements[2]!.hidden, true);
    renderer.destroy();
});

test('resizes with the host observer and disconnects it on destroy', async () => {
    const scene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    let onResize: (() => void) | undefined;
    let disconnectCount = 0;
    const harness = createRendererHarness({
        observeResize: (_element, callback) => {
            onResize = callback;
            return { disconnect: () => disconnectCount++ };
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(scene));
    await waitFor(() => harness.core?.getElementById('pass:node:1').nonempty() === true);
    const core = harness.core!;
    const originalResize = core.resize.bind(core);
    let resizeCount = 0;
    core.resize = (() => {
        resizeCount++;
        return originalResize();
    }) as typeof core.resize;

    onResize?.();
    assert.equal(resizeCount, 1);
    renderer.destroy();
    assert.equal(disconnectCount, 1);
});

test('shows an empty state without loading the graph runtime', async () => {
    const scene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    let loadCount = 0;
    const harness = createRendererHarness({ onLoadRuntime: () => loadCount++ });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render({
        ...graphRequest(scene),
        scene: { ...scene, nodes: [], edges: [], topologyKey: 'empty', contentKey: 'empty' },
    });
    await waitFor(() => harness.createdElements[2]!.dataset.state === 'empty');
    assert.equal(loadCount, 0);
    renderer.destroy();
});

test('applies only the latest request while runtime loading and does not initialize after destroy', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const passes = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(snapshot, {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const runtime = deferred<RendererRuntime>();
    const harness = createRendererHarness({ runtime: runtime.promise });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(passes));
    renderer.render(graphRequest(resources));
    runtime.resolve(createHeadlessRuntime((core) => harness.setCore(core)));
    await waitFor(() => harness.core?.getElementById('resource:resource:1').nonempty() === true);
    assert.equal(harness.core!.getElementById(graphGroupElementId('unused')).empty(), true);
    assert.equal(harness.core!.nodes().length, resources.nodes.length);
    renderer.destroy();

    const destroyedRuntime = deferred<RendererRuntime>();
    let createCount = 0;
    const destroyedHarness = createRendererHarness({
        runtime: destroyedRuntime.promise,
        onCreateCore: () => createCount++,
    });
    const destroyedRenderer = new CytoscapeGraphRenderer(destroyedHarness.host, destroyedHarness.environment);
    destroyedRenderer.render(graphRequest(passes));
    destroyedRenderer.destroy();
    destroyedRuntime.resolve(createHeadlessRuntime(() => createCount++));
    await nextTurn();
    assert.equal(createCount, 0);
    assert.equal(destroyedHarness.hostChildren.length, 0);
});

test('discards stale layout results and rebuilds interaction for the latest scene', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const passes = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(snapshot, {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const layouts: Array<{ scene: typeof passes; result: Deferred<GraphLayoutResult> }> = [];
    const harness = createRendererHarness({
        layoutScene: async (_elk, scene) => {
            const result = deferred<GraphLayoutResult>();
            layouts.push({ scene, result });
            return result.promise;
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(passes));
    await waitFor(() => layouts.length === 1);
    renderer.render(graphRequest(resources, { hovered: { kind: 'resource', id: 'resource:1' } }));
    await nextTurn();
    assert.equal(layouts.length, 1);
    layouts[0]!.result.resolve(testLayout(passes, 10));
    await waitFor(() => layouts.length === 2);
    layouts[1]!.result.resolve(testLayout(resources, 200));
    await waitFor(() => harness.core?.getElementById('resource:resource:1').hasClass('semantic-hover') === true);
    await nextTurn();
    assert.equal(harness.core!.getElementById('resource:resource:1').nonempty(), true);
    assert.equal(harness.core!.getElementById('pass:node:1').position('x'), 200);
    renderer.destroy();
});

test('coalesces interaction updates without restarting the same in-flight layout', async () => {
    const scene = createGraphScene(createLegacyDebugViewModel(createNestedCapture()), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const pendingLayout = deferred<GraphLayoutResult>();
    let layoutCount = 0;
    const harness = createRendererHarness({
        layoutScene: async () => {
            layoutCount++;
            return pendingLayout.promise;
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(scene));
    await waitFor(() => layoutCount === 1);
    renderer.render(graphRequest(scene, { hovered: { kind: 'node', id: 'node:2' } }));
    await nextTurn();
    assert.equal(layoutCount, 1);

    pendingLayout.resolve(testLayout(scene, 30));
    await waitFor(() => harness.core?.getElementById('pass:node:2').hasClass('semantic-hover') === true);
    assert.equal(layoutCount, 1);
    renderer.destroy();
});

test('does not let a superseded topology mutate the currently applied elements', async () => {
    const capture = createNestedCapture();
    const passes = createGraphScene(createLegacyDebugViewModel(capture), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const changedPasses = createGraphScene(createLegacyDebugViewModel({
        ...capture,
        compilation: {
            ...capture.compilation,
            nodes: capture.compilation.nodes.map((node) => node.id === 2
                ? { ...node, label: 'postfx.bloom.latest' }
                : node),
        },
    }), {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(createLegacyDebugViewModel(capture), {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const pendingResourceLayout = deferred<GraphLayoutResult>();
    let resourceLayoutStarted = false;
    const harness = createRendererHarness({
        layoutScene: async (_elk, scene) => {
            if (scene.mode === 'resources') {
                resourceLayoutStarted = true;
                return pendingResourceLayout.promise;
            }
            return testLayout(scene, 10);
        },
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(passes));
    await waitFor(() => harness.core?.getElementById('pass:node:2').nonempty() === true);

    renderer.render(graphRequest(resources));
    await waitFor(() => resourceLayoutStarted);
    renderer.render(graphRequest(changedPasses));
    await nextTurn();
    assert.equal(
        harness.core!.getElementById('pass:node:2').data('detailLabel'),
        passes.nodes.find((node) => node.id === 'pass:node:2')?.label,
    );
    pendingResourceLayout.resolve(testLayout(resources, 200));
    await waitFor(() => harness.core?.getElementById('pass:node:2').data('detailLabel')
        === changedPasses.nodes.find((node) => node.id === 'pass:node:2')?.label);

    assert.equal(harness.core!.getElementById('resource:resource:1').empty(), true);
    assert.deepEqual(
        harness.core!.nodes().map((node) => node.id()).sort(),
        changedPasses.nodes.map((node) => node.id).sort(),
    );
    renderer.destroy();
});

test('keeps nodes read-only and relayouts only for geometry, mode, or explicit requests', async () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const passes = createGraphScene(snapshot, {
        mode: 'passes', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    const resources = createGraphScene(snapshot, {
        mode: 'resources', groupsEnabled: false, expandedGroupPaths: new Set(),
    });
    let layoutCount = 0;
    const harness = createRendererHarness({
        layoutScene: async (_elk, scene) => testLayout(scene, ++layoutCount * 100),
    });
    const renderer = new CytoscapeGraphRenderer(harness.host, harness.environment);
    renderer.render(graphRequest(passes));
    await waitFor(() => harness.core?.getElementById('pass:node:1').position('x') === 100);
    const passNode = harness.core!.getElementById('pass:node:1');
    assert.equal(passNode.grabbable(), false);

    const contentOnly = {
        ...passes,
        contentKey: `${passes.contentKey}:content-only`,
        nodes: passes.nodes.map((node) => node.id === 'pass:node:1'
            ? { ...node, label: node.label.replace(/.$/, 'x'), title: `${node.title}\nupdated` }
            : node),
    };
    renderer.render(graphRequest(contentOnly));
    await waitFor(() => passNode.data('detailLabel') === contentOnly.nodes.find((node) => node.id === 'pass:node:1')!.label);
    assert.equal(layoutCount, 1);
    assert.equal(passNode.position('x'), 100);

    const resized = {
        ...contentOnly,
        contentKey: `${contentOnly.contentKey}:resized`,
        nodes: contentOnly.nodes.map((node) => node.id === 'pass:node:1'
            ? { ...node, label: `${node.label}\nmore` }
            : node),
    };
    renderer.render(graphRequest(resized));
    await waitFor(() => passNode.position('x') === 200);
    assert.equal(layoutCount, 2);

    renderer.render(graphRequest(resources));
    await waitFor(() => harness.core?.getElementById('resource:resource:1').nonempty() === true);
    assert.equal(harness.core!.getElementById('pass:node:1').position('x'), 300);

    renderer.render(graphRequest(passes));
    await waitFor(() => harness.core?.getElementById('resource:resource:1').empty() === true);
    assert.equal(harness.core!.getElementById('pass:node:1').position('x'), 400);

    renderer.relayout();
    await waitFor(() => harness.core?.getElementById('pass:node:1').position('x') === 500);
    assert.equal(layoutCount, 5);
    renderer.destroy();
});

test('caches graph scenes by snapshot and semantic graph options', () => {
    const snapshot = createLegacyDebugViewModel(createNestedCapture());
    const graphView: GraphViewState = {
        host: createFakeElement(),
        toolbar: createFakeElement(),
        graphMode: 'passes',
        groupsEnabled: true,
        expandedGroupPaths: new Set<string>(),
        fitOnNextRender: false,
    };
    const first = resolveGraphScene(graphView, snapshot);
    assert.equal(resolveGraphScene(graphView, snapshot), first);

    graphView.expandedGroupPaths.add(snapshot.debugGroups[0]!.pathKey);
    const expanded = resolveGraphScene(graphView, snapshot);
    assert.notEqual(expanded, first);
    assert.equal(resolveGraphScene(graphView, snapshot), expanded);

    graphView.graphMode = 'resources';
    const resources = resolveGraphScene(graphView, snapshot);
    assert.notEqual(resources, expanded);
    assert.notEqual(resolveGraphScene(graphView, createLegacyDebugViewModel(createNestedCapture())), resources);
});

type RendererRuntime = Awaited<ReturnType<GraphRendererEnvironment['loadRuntime']>>;
type Deferred<T> = {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function createRendererHarness(options: {
    readonly runtime?: Promise<RendererRuntime>;
    readonly layoutScene?: GraphRendererEnvironment['layoutScene'];
    readonly onCreateCore?: () => void;
    readonly onLoadRuntime?: () => void;
    readonly observeResize?: GraphRendererEnvironment['observeResize'];
} = {}): {
    readonly host: HTMLElement;
    readonly hostChildren: unknown[];
    readonly createdElements: HTMLElement[];
    readonly environment: GraphRendererEnvironment;
    readonly core?: Core;
    readonly setCore: (core: Core) => void;
} {
    const hostChildren: unknown[] = [];
    const host = createFakeElement(hostChildren);
    const createdElements: HTMLElement[] = [];
    let core: Core | undefined;
    const setCore = (next: Core) => {
        core = next;
    };
    const runtime = options.runtime ?? Promise.resolve(createHeadlessRuntime((next) => {
        options.onCreateCore?.();
        setCore(next);
    }));
    return {
        host,
        hostChildren,
        createdElements,
        get core() { return core; },
        setCore,
        environment: {
            createElement: () => {
                const element = createFakeElement();
                createdElements.push(element);
                return element;
            },
            loadRuntime: () => {
                options.onLoadRuntime?.();
                return runtime;
            },
            layoutScene: options.layoutScene ?? (async (_elk, scene) => testLayout(scene, 10)),
            observeResize: options.observeResize,
        },
    };
}

function createHeadlessRuntime(onCreate: (core: Core) => void): RendererRuntime {
    return {
        createCore: (options: CytoscapeOptions) => {
            const core = cytoscape({
                ...options,
                container: undefined,
                headless: true,
                styleEnabled: true,
            });
            onCreate(core);
            return core;
        },
        elk: new ELK(),
    };
}

function createFakeElement(children: unknown[] = []): HTMLElement {
    const listeners = new Map<string, Array<() => void>>();
    return {
        className: '',
        textContent: '',
        hidden: false,
        style: {},
        dataset: {},
        clientWidth: 800,
        clientHeight: 600,
        offsetWidth: 0,
        offsetHeight: 0,
        append: (...next: unknown[]) => {
            children.push(...next);
        },
        replaceChildren: (...next: unknown[]) => {
            children.splice(0, children.length, ...next);
        },
        setAttribute: () => undefined,
        addEventListener: (type: string, listener: () => void) => {
            const callbacks = listeners.get(type) ?? [];
            callbacks.push(listener);
            listeners.set(type, callbacks);
        },
        click: () => {
            for (const listener of listeners.get('click') ?? []) listener();
        },
    } as unknown as HTMLElement;
}

function graphRequest(
    scene: ReturnType<typeof createGraphScene>,
    options: { readonly selected?: Selection; readonly hovered?: Selection } = {},
): GraphRenderRequest {
    return {
        scene,
        selected: options.selected,
        hovered: options.hovered,
        fit: false,
        onSelect: () => undefined,
        onHover: () => undefined,
        onToggleGroup: () => undefined,
    };
}

function testLayout(
    scene: ReturnType<typeof createGraphScene>,
    offset: number,
    route?: GraphEdgeRoute,
): GraphLayoutResult {
    return {
        positions: new Map(scene.nodes.map((node, index) => [node.id, { x: offset + index, y: offset + index }])),
        routes: route && scene.edges[0] ? new Map([[scene.edges[0].id, route]]) : new Map(),
    };
}

function pointFromSegment(
    source: { readonly x: number; readonly y: number },
    target: { readonly x: number; readonly y: number },
    weight: number,
    distance: number,
): { readonly x: number; readonly y: number } {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
        x: source.x + weight * dx + distance * -dy / length,
        y: source.y + weight * dy + distance * dx / length,
    };
}

function assertPointsClose(
    actual: readonly { readonly x: number; readonly y: number }[],
    expected: readonly { readonly x: number; readonly y: number }[],
): void {
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < actual.length; index++) {
        assert.ok(Math.abs(actual[index]!.x - expected[index]!.x) < 1e-9);
        assert.ok(Math.abs(actual[index]!.y - expected[index]!.y) < 1e-9);
    }
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (predicate()) return;
        await nextTurn();
    }
    assert.fail('Timed out waiting for renderer state.');
}

function nextTurn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function createNestedCapture(): LegacyFrameGraphCapture {
    return {
        compilation: {
            debugGroups: [
                { id: 1, label: 'PostFX' },
                { id: 2, parentId: 1, label: 'Bloom' },
            ],
            nodes: [
                { id: 1, kind: 'render', label: 'scene', sideEffect: false },
                { id: 2, kind: 'render', label: 'postfx.bloom', sideEffect: true, debugGroupId: 2 },
            ],
            culledNodes: [],
            resources: [{ id: 1, kind: 'texture', label: 'scene-color', origin: 'transient', usage: 0x14 }],
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
                },
                {
                    id: 2,
                    nodeId: 2,
                    resourceId: 1,
                    access: TextureAccess.Sampled,
                    mode: 'read',
                    producesValue: false,
                    order: 1,
                },
            ],
            dependencies: [{ fromNodeId: 1, toNodeId: 2, resourceId: 1, kind: 'value' }],
            roots: [{ reason: 'side-effect', nodeId: 2 }],
            allocations: [],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2] }],
        },
        gpuTiming: { status: 'unavailable', frameIndex: 1, reason: 'unsupported' },
        resourcePool: {
            acquireCount: 1,
            reuseCount: 0,
            createdCount: 1,
            retainedCount: 1,
            estimatedRetainedBytes: 64,
        },
    };
}

function createNestedInternalCapture(): LegacyFrameGraphCapture {
    const capture = createNestedCapture();
    return {
        ...capture,
        compilation: {
            ...capture.compilation,
            nodes: [
                ...capture.compilation.nodes,
                { id: 3, kind: 'render', label: 'postfx.composite', sideEffect: true, debugGroupId: 2 },
            ],
            accesses: [
                ...capture.compilation.accesses,
                {
                    id: 3,
                    nodeId: 3,
                    resourceId: 1,
                    access: TextureAccess.Sampled,
                    mode: 'read',
                    producesValue: false,
                    order: 2,
                },
            ],
            dependencies: [
                ...capture.compilation.dependencies,
                { fromNodeId: 2, toNodeId: 3, resourceId: 1, kind: 'value' },
            ],
            roots: [...capture.compilation.roots, { reason: 'side-effect', nodeId: 3 }],
            executionSegments: [{ index: 0, kind: 'frame-graph', nodeIds: [1, 2, 3] }],
        },
    };
}

function createParallelCapture(): LegacyFrameGraphCapture {
    const capture = createNestedCapture();
    return {
        ...capture,
        compilation: {
            ...capture.compilation,
            resources: [
                ...capture.compilation.resources,
                { id: 2, kind: 'texture', label: 'bloom-color', origin: 'transient', usage: 0x14 },
            ],
            accesses: [
                ...capture.compilation.accesses,
                {
                    id: 3,
                    nodeId: 1,
                    resourceId: 2,
                    access: TextureAccess.ColorAttachmentWrite,
                    mode: 'write',
                    contents: 'overwrite',
                    producesValue: true,
                    order: 0,
                },
                {
                    id: 4,
                    nodeId: 2,
                    resourceId: 2,
                    access: TextureAccess.Sampled,
                    mode: 'read',
                    producesValue: false,
                    order: 1,
                },
            ],
            dependencies: [
                ...capture.compilation.dependencies,
                { fromNodeId: 1, toNodeId: 2, resourceId: 2, kind: 'value' },
            ],
        },
    };
}
