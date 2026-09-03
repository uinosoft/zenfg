const pressureGainPerUnitTravel = 2.8;
const minimumChargeEfficiency = 0.14;
const minimumReleasePerSecond = 0.10;
const maximumReleasePerSecond = 0.90;

/**
 * Integrates pointer travel as pressure while continuously releasing it.
 * Higher pressure makes charging less efficient and release substantially faster.
 */
export function resolvePointerPressure(
	currentPressure: number,
	pointerTravel: number,
	deltaSeconds: number,
	reducedMotion: boolean,
): number {
	if (reducedMotion) return 0;
	const pressure = Math.min(1, Math.max(0, currentPressure));
	const travel = Math.max(0, pointerTravel);
	const elapsed = Math.max(0, deltaSeconds);
	const chargeEfficiency = 1 - (1 - minimumChargeEfficiency) * pressure ** 1.35;
	const releasePerSecond = minimumReleasePerSecond
		+ (maximumReleasePerSecond - minimumReleasePerSecond)
		* pressure ** 1.8;
	return Math.min(
		1,
		Math.max(0, pressure + travel * pressureGainPerUnitTravel * chargeEfficiency - elapsed * releasePerSecond),
	);
}
