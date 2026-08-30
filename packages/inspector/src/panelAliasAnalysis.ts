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

export type AliasAnalysisAllocation = {
    readonly allocation: FrameGraphDebugPhysicalAllocation;
    readonly resources: readonly FrameGraphDebugResource[];
    readonly aliases: boolean;
};

export type AliasAnalysis = {
    readonly allocations: readonly AliasAnalysisAllocation[];
    readonly resources: ReadonlyMap<string, AliasAnalysisResource>;
    readonly minUse: number;
    readonly maxUse: number;
};

export function analyzeSnapshotAliases(snapshot: FrameGraphDebugViewModel): AliasAnalysis {
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
        };
    });

    const allocationGroupById = new Map(allocationGroups.map((group) => [group.allocation.id, group]));

    let minUse = Number.POSITIVE_INFINITY;
    let maxUse = Number.NEGATIVE_INFINITY;
    for (const resource of snapshot.resources) {
        if (!resource.lifetime) {
            continue;
        }
        minUse = Math.min(minUse, resource.lifetime.firstUse);
        maxUse = Math.max(maxUse, resource.lifetime.lastUse);
    }
    if (!Number.isFinite(minUse) || !Number.isFinite(maxUse)) {
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
            nonAliasReasons: resolveNonAliasReasons(resource, allocation, allocationGroups),
        });
    }

    return {
        allocations: allocationGroups,
        resources: resourceAnalysis,
        minUse,
        maxUse,
    };
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

function resolveNonAliasReasons(
    resource: FrameGraphDebugResource,
    allocation: FrameGraphDebugPhysicalAllocation | undefined,
    allocations: readonly AliasAnalysisAllocation[],
): readonly string[] {
    if (resource.origin !== 'transient') {
        return ['Imported or swapchain resources do not participate in transient aliasing.'];
    }
    if (!resource.lifetime) {
        return ['No lifetime is available for this resource in the retained graph.'];
    }
    if (!allocation) {
        return ['No physical allocation is associated with this transient resource.'];
    }

    const reasons = new Set<string>();
    for (const group of allocations) {
        if (group.allocation.id === allocation.id) {
            continue;
        }
        for (const other of group.resources) {
            if (other.id === resource.id || other.origin !== 'transient') {
                continue;
            }
            if (other.kind !== resource.kind) {
                reasons.add(`Different kind from ${labelDebugResource(other)}.`);
                continue;
            }
            if (group.allocation.compatibilityClassId !== allocation.compatibilityClassId) {
                reasons.add(`Different compatibility class from ${labelDebugResource(other)}.`);
                continue;
            }
            if (!other.lifetime) {
                reasons.add(`Missing lifetime for ${labelDebugResource(other)}.`);
                continue;
            }
            if (lifetimesOverlap(resource.lifetime, other.lifetime)) {
                reasons.add(`Lifetime overlaps ${labelDebugResource(other)} (${other.lifetime.firstUse}-${other.lifetime.lastUse}).`);
            }
        }
    }

    if (reasons.size === 0) {
        return allocationResourcesFor(allocations, allocation.id).length > 1
            ? ['Aliases with resources in the same physical allocation.']
            : ['No compatible non-overlapping transient resource was found in this snapshot.'];
    }

    return Array.from(reasons).slice(0, 6);
}

function allocationResourcesFor(
    allocations: readonly AliasAnalysisAllocation[],
    allocationId: string,
): readonly FrameGraphDebugResource[] {
    return allocations.find((group) => group.allocation.id === allocationId)?.resources ?? [];
}

function lifetimesOverlap(
    a: NonNullable<FrameGraphDebugResource['lifetime']>,
    b: NonNullable<FrameGraphDebugResource['lifetime']>,
): boolean {
    return a.firstUse <= b.lastUse && b.firstUse <= a.lastUse;
}

function labelDebugResource(resource: FrameGraphDebugResource): string {
    return resource.label ?? `${resource.kind}-${resource.id}`;
}
