function pointerEscape(value) {
    return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function compareJsonValue(left, right) {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function requiredLabel(entity, kind) {
    if (typeof entity.label !== 'string' || entity.label.length === 0) {
        throw new Error(`Cross-language ${kind} ${String(entity.id)} must have a non-empty label.`);
    }
    return entity.label;
}

function uniqueEntityMap(entities, kind) {
    const byId = new Map();
    const labels = new Set();
    for (const entity of entities) {
        const label = requiredLabel(entity, kind);
        if (byId.has(entity.id)) throw new Error(`Duplicate ${kind} id ${String(entity.id)}.`);
        if (labels.has(label)) throw new Error(`Duplicate ${kind} label ${label}.`);
        byId.set(entity.id, label);
        labels.add(label);
    }
    return byId;
}

function lookup(map, id, kind) {
    const label = map.get(id);
    if (label === undefined) throw new Error(`Unknown ${kind} id ${String(id)} in producer projection.`);
    return label;
}

function normalizeDescriptor(resource) {
    const descriptor = resource.descriptor;
    if (descriptor === undefined) return null;
    if (descriptor.kind === 'buffer') {
        return { kind: 'buffer', size: descriptor.size };
    }
    return {
        kind: 'texture',
        format: descriptor.format,
        size: descriptor.size,
        dimension: descriptor.dimension,
        mipLevelCount: descriptor.mipLevelCount,
        sampleCount: descriptor.sampleCount,
        viewFormats: [...descriptor.viewFormats].sort(),
    };
}

export function normalizeProducerSnapshot(caseName, snapshot) {
    const graph = snapshot.graph;
    const groupLabels = uniqueEntityMap(graph.groups, 'group');
    const nodeLabels = uniqueEntityMap(graph.nodes, 'node');
    const resourceLabels = uniqueEntityMap(graph.resources, 'resource');
    const viewLabels = uniqueEntityMap(graph.textureViews, 'texture view');
    const nodeOrderByLabel = new Map(graph.nodes.map((node) => [
        lookup(nodeLabels, node.id, 'node'),
        node.recordingOrder,
    ]));

    const groups = graph.groups.map((group) => ({
        label: lookup(groupLabels, group.id, 'group'),
        parent: group.parentId === undefined ? null : lookup(groupLabels, group.parentId, 'group'),
    })).sort((left, right) => compareText(left.label, right.label));

    const nodes = graph.nodes.map((node) => ({
        label: lookup(nodeLabels, node.id, 'node'),
        recordingOrder: node.recordingOrder,
        kind: node.kind,
        sideEffect: node.sideEffect,
        group: node.groupId === undefined ? null : lookup(groupLabels, node.groupId, 'group'),
        compileState: node.compileState.status === 'retained'
            ? { status: 'retained', executionOrder: node.compileState.executionOrder }
            : { status: 'culled', reason: node.compileState.reason },
    })).sort((left, right) => left.recordingOrder - right.recordingOrder || compareText(left.label, right.label));

    const resources = graph.resources.map((resource) => ({
        label: lookup(resourceLabels, resource.id, 'resource'),
        kind: resource.kind,
        origin: resource.origin,
        initialContents: resource.initialContents ?? null,
        group: resource.groupId === undefined ? null : lookup(groupLabels, resource.groupId, 'group'),
        descriptor: normalizeDescriptor(resource),
        usageFlags: [...resource.usageFlags].sort(),
        lifetime: resource.lifetime ?? null,
    })).sort((left, right) => compareText(left.label, right.label));

    const textureViews = graph.textureViews.map((view) => ({
        label: lookup(viewLabels, view.id, 'texture view'),
        resource: lookup(resourceLabels, view.resourceId, 'resource'),
        format: view.format,
        dimension: view.dimension,
        aspect: view.aspect,
        baseMipLevel: view.baseMipLevel,
        mipLevelCount: view.mipLevelCount,
        baseArrayLayer: view.baseArrayLayer,
        arrayLayerCount: view.arrayLayerCount,
        swizzle: view.swizzle,
    })).sort((left, right) => compareText(left.label, right.label));

    const accesses = graph.accesses.map((access) => ({
        node: lookup(nodeLabels, access.nodeId, 'node'),
        resource: lookup(resourceLabels, access.resourceId, 'resource'),
        ...(access.textureViewId === undefined
            ? {}
            : { textureView: lookup(viewLabels, access.textureViewId, 'texture view') }),
        access: access.access,
        mode: access.mode,
        ...(access.contents === undefined ? {} : { contents: access.contents }),
        producesValue: access.producesValue,
        ...(access.bufferRange === undefined ? {} : { bufferRange: access.bufferRange }),
        ...(access.textureRegion === undefined ? {} : { textureRegion: access.textureRegion }),
    })).sort((left, right) => {
        const order = (nodeOrderByLabel.get(left.node) ?? 0) - (nodeOrderByLabel.get(right.node) ?? 0);
        return order || compareJsonValue(left, right);
    });

    const dependencyByEdge = new Map();
    for (const dependency of graph.dependencies) {
        const normalized = {
            from: lookup(nodeLabels, dependency.fromNodeId, 'node'),
            to: lookup(nodeLabels, dependency.toNodeId, 'node'),
            resource: lookup(resourceLabels, dependency.resourceId, 'resource'),
            kind: dependency.kind,
        };
        const key = JSON.stringify([normalized.from, normalized.to, normalized.resource]);
        const previous = dependencyByEdge.get(key);
        // A value edge already imposes ordering. Rust exposes both facts for a
        // preserve write, while TypeScript emits only the stronger value edge.
        if (previous === undefined || normalized.kind === 'value') {
            dependencyByEdge.set(key, normalized);
        }
    }
    const dependencies = [...dependencyByEdge.values()].sort(compareJsonValue);

    const roots = graph.roots.map((root) => ({
        reason: root.reason,
        ...(root.nodeId === undefined ? {} : { node: lookup(nodeLabels, root.nodeId, 'node') }),
        ...(root.resourceId === undefined ? {} : { resource: lookup(resourceLabels, root.resourceId, 'resource') }),
    })).sort(compareJsonValue);

    const segments = graph.segments.map((segment) => ({
        order: segment.order,
        kind: segment.kind,
        nodes: segment.nodeIds.map((id) => lookup(nodeLabels, id, 'node')),
    })).sort((left, right) => left.order - right.order);

    const resourcesByAllocation = new Map();
    for (const resource of graph.resources) {
        if (resource.allocationId === undefined) continue;
        const labels = resourcesByAllocation.get(resource.allocationId) ?? [];
        labels.push(lookup(resourceLabels, resource.id, 'resource'));
        resourcesByAllocation.set(resource.allocationId, labels);
    }
    const allocationEquivalenceClasses = [...resourcesByAllocation.values()]
        .map((labels) => labels.sort())
        .sort(compareJsonValue);

    return {
        projectionVersion: 1,
        case: caseName,
        graph: {
            groups,
            nodes,
            resources,
            textureViews,
            accesses,
            dependencies,
            roots,
            segments,
        },
        memory: { allocationEquivalenceClasses },
    };
}

export function jsonDiff(expected, actual, limit = 20) {
    const differences = [];
    const visit = (left, right, path) => {
        if (differences.length >= limit || Object.is(left, right)) return;
        if (Array.isArray(left) && Array.isArray(right)) {
            const length = Math.max(left.length, right.length);
            for (let index = 0; index < length && differences.length < limit; index += 1) {
                visit(left[index], right[index], `${path}/${index}`);
            }
            return;
        }
        if (
            left !== null
            && right !== null
            && typeof left === 'object'
            && typeof right === 'object'
            && !Array.isArray(left)
            && !Array.isArray(right)
        ) {
            const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
            for (const key of keys) {
                if (differences.length >= limit) break;
                visit(left[key], right[key], `${path}/${pointerEscape(key)}`);
            }
            return;
        }
        differences.push({
            path,
            expected: left === undefined ? { $missing: true } : left,
            actual: right === undefined ? { $missing: true } : right,
        });
    };
    visit(expected, actual, '');
    return differences;
}
