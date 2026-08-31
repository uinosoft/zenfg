import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
} from './format.ts';

/** Scalar values allowed in a JSON-compatible Snapshot extension. */
export type JsonPrimitive = string | number | boolean | null;
/** Recursively JSON-compatible data accepted by Snapshot extensions. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Stable, producer-assigned identity for an entity within one snapshot. */
export type FrameGraphSnapshotEntityId = string;
/** Command or submission behavior represented by a captured graph node. */
export type FrameGraphSnapshotNodeKind =
	| 'render'
	| 'compute'
	| 'copy'
	| 'clear-buffer'
	| 'command'
	| 'external-submission';
/** Physical resource category recorded in a snapshot. */
export type FrameGraphSnapshotResourceKind = 'texture' | 'buffer';
/** Ownership and allocation origin of a captured resource. */
export type FrameGraphSnapshotResourceOrigin = 'transient' | 'imported' | 'surface';
/** Whether a resource can be read before the graph writes it. */
export type FrameGraphSnapshotInitialContents = 'defined' | 'undefined';
/** Whether a write replaces or preserves the previous logical value. */
export type FrameGraphSnapshotWriteContents = 'overwrite' | 'preserve';
/** Portable access classification used for dependency and usage analysis. */
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
/** Portable WebGPU texture-usage flag recorded without numeric constants. */
export type FrameGraphSnapshotTextureUsageFlag =
	| 'copy-src'
	| 'copy-dst'
	| 'texture-binding'
	| 'storage-binding'
	| 'render-attachment';
/** Portable WebGPU buffer-usage flag recorded without numeric constants. */
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
/** Reason a node or final resource value was retained as a graph root. */
export type FrameGraphSnapshotRootReason =
	| 'present'
	| 'output'
	| 'readback'
	| 'side-effect'
	| 'debug-capture'
	| 'persistent-state';
/** Ownership boundary for one ordered execution segment. */
export type FrameGraphSnapshotSegmentKind = 'frame-graph' | 'external-submission';
/** Fact that could not be reconstructed while migrating an older capture. */
export type FrameGraphSnapshotUnavailableFact =
	| 'graph.groups'
	| 'graph.textureViews'
	| 'graph.nodes.recordingOrder'
	| 'graph.accesses.regions';

/** Migration provenance retained on a canonicalized legacy capture. */
export type FrameGraphSnapshotMigration = {
	readonly sourceFormat: 'legacy-v0' | 't3d-v1';
	readonly unavailableFacts: readonly FrameGraphSnapshotUnavailableFact[];
};

/** Identity of the library and runtime that produced a snapshot. */
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

/** Metadata for the frame and time represented by a snapshot. */
export type FrameGraphSnapshotCapture = {
	readonly frameIndex: number;
	readonly capturedAt?: string;
	readonly migration?: FrameGraphSnapshotMigration;
};

/** Diagnostic grouping recorded around resources and nodes. */
export type FrameGraphSnapshotGroup = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly parentId?: FrameGraphSnapshotEntityId;
	readonly label: string;
	readonly stableKey?: string;
};

/** Captured graph node with its compile retention outcome. */
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

/** Portable logical texture descriptor independent of WebGPU globals. */
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

/** Portable logical buffer descriptor independent of WebGPU globals. */
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

/** Captured logical texture or buffer and its allocation-facing metadata. */
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

/** Normalized logical texture view referenced by captured accesses. */
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

/** Normalized texture subresource interval covered by an access. */
export type FrameGraphSnapshotTextureRegion = {
	readonly baseMipLevel: number;
	readonly mipLevelCount: number;
	readonly baseArrayLayer?: number;
	readonly arrayLayerCount?: number;
	readonly baseDepthSlice?: number;
	readonly depthSliceCount?: number;
	readonly aspect: string;
};

/** Byte interval covered by a captured buffer access. */
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

/** One normalized resource access and its logical-content semantics. */
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

/** Directed value or ordering dependency between two graph nodes. */
export type FrameGraphSnapshotDependency = {
	readonly fromNodeId: FrameGraphSnapshotEntityId;
	readonly toNodeId: FrameGraphSnapshotEntityId;
	readonly resourceId: FrameGraphSnapshotEntityId;
	readonly kind: 'value' | 'ordering';
};

/** Retention marker that makes graph work externally observable. */
export type FrameGraphSnapshotRoot = {
	readonly reason: FrameGraphSnapshotRootReason;
	readonly nodeId?: FrameGraphSnapshotEntityId;
	readonly resourceId?: FrameGraphSnapshotEntityId;
};

/** Ordered FrameGraph-owned or caller-owned execution boundary. */
export type FrameGraphSnapshotSegment = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly order: number;
	readonly kind: FrameGraphSnapshotSegmentKind;
	readonly nodeIds: readonly FrameGraphSnapshotEntityId[];
};

/** Complete compiled graph projection stored in a snapshot. */
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

/** One transient physical allocation and its compatibility class. */
export type FrameGraphSnapshotAllocation = {
	readonly id: FrameGraphSnapshotEntityId;
	readonly kind: FrameGraphSnapshotResourceKind;
	readonly compatibilityClassId: FrameGraphSnapshotEntityId;
	readonly estimatedByteSize?: number;
};

/** Allocation-plan and runtime-pool diagnostics for the captured frame. */
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

/** Available per-node GPU timestamps or the reason timing was unavailable. */
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

/** Producer or runtime diagnostic attached to the captured frame. */
export type FrameGraphSnapshotDiagnostic = {
	readonly severity: 'info' | 'warning' | 'error';
	readonly code: string;
	readonly message: string;
	readonly nodeId?: FrameGraphSnapshotEntityId;
	readonly resourceId?: FrameGraphSnapshotEntityId;
};

/** Canonical, portable ZenFG FrameGraph Snapshot 1.0 document. */
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

/** Currently supported canonical snapshot document. */
export type FrameGraphSnapshot = FrameGraphSnapshotV1;

/** Structured validation or migration issue with a JSON-pointer-like path. */
export type FrameGraphSnapshotIssue = {
	readonly severity: 'warning' | 'error';
	readonly code: string;
	readonly path: string;
	readonly message: string;
};

/**
 * Result of parsing or decoding untrusted snapshot input.
 *
 * Successful legacy input has already been migrated and validated; failures
 * carry issues and never expose a partially valid snapshot.
 */
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

/** JSON formatting controls used by `stringifyFrameGraphSnapshot()`. */
export type FrameGraphSnapshotStringifyOptions = {
	/**
	 * Pretty-prints with two-space indentation.
	 *
	 * @defaultValue `false`
	 */
	readonly pretty?: boolean;
};
