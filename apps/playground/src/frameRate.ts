/** Counts successful render submissions, never animation callbacks or inference runs. */
export function createFrameRate() {
	const frames: number[] = [];
	function reset(): void { frames.length = 0; }
	return {
		reset,
		/** Instantaneous FPS for the graph; the first frame only establishes a baseline. */
		record(now: number): number | undefined {
			const last = frames.at(-1);
			const elapsed = last === undefined ? undefined : now - last;
			if (elapsed === undefined || elapsed <= 0 || elapsed > 1500) {
				reset();
				frames.push(now);
				return undefined;
			}
			frames.push(now);
			// Keep the interval spanning the 500ms boundary, including at low frame rates.
			while (frames.length > 2 && frames[1]! <= now - 500) frames.shift();
			return Math.round(1000 / elapsed);
		},
		/** Average interval rate over the latest ~500ms of rendered frames. */
		sample(now: number): number | undefined {
			const last = frames.at(-1);
			if (last === undefined || now - last > 1500) { reset(); return undefined; }
			return frames.length > 1 ? Math.round((frames.length - 1) * 1000 / (last - frames[0]!)) : undefined;
		},
	};
}
