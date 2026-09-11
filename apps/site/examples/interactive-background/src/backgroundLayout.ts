const desktopPixelBudget = 3_600_000;
const mobilePixelBudget = 1_500_000;

export type CanvasDimensions = {
	readonly width: number;
	readonly height: number;
	readonly fieldWidth: number;
	readonly fieldHeight: number;
	readonly bloomWidth: number;
	readonly bloomHeight: number;
};

export function resolveCanvasDimensions(
	cssWidth: number,
	cssHeight: number,
	devicePixelRatio: number,
	coarsePointer: boolean,
	fieldDownsample: number,
): CanvasDimensions {
	const safeWidth = Math.max(1, cssWidth);
	const safeHeight = Math.max(1, cssHeight);
	const preferredRatio = Math.min(devicePixelRatio || 1, coarsePointer ? 1 : 1.5);
	const pixelBudget = coarsePointer ? mobilePixelBudget : desktopPixelBudget;
	const budgetScale = Math.min(1, Math.sqrt(pixelBudget / (safeWidth * safeHeight * preferredRatio * preferredRatio)));
	const ratio = preferredRatio * budgetScale;
	const width = Math.max(1, Math.floor(safeWidth * ratio));
	const height = Math.max(1, Math.floor(safeHeight * ratio));
	return {
		width,
		height,
		fieldWidth: Math.max(1, Math.ceil(width / fieldDownsample)),
		fieldHeight: Math.max(1, Math.ceil(height / fieldDownsample)),
		bloomWidth: Math.max(1, Math.ceil(width / 2)),
		bloomHeight: Math.max(1, Math.ceil(height / 2)),
	};
}
