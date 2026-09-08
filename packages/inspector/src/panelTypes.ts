import type { GraphRenderer } from './panelGraphRenderer.ts';
import type { FrameGraphDebugEdge } from './debugCaptureModel.ts';

export type GraphFlowRelation = {
    readonly role: 'declaration' | 'value' | 'ordering' | 'output-producer' | 'output-initial';
    readonly nodeIds: readonly string[];
    readonly rootKey?: string;
    readonly dependency?: FrameGraphDebugEdge;
};

export type Selection =
    | { kind: 'node'; id: string }
    | { kind: 'group'; pathKey: string }
    | { kind: 'resource'; id: string }
    | { kind: 'root'; key: string }
    | { kind: 'culled'; id: string }
    | { kind: 'allocation'; id: string }
    | { kind: 'segment'; index: number };

export type WorkbenchTab = 'overview' | 'graph' | 'passes' | 'resources' | 'memory' | 'diagnostics';
export type PassesSubview = 'list' | 'groups';
export type InspectorTab = 'summary' | 'relations' | 'raw';

export type GraphViewState = {
    readonly host: HTMLElement;
    readonly toolbar: HTMLElement;
    readonly legend?: HTMLElement;
	readonly layoutElementBudget?: number;
    groupsEnabled: boolean;
    readonly expandedGroupPaths: Set<string>;
    renderer?: GraphRenderer;
    fitOnNextRender: boolean;
    anchorElementIdOnNextRender?: string;
    revealOnNextRender?: { readonly selection: Selection; readonly revision: number };
    captureRevision?: number;
};
