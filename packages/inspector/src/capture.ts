/** Requested timing families for the next live capture; never changes imported data. */
export type FrameGraphCaptureRequest = {
	readonly timing: 'cpu' | 'gpu' | 'both';
};
