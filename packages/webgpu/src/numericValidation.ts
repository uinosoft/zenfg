const UINT32_MAX = 0xffff_ffff;

function received(value: number): string {
	return Object.is(value, -0) ? '-0' : String(value);
}

export function assertNonNegativeSafeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${field} must be a non-negative safe integer. Received ${received(value)}.`);
	}
}

export function assertNonNegativeUint32(value: number, field: string): void {
	if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
		throw new Error(`${field} must be a non-negative uint32 integer. Received ${received(value)}.`);
	}
}

export function assertPositiveUint32(value: number, field: string): void {
	if (!Number.isInteger(value) || value <= 0 || value > UINT32_MAX) {
		throw new Error(`${field} must be a positive uint32 integer. Received ${received(value)}.`);
	}
}
