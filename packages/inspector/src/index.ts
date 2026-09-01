/**
 * Renders a host-sized interactive workbench for live or imported ZenFG
 * FrameGraph Snapshot documents. The same component supports full-page and
 * embedded layouts.
 *
 * {@link mountFrameGraphInspector} appends the inspector to a host element and
 * returns its lifecycle controller. Call {@link FrameGraphInspector.destroy}
 * before discarding the host or replacing the inspector.
 *
 * @packageDocumentation
 */

export type {
	FrameGraphSnapshot,
	FrameGraphSnapshotDecodeResult,
	FrameGraphSnapshotIssue,
} from '@zenfg/snapshot';
export { FrameGraphInspector, mountFrameGraphInspector } from './FrameGraphInspector.ts';
export type { FrameGraphInspectorOptions } from './FrameGraphInspector.ts';
export { ZENFG_INSPECTOR_QUERY_PARAM, isZenFGInspectorRequested } from './query.ts';
export { ensureFrameGraphInspectorStyles } from './styles.ts';
