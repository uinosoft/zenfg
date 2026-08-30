export const FRAME_GRAPH_SNAPSHOT_FORMAT = 'zenfg.frame-graph-snapshot' as const;

/** Accepted pre-release V1 candidate identifier. Never emitted by ZenFG. */
export const T3D_FRAME_GRAPH_SNAPSHOT_FORMAT = 't3d.frame-graph-snapshot' as const;

export const FRAME_GRAPH_SNAPSHOT_VERSION = Object.freeze({
	major: 1,
	minor: 0,
} as const);
