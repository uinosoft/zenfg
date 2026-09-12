/** Convert canonical semantic tokens to the CSS names shared by bootstrap and runtime. */
export function cssThemeProperties(tokens: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(tokens)
		.map(([key, value]) => [`--zenfg-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value]));
}
