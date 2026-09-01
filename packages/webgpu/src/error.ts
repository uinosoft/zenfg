/** Stable machine-readable codes emitted by the WebGPU FrameGraph runtime. */
export const FRAME_GRAPH_ERROR_CODES = {
	ReadBeforeWrite: 'FG1001',
	PreserveBeforeWrite: 'FG1002',
	ReadAfterDiscard: 'FG1003',
	UsageMismatch: 'FG1101',
	InvalidResourceDescriptor: 'FG1102',
	InvalidTextureView: 'FG1104',
	InvalidAccess: 'FG1109',
	ForeignHandle: 'FG2001',
	UnknownHandle: 'FG2011',
	Destroyed: 'FG2006',
	RecorderConsumed: 'FG2007',
	ConcurrentExecution: 'FG2008',
	DuplicateImport: 'FG2010',
	DuplicateResourceUse: 'FG2012',
	MissingNativeBinding: 'FG4002',
	NativeDescriptorMismatch: 'FG4003',
	MissingNodeExecutor: 'FG4004',
	ExecutionDeclaration: 'FG4010',
	ExecutionResourceUnavailable: 'FG4011',
	SynchronousCallback: 'FG4012',
	Internal: 'FG9001',
} as const;

/** Error lifecycle phase exposed by the FrameGraph API. */
export type FrameGraphErrorPhase = 'record' | 'compile' | 'execute' | 'snapshot';

/** Stable error identifier. Unknown future codes remain valid to consumers. */
export type FrameGraphErrorCode = `FG${number}`;

/** Structured metadata attached to a FrameGraphError. */
export type FrameGraphErrorOptions = {
	readonly phase: FrameGraphErrorPhase;
	readonly nodeId?: number;
	readonly resourceId?: number;
	readonly context?: Readonly<Record<string, unknown>>;
	readonly cause?: unknown;
};

/**
 * A structured failure produced by the FrameGraph implementation.
 *
 * `code` and the location fields are stable diagnostic data. `message` remains
 * human-readable and may gain additional detail over time.
 */
export class FrameGraphError extends Error {
	readonly code: FrameGraphErrorCode;
	readonly phase: FrameGraphErrorPhase;
	readonly nodeId?: number;
	readonly resourceId?: number;
	readonly context?: Readonly<Record<string, unknown>>;

	constructor(code: FrameGraphErrorCode, message: string, options: FrameGraphErrorOptions) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'FrameGraphError';
		this.code = code;
		this.phase = options.phase;
		this.nodeId = options.nodeId;
		this.resourceId = options.resourceId;
		this.context = options.context;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
