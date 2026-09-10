import type { ExampleTag } from './exampleTags.ts';
import type { FrameGraphSnapshot } from '@zenfg/inspector';

export type PlaygroundPanel = 'code' | 'inspector';
export type PlaygroundExampleGroup = 'Showcases' | '@zenfg/webgpu basics';
export type PlaygroundSourceRole = 'example' | 'recipe' | 'host' | 'shader';

export type PlaygroundText = string | readonly (string | {
	readonly text: string;
	readonly emphasis?: 'strong' | 'em' | 'code';
	readonly href?: string;
})[];

export type PlaygroundSourceFile = {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly role: PlaygroundSourceRole;
	readonly language: 'typescript' | 'javascript';
	readonly loadSource: () => Promise<string>;
};

export type PlaygroundRuntime = {
	/** Requests the next real frame, waiting through preparation. Failure, suspension, or disposal must settle the request. */
	readonly captureSnapshot: () => Promise<FrameGraphSnapshot | undefined>;
	readonly dispose: () => void;
};

export type PlaygroundMountContext = {
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

export type PlaygroundExampleDefinition = {
	readonly id: string;
	readonly title: string;
	readonly group: PlaygroundExampleGroup;
	readonly tags: readonly ExampleTag[];
	readonly readyState: 'live' | 'ready';
	readonly description?: PlaygroundText;
	readonly instructions?: string;
	readonly references?: readonly { readonly label: string; readonly href: string; readonly relation: 'Adapted from' | 'Reference' }[];
	readonly graphHint?: string;
	readonly loadingNote?: string;
	readonly hasControls?: boolean;
	/** The real source file readers should open first, independent of list order. */
	readonly entrySourceId: string;
	readonly sourceFiles: readonly PlaygroundSourceFile[];
	readonly mount: (context: PlaygroundMountContext) => Promise<PlaygroundRuntime | undefined>;
};
