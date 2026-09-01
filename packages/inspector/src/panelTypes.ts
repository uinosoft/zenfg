import type { GraphRenderer } from './panelGraphRenderer.ts';

export type Selection =
    | { kind: 'node'; id: string }
    | { kind: 'group'; pathKey: string }
    | { kind: 'resource'; id: string }
    | { kind: 'root'; index: number }
    | { kind: 'culled'; index: number }
    | { kind: 'allocation'; id: string }
    | { kind: 'segment'; index: number };

export type WorkbenchTab = 'overview' | 'graph' | 'passes' | 'resources' | 'memory' | 'diagnostics';
export type PassesSubview = 'list' | 'groups';
export type InspectorTab = 'summary' | 'relations' | 'raw';
export type GraphViewMode = 'passes' | 'resources';

export type GraphViewState = {
    readonly host: HTMLElement;
    readonly toolbar: HTMLElement;
    readonly legend?: HTMLElement;
	readonly layoutElementBudget?: number;
    graphMode: GraphViewMode;
    groupsEnabled: boolean;
    readonly expandedGroupPaths: Set<string>;
    renderer?: GraphRenderer;
    fitOnNextRender: boolean;
    anchorElementIdOnNextRender?: string;
};
