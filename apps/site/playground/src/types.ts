import type { SiteThemeController } from '../../shared/theme/controller.ts';
import type { ExampleTag } from './exampleTags.ts';
import type { FrameGraphSnapshot } from '@zenfg/inspector';

export type ExamplesPanel = 'code' | 'inspector';
export type ExamplesExampleGroup = 'Showcases' | '@zenfg/webgpu basics';
export type ExamplesSourceRole = 'example' | 'recipe' | 'host' | 'shader';

export type ExamplesText = string | readonly (string | {
	readonly text: string;
	readonly emphasis?: 'strong' | 'em' | 'code';
	readonly href?: string;
})[];

export type ExamplesSourceFile = {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly role: ExamplesSourceRole;
	readonly language: 'typescript' | 'javascript';
	readonly loadSource: () => Promise<string>;
};

export type ExamplesRuntime = {
	/** Requests the next real frame, waiting through preparation. Failure, suspension, or disposal must settle the request. */
	readonly captureSnapshot: () => Promise<FrameGraphSnapshot | undefined>;
	readonly dispose: () => void;
};

export type ExamplesMountContext = {
	readonly theme?: Pick<SiteThemeController, 'get' | 'subscribe'>;
	readonly signal?: AbortSignal;
	readonly onLoading?: (message: string) => void;
	/** Optional telemetry from a successfully submitted example frame. */
	readonly onFrame?: () => void;
	readonly onPaused?: (paused: boolean) => void;
	/** Nonfatal runtime limitation; pass undefined to clear. */
	readonly onWarning?: (message?: string) => void;
	readonly canvas: HTMLCanvasElement;
	readonly controlsHost: HTMLElement;
	readonly onReady: (message?: string) => void;
	readonly onError: (error: Error) => void;
};

export type ExamplesExampleDefinition = {
	readonly id: string;
	readonly title: string;
	readonly group: ExamplesExampleGroup;
	readonly tags: readonly ExampleTag[];
	readonly readyState: 'live' | 'ready';
	/** Description, gestures, and inspection guidance displayed together below the canvas. */
	readonly description?: ExamplesText;
	readonly references?: readonly { readonly label: string; readonly href: string; readonly relation: 'Adapted from' | 'Reference' }[];
	readonly loadingNote?: string;
	readonly hasControls?: boolean;
	/** The real source file readers should open first, independent of list order. */
	readonly entrySourceId: string;
	readonly sourceFiles: readonly ExamplesSourceFile[];
	readonly mount: (context: ExamplesMountContext) => Promise<ExamplesRuntime | undefined>;
};
