import {
	decodeFrameGraphSnapshot,
	type FrameGraphSnapshot,
} from '@zenfg/snapshot';

import {
	createDebugViewModel,
	type FrameGraphDebugViewModel,
} from '../src/debugCaptureModel.ts';

type LegacyNode = {
	id: number;
	kind: 'render' | 'compute' | 'copy' | 'clear-buffer' | 'command' | 'external-submission';
	label?: string;
	sideEffect: boolean;
	debugGroupId?: number;
	reason?: string;
};

type LegacyResource = {
	id: number;
	kind: 'texture' | 'buffer';
	label?: string;
	origin: 'transient' | 'imported' | 'swapchain';
	usage: number;
	debugGroupId?: number;
	physicalAllocationId?: number;
	lifetime?: { firstUse: number; lastUse: number };
	descriptor?: unknown;
	estimatedByteSize?: number;
};

type LegacyAccess = {
	id: number;
	nodeId: number;
	resourceId: number;
	access: string;
	mode: 'read' | 'write';
	contents?: 'preserve' | 'overwrite';
	producesValue: boolean;
	order?: number;
	textureViewId?: number;
	textureRegion?: {
		baseMipLevel: number;
		mipLevelCount: number;
		baseArrayLayer?: number;
		arrayLayerCount?: number;
		baseDepthSlice?: number;
		depthSliceCount?: number;
		aspect: string;
	};
	bufferRange?: { offset: number; size?: number };
};

export type LegacyFrameGraphCapture = {
	readonly compilation: {
		debugGroups?: Array<{ id: number; parentId?: number; label: string }>;
		nodes: LegacyNode[];
		culledNodes: LegacyNode[];
		resources: LegacyResource[];
		accesses: LegacyAccess[];
		dependencies: Array<{
			fromNodeId: number;
			toNodeId: number;
			resourceId: number;
			kind: 'value' | 'ordering';
		}>;
		roots: Array<{ reason: string; nodeId?: number; resourceId?: number }>;
		allocations: Array<{
			id: number;
			kind: 'texture' | 'buffer';
			compatibilityClassId: number;
			estimatedByteSize?: number;
		}>;
		executionSegments: Array<{
			index: number;
			kind: 'frame-graph' | 'external-submission';
			nodeIds: number[];
		}>;
	};
	readonly gpuTiming:
		| { status: 'unavailable'; frameIndex: number; reason: string }
		| {
			status: 'available';
			frameIndex: number;
			frameDurationMicros: number;
			nodes: Array<{ nodeId: number; kind: string; durationMicros: number }>;
		};
	readonly resourcePool: {
		acquireCount: number;
		reuseCount: number;
		createdCount: number;
		retainedCount: number;
		estimatedRetainedBytes?: number;
	};
};

export function toSnapshot(capture: LegacyFrameGraphCapture): FrameGraphSnapshot {
	const decoded = decodeFrameGraphSnapshot(capture);
	if (!decoded.ok) {
		throw new Error(decoded.issues.map((issue) => `${issue.path || '/'}: ${issue.message}`).join('\n'));
	}
	return decoded.snapshot;
}

export function createLegacyDebugViewModel(capture: LegacyFrameGraphCapture): FrameGraphDebugViewModel {
	return createDebugViewModel(toSnapshot(capture));
}
