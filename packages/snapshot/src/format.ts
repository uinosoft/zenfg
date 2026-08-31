/**
 * Stable format and version identifiers for Snapshot producers that do not
 * need the codec or wire-model types from the primary package entrypoint.
 *
 * @packageDocumentation
 */

/** Canonical `format` discriminator emitted by ZenFG Snapshot 1.0 producers. */
export const FRAME_GRAPH_SNAPSHOT_FORMAT = 'zenfg.frame-graph-snapshot' as const;

/** Accepted pre-release V1 candidate identifier. Never emitted by ZenFG. */
export const LEGACY_CANDIDATE_FRAME_GRAPH_SNAPSHOT_FORMAT = 'zenfg.frame-graph-snapshot-candidate' as const;

/** Supported canonical Snapshot schema version. */
export const FRAME_GRAPH_SNAPSHOT_VERSION = Object.freeze({
	major: 1,
	minor: 0,
} as const);

/**
 * Maximum number of nested object/array containers in one extension value.
 * Primitive roots have depth zero; an object or array root has depth one.
 */
export const FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH = 64 as const;
