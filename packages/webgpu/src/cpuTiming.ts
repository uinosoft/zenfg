/** Internal test seam. Not a public package entrypoint. */
export const cpuClock = { now: (): number => performance.now() };
