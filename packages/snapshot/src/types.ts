import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
} from './format.ts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type FrameGraphSnapshotEntityId = string;
export type FrameGraphSnapshotNodeKind =
	| 'render'
	| 'compute'
	| 'copy'
	| 'clear-buffer'
	| 'command'
	| 'external-submission';
export type FrameGraphSnapshotResourceKind = 'texture' | 'buffer';
export type FrameGraphSnapshotResourceOrigin = 'transient' | 'imported' | 'surface';
export type FrameGraphSnapshotInitialContents = 'defined' | 'undefined';
export type FrameGraphSnapshotWriteContents = 'overwrite' | 'preserve';
export type FrameGraphSnapshotAccessKind =
	| 'texture-sampled'
	| 'texture-storage-read'
	| 'texture-storage-write'
	| 'texture-color-attachment-write'
	| 'texture-depth-read'
	| 'texture-depth-write'
	| 'texture-copy-src'
	| 'texture-copy-dst'
	| 'buffer-uniform'
	| 'buffer-storage-read'
	| 'buffer-storage-write'
	| 'buffer-vertex'
	| 'buffer-index'
	| 'buffer-indirect'
	| 'buffer-copy-src'
	| 'buffer-copy-dst';
export type FrameGraphSnapshotTextureUsageFlag =
	| 'copy-src'
	| 'copy-dst'
	| 'texture-binding'
	| 'storage-binding'
	| 'render-attachment';
export type FrameGraphSnapshotBufferUsageFlag =
	| 'map-read'
	| 'map-write'
	| 'copy-src'
	| 'copy-dst'
	| 'index'
	| 'vertex'
	| 'uniform'
	| 'storage'
	| 'indirect'
	| 'query-resolve';
export type FrameGraphSnapshotRootReason =
	| 'present'
	| 'output'
	| 'readback'
	| 'side-effect'
	| 'debug-capture'
	| 'persistent-state';
export type FrameGraphSnapshotSegmentKind = 'frame-graph' | 'external-submission';
export type FrameGraphSnapshotUnavailableFact =
	| 'graph.groups'
	| 'graph.textureViews'
	| 'graph.nodes.recordingOrder'
	| 'graph.accesses.regions';

export type FrameGraphSnapshotMigration = {
	readonly sourceFormat: 'legacy-v0' | 't3d-v1';
	readonly unavailableFacts: readonly FrameGraphSnapshotUnavailableFact[];
};

export type FrameGraphSnapshotProducer = {
	readonly name: string;
	readonly version?: string;
	readonly language?: string;
	readonly runtime?: {
		readonly implementation?: string;
		readonly graphicsApi?: string;
		readonly backend?: string;
	};
};

export type FrameGraphSnapshotCapture = {
	readonly frameIndex: number;
	readonly capturedAt?: string;
	readonly migration?: FrameGraphSnapshotMigration;
};

export type FrameGraphSnapshotGroup = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly parentId?: FrameGraphSnapshotEntityId;
	readonly label: string;
	readonly stableKey?: string;
};

export type FrameGraphSnapshotNode = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly stableKey?: string;
	/** Omitted only when an older producer did not preserve recording order. */
	readonly recordingOrder?: number;
	readonly kind: FrameGraphSnapshotNodeKind;
	readonly label?: string;
	readonly sideEffect: boolean;
	readonly groupId?: FrameGraphSnapshotEntityId;
	readonly compileState:
		| {
			readonly status: 'retained';
			readonly executionOrder: number;
		}
		| {
			readonly status: 'culled';
			readonly reason: string;
		};
};

export type FrameGraphSnapshotTextureDescriptor = {
	readonly kind: 'texture';
	readonly format: string;
	readonly size: {
		readonly width: number;
		readonly height: number;
		readonly depthOrArrayLayers: number;
	};
	readonly dimension: string;
	readonly mipLevelCount: number;
	readonly sampleCount: number;
	readonly viewFormats: readonly string[];
};

export type FrameGraphSnapshotBufferDescriptor = {
	readonly kind: 'buffer';
	readonly size: number;
};

type FrameGraphSnapshotResourceBase = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly stableKey?: string;
	readonly label?: string;
	readonly origin: FrameGraphSnapshotResourceOrigin;
	/** Omitted only when migration could not recover imported initial state. */
	readonly initialContents?: FrameGraphSnapshotInitialContents;
	readonly groupId?: FrameGraphSnapshotEntityId;
	readonly lifetime?: {
		readonly firstUse: number;
		readonly lastUse: number;
	};
	readonly allocationId?: FrameGraphSnapshotEntityId;
	readonly estimatedByteSize?: number;
};

export type FrameGraphSnapshotResource = FrameGraphSnapshotResourceBase & (
	| {
		readonly kind: 'texture';
		readonly descriptor?: FrameGraphSnapshotTextureDescriptor;
		readonly usageFlags: readonly FrameGraphSnapshotTextureUsageFlag[];
	}
	| {
		readonly kind: 'buffer';
		readonly descriptor?: FrameGraphSnapshotBufferDescriptor;
		readonly usageFlags: readonly FrameGraphSnapshotBufferUsageFlag[];
	}
);

export type FrameGraphSnapshotTextureView = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly stableKey?: string;
	readonly resourceId: FrameGraphSnapshotEntityId;
	readonly label?: string;
	readonly format: string;
	readonly dimension: string;
	readonly aspect: string;
	readonly baseMipLevel: number;
	readonly mipLevelCount: number;
	readonly baseArrayLayer: number;
	readonly arrayLayerCount: number;
	readonly swizzle: string;
};

export type FrameGraphSnapshotTextureRegion = {
	readonly baseMipLevel: number;
	readonly mipLevelCount: number;
	readonly baseArrayLayer?: number;
	readonly arrayLayerCount?: number;
	readonly baseDepthSlice?: number;
	readonly depthSliceCount?: number;
	readonly aspect: string;
};

export type FrameGraphSnapshotBufferRange = {
	readonly offset: number;
	readonly size?: number;
};

type FrameGraphSnapshotAccessBase = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly nodeId: FrameGraphSnapshotEntityId;
	readonly resourceId: FrameGraphSnapshotEntityId;
	readonly access: FrameGraphSnapshotAccessKind;
	readonly textureViewId?: FrameGraphSnapshotEntityId;
	readonly textureRegion?: FrameGraphSnapshotTextureRegion;
	readonly bufferRange?: FrameGraphSnapshotBufferRange;
};

export type FrameGraphSnapshotAccess = FrameGraphSnapshotAccessBase & (
	| {
		readonly mode: 'read';
		readonly producesValue: false;
		readonly contents?: never;
	}
	| {
		readonly mode: 'write';
		readonly contents: FrameGraphSnapshotWriteContents;
		readonly producesValue: boolean;
	}
);

export type FrameGraphSnapshotDependency = {
	readonly fromNodeId: FrameGraphSnapshotEntityId;
	readonly toNodeId: FrameGraphSnapshotEntityId;
	readonly resourceId: FrameGraphSnapshotEntityId;
	readonly kind: 'value' | 'ordering';
};

export type FrameGraphSnapshotRoot = {
	readonly reason: FrameGraphSnapshotRootReason;
	readonly nodeId?: FrameGraphSnapshotEntityId;
	readonly resourceId?: FrameGraphSnapshotEntityId;
};

export type FrameGraphSnapshotSegment = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly order: number;
	readonly kind: FrameGraphSnapshotSegmentKind;
	readonly nodeIds: readonly FrameGraphSnapshotEntityId[];
};

export type FrameGraphSnapshotGraph = {
	readonly groups: readonly FrameGraphSnapshotGroup[];
	readonly nodes: readonly FrameGraphSnapshotNode[];
	readonly resources: readonly FrameGraphSnapshotResource[];
	readonly textureViews: readonly FrameGraphSnapshotTextureView[];
	readonly accesses: readonly FrameGraphSnapshotAccess[];
	readonly dependencies: readonly FrameGraphSnapshotDependency[];
	readonly roots: readonly FrameGraphSnapshotRoot[];
	readonly segments: readonly FrameGraphSnapshotSegment[];
};

export type FrameGraphSnapshotAllocation = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly kind: FrameGraphSnapshotResourceKind;
	readonly compatibilityClassId: FrameGraphSnapshotEntityId;
	readonly estimatedByteSize?: number;
};

export type FrameGraphSnapshotMemory = {
	readonly allocationReport:
		| {
			readonly status: 'available';
			readonly allocations: readonly FrameGraphSnapshotAllocation[];
		}
		| {
			readonly status: 'unavailable';
			readonly reason: string;
		};
	readonly poolReport:
		| {
			readonly status: 'available';
			readonly acquireCount: number;
			readonly reuseCount: number;
			readonly createdCount: number;
			readonly retainedCount: number;
			readonly estimatedRetainedBytes?: number;
		}
		| {
			readonly status: 'unavailable';
			readonly reason: string;
		};
};

export type FrameGraphSnapshotGpuTimings =
	| {
		readonly status: 'available';
		readonly frameSpanMicros: number;
		readonly nodes: readonly {
			readonly nodeId: FrameGraphSnapshotEntityId;
			readonly durationMicros: number;
		}[];
	}
	| {
		readonly status: 'unavailable';
		readonly reason: string;
	};

export type FrameGraphSnapshotDiagnostic = {
	readonly severity: 'info' | 'warning' | 'error';
	readonly code: string;
	readonly message: string;
	readonly nodeId?: FrameGraphSnapshotEntityId;
	readonly resourceId?: FrameGraphSnapshotEntityId;
};

export type FrameGraphSnapshotV1 = {
	readonly format: typeof FRAME_GRAPH_SNAPSHOT_FORMAT;
	readonly version: typeof FRAME_GRAPH_SNAPSHOT_VERSION;
	readonly producer: FrameGraphSnapshotProducer;
	readonly capture: FrameGraphSnapshotCapture;
	readonly graph: FrameGraphSnapshotGraph;
	readonly memory: FrameGraphSnapshotMemory;
	readonly timings: {
		readonly gpu: FrameGraphSnapshotGpuTimings;
	};
	readonly diagnostics: readonly FrameGraphSnapshotDiagnostic[];
	readonly extensions: Readonly<Record<string, JsonValue>>;
};

export type FrameGraphSnapshot = FrameGraphSnapshotV1;

export type FrameGraphSnapshotIssue = {
	readonly severity: 'warning' | 'error';
	readonly code: string;
	readonly path: string;
	readonly message: string;
};

export type FrameGraphSnapshotDecodeResult =
	| {
		readonly ok: true;
		readonly snapshot: FrameGraphSnapshot;
		readonly source: 'v1' | 'legacy-v0' | 't3d-v1';
		readonly migrated: boolean;
		readonly issues: readonly FrameGraphSnapshotIssue[];
	}
	| {
		readonly ok: false;
		readonly issues: readonly FrameGraphSnapshotIssue[];
	};

export type FrameGraphSnapshotStringifyOptions = {
	readonly pretty?: boolean;
};
