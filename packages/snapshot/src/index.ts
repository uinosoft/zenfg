/**
 * Reads, validates, migrates, and writes portable ZenFG FrameGraph Snapshot
 * 1.0 documents.
 *
 * Use {@link parseFrameGraphSnapshot} for JSON text and
 * {@link decodeFrameGraphSnapshot} for already-parsed values. Both return a
 * discriminated result instead of throwing for untrusted input, and both
 * canonicalize supported legacy captures to {@link FrameGraphSnapshot}.
 *
 * @packageDocumentation
 */

export {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
} from './format.ts';
export type * from './types.ts';
export {
	FrameGraphSnapshotValidationError,
	decodeFrameGraphSnapshot,
	parseFrameGraphSnapshot,
	stringifyFrameGraphSnapshot,
	validateFrameGraphSnapshot,
} from './codec.ts';
