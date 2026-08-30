export type {
	FrameGraphSnapshot,
	FrameGraphSnapshotDecodeResult,
	FrameGraphSnapshotIssue,
} from '@zenfg/snapshot';
export { FrameGraphInspector, mountFrameGraphInspector } from './FrameGraphInspector.ts';
export type { FrameGraphInspectorOptions } from './FrameGraphInspector.ts';
export { ZENFG_INSPECTOR_QUERY_PARAM, isZenFGInspectorRequested } from './query.ts';
export { ensureFrameGraphInspectorStyles } from './styles.ts';
