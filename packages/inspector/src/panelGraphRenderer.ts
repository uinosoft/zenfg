import type { GraphVisualTheme } from './panelVisualTheme.ts';
import type { GraphScene, GraphSceneElementId } from './panelGraphScene.ts';
import type { Selection } from './panelTypes.ts';

export type GraphRenderRequest = {
    readonly theme?: GraphVisualTheme;
    readonly onVisible?: () => void;
    readonly scene: GraphScene;
    readonly selected: Selection | undefined;
    readonly hovered: Selection | undefined;
    readonly focusRelations?: boolean;
    readonly onViewportChange?: (zoom: number) => void;
    readonly fit: boolean;
    readonly anchorElementId?: GraphSceneElementId;
    readonly reveal?: { readonly selection: Selection; readonly revision: number };
    readonly captureRevision?: number;
    readonly onSelect: (selection: Selection) => void;
    readonly onHover: (selection: Selection | undefined) => void;
    readonly onToggleGroup: (pathKey: string) => void;
};

export interface GraphRenderer {
    render(request: GraphRenderRequest): void;
    setTheme?(theme: GraphVisualTheme): void;
    resize(): void;
    fit(): void;
    zoomBy?(factor: number): void;
    resetZoom?(): void;
    fitSelection?(selection: Selection): void;
    relayout(): void;
    cancelReveal?(): void;
    destroy(): void;
}
