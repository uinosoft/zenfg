import type { FrameGraphSnapshot } from '@zenfg/inspector';

export type PlaygroundPanel = 'none' | 'code' | 'inspector';

export type PlaygroundSourceFile = {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly language: 'typescript';
	readonly loadSource: () => Promise<string>;
};

export type PlaygroundRuntime = {
	readonly captureSnapshot: () => Promise<FrameGraphSnapshot | undefined>;
	readonly dispose: () => void;
};

export type PlaygroundMountContext = {
	readonly canvas: HTMLCanvasElement;
	readonly onReady: () => void;
	readonly onError: (error: Error) => void;
};

export type PlaygroundExampleDefinition = {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	readonly sourceFiles: readonly PlaygroundSourceFile[];
	readonly mount: (context: PlaygroundMountContext) => Promise<PlaygroundRuntime | undefined>;
};
