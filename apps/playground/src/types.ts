import type { FrameGraphSnapshot } from '@zenfg/inspector';

export type PlaygroundPanel = 'none' | 'code' | 'inspector';
export type PlaygroundExampleGroup = 'Showcases' | '@zenfg/webgpu basics';
export type PlaygroundSourceRole = 'example' | 'recipe' | 'host' | 'shader';

export type PlaygroundSourceFile = {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly role: PlaygroundSourceRole;
	readonly language: 'typescript';
	readonly loadSource: () => Promise<string>;
};

export type PlaygroundRuntime = {
	readonly captureSnapshot: () => Promise<FrameGraphSnapshot | undefined>;
	readonly dispose: () => void;
};

export type PlaygroundMountContext = {
	readonly canvas: HTMLCanvasElement;
	readonly controlsHost: HTMLElement;
	readonly onReady: (message?: string) => void;
	readonly onError: (error: Error) => void;
};

export type PlaygroundExampleDefinition = {
	readonly id: string;
	readonly title: string;
	readonly group: PlaygroundExampleGroup;
	readonly summary: string;
	readonly readyMessage: string;
	readonly footerHint: string;
	readonly hasControls?: boolean;
	readonly sourceFiles: readonly PlaygroundSourceFile[];
	readonly mount: (context: PlaygroundMountContext) => Promise<PlaygroundRuntime | undefined>;
};
