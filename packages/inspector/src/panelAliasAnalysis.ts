import type {
    FrameGraphDebugPhysicalAllocation,
    FrameGraphDebugResource,
    FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';

export type AliasAnalysisResource = {
    readonly resource: FrameGraphDebugResource;
    readonly allocation?: FrameGraphDebugPhysicalAllocation;
    readonly aliasStatus: 'aliased' | 'single' | 'not-transient' | 'not-allocated' | 'no-lifetime';
    readonly nonAliasReasons: readonly string[];
};

export type AllocationLifetimeCoverage = {
    readonly intervals: readonly { readonly firstUse: number; readonly lastUse: number }[];
    readonly known: number;
    readonly total: number;
};

export type AliasAnalysisAllocation = {
    readonly allocation: FrameGraphDebugPhysicalAllocation;
    readonly resources: readonly FrameGraphDebugResource[];
    readonly aliases: boolean;
    readonly coverage: AllocationLifetimeCoverage;
};

export type AliasAnalysis = {
    readonly allocations: readonly AliasAnalysisAllocation[];
    readonly resources: ReadonlyMap<string, AliasAnalysisResource>;
    readonly minUse: number;
    readonly maxUse: number;
    readonly hasLifetimes: boolean;
};

// View models are immutable for the lifetime of a capture. Search and selection
// changes should not rebuild allocation membership or the execution domain.
const analysisBySnapshot = new WeakMap<FrameGraphDebugViewModel, AliasAnalysis>();

export function analyzeSnapshotAliases(snapshot: FrameGraphDebugViewModel): AliasAnalysis {
    const cached = analysisBySnapshot.get(snapshot);
    if (cached) return cached;
    const allocationById = snapshot.allocationById;
    const resourcesById = snapshot.resourceById;
    const allocationGroups = snapshot.physicalAllocations.map((allocation): AliasAnalysisAllocation => {
        const resources = allocation.resourceIds
            .map((resourceId) => resourcesById.get(resourceId))
            .filter((resource): resource is FrameGraphDebugResource => resource !== undefined);
        return {
            allocation,
            resources,
            aliases: resources.length > 1,
            coverage: allocationLifetimeCoverage(resources),
        };
    });

    const allocationGroupById = new Map(allocationGroups.map((group) => [group.allocation.id, group]));

    let minUse = Number.POSITIVE_INFINITY;
    let maxUse = Number.NEGATIVE_INFINITY;
    for (const resource of snapshot.resources) {
        // Include every displayed allocation member, even if an external origin
        // is explicitly associated with a reported allocation.
        if (!resource.lifetime || resource.origin !== 'transient' && !allocationById.has(resource.physicalResourceId ?? '')) {
            continue;
        }
        minUse = Math.min(minUse, resource.lifetime.firstUse);
        maxUse = Math.max(maxUse, resource.lifetime.lastUse);
    }
    const hasLifetimes = Number.isFinite(minUse) && Number.isFinite(maxUse);
    if (!hasLifetimes) {
        minUse = 0;
        maxUse = 0;
    }

    const resourceAnalysis = new Map<string, AliasAnalysisResource>();
    for (const resource of snapshot.resources) {
        const allocation = resource.physicalResourceId === undefined ? undefined : allocationById.get(resource.physicalResourceId);
        const allocationResources = allocation
            ? allocationGroupById.get(allocation.id)?.resources ?? []
            : [];
        const aliasStatus = resolveAliasStatus(resource, allocation, allocationResources);
        resourceAnalysis.set(resource.id, {
            resource,
            allocation,
            aliasStatus,
            nonAliasReasons: describeAliasStatus(aliasStatus),
        });
    }

    const analysis = {
        allocations: allocationGroups,
        resources: resourceAnalysis,
        minUse,
        maxUse,
        hasLifetimes,
    };
    analysisBySnapshot.set(snapshot, analysis);
    return analysis;
}

function resolveAliasStatus(
    resource: FrameGraphDebugResource,
    allocation: FrameGraphDebugPhysicalAllocation | undefined,
    allocationResources: readonly FrameGraphDebugResource[],
): AliasAnalysisResource['aliasStatus'] {
    if (resource.origin !== 'transient') {
        return 'not-transient';
    }
    if (!resource.lifetime) {
        return 'no-lifetime';
    }
    if (!allocation) {
        return 'not-allocated';
    }
    return allocationResources.length > 1 ? 'aliased' : 'single';
}

function describeAliasStatus(status: AliasAnalysisResource['aliasStatus']): readonly string[] {
    switch (status) {
        case 'not-transient': return ['Imported and surface resources do not participate in transient aliasing.'];
        case 'no-lifetime': return ['No lifetime is available for this resource in the retained graph.'];
        case 'not-allocated': return ['No physical allocation is associated with this transient resource.'];
        case 'aliased': return ['Shares a physical allocation with other logical resources.'];
        // The snapshot states allocation membership; it cannot explain allocator
        // decisions by comparing every pair of logical resources.
        case 'single': return ['This physical allocation contains one logical resource.'];
    }
}

/** Union of known logical lifetimes; gaps and unknown members are preserved. */
function allocationLifetimeCoverage(resources: readonly FrameGraphDebugResource[]): AllocationLifetimeCoverage {
    const lifetimes = resources.flatMap(resource => resource.lifetime ? [{ ...resource.lifetime }] : [])
        .sort((a, b) => a.firstUse - b.firstUse || a.lastUse - b.lastUse);
    const intervals: { firstUse: number; lastUse: number }[] = [];
    for (const lifetime of lifetimes) {
        const previous = intervals.at(-1);
        if (previous && lifetime.firstUse <= previous.lastUse + 1) previous.lastUse = Math.max(previous.lastUse, lifetime.lastUse);
        else intervals.push(lifetime);
    }
    return { intervals, known: lifetimes.length, total: resources.length };
}
