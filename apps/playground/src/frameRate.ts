/** Counts successful render submissions, never animation callbacks or inference runs. */
export function createFrameRate() {
	let first: number | undefined;
	let last: number | undefined;
	let intervals = 0;
	let value: number | undefined;
	function reset(): void { first = last = value = undefined; intervals = 0; }
	return {
		reset,
		record(now: number): void {
			if (last !== undefined && now - last > 1500) reset();
			if (first === undefined) first = now;
			else intervals++;
			last = now;
		},
		sample(now: number): number | undefined {
			if (last === undefined || now - last > 1500) { reset(); return undefined; }
			if (first !== undefined && last - first >= 500 && intervals > 0) {
				value = Math.round(intervals * 1000 / (last - first));
				first = last;
				intervals = 0;
			}
			return value;
		},
	};
}
