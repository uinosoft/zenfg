import type { PlaygroundText } from './types.ts';

function safeLink(href: string): boolean {
	try { return ['https:', 'http:'].includes(new URL(href).protocol); }
	catch { return false; }
}

/** Render a small inline vocabulary without interpreting HTML from example metadata. */
export function renderExampleText(host: HTMLElement, value: PlaygroundText): void {
	const document = host.ownerDocument;
	host.replaceChildren();
	for (const part of typeof value === 'string' ? [value] : value) {
		if (typeof part === 'string') { host.append(document.createTextNode(part)); continue; }
		const text = document.createElement(part.emphasis ?? 'span');
		text.textContent = part.text;
		if (part.href && safeLink(part.href)) {
			const link = document.createElement('a');
			link.href = part.href;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.append(text);
			host.append(link);
		} else host.append(text);
	}
}
