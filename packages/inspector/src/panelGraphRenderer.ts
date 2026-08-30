import type { GraphScene, GraphSceneElementId } from './panelGraphScene.ts';
import type { Selection } from './panelTypes.ts';

export type GraphRenderRequest = {
    readonly scene: GraphScene;
    readonly selected: Selection | undefined;
    readonly hovered: Selection | undefined;
    readonly fit: boolean;
    readonly anchorElementId?: GraphSceneElementId;
    readonly onSelect: (selection: Selection) => void;
    readonly onHover: (selection: Selection | undefined) => void;
    readonly onToggleGroup: (pathKey: string) => void;
};

export interface GraphRenderer {
    render(request: GraphRenderRequest): void;
    resize(): void;
    fit(): void;
    relayout(): void;
    destroy(): void;
}
