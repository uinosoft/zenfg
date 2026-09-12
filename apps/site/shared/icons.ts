import { Moon, Sun, Maximize, Minimize, PanelLeftClose, PanelLeftOpen, Copy, Check, CircleAlert, TriangleAlert, LoaderCircle, Pause, ChevronDown, Box, CodeXml, Menu, X, Globe, ExternalLink } from 'lucide';

// Retain the Bootstrap GitHub brand mark already used on the homepage.
const githubPath = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 3.58c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8';

const icons = {
	moon: Moon, sun: Sun, maximize: Maximize, minimize: Minimize,
	panelClose: PanelLeftClose, panelOpen: PanelLeftOpen, copy: Copy, check: Check,
	error: CircleAlert, warning: TriangleAlert,
	loading: LoaderCircle, pause: Pause, chevron: ChevronDown,
	showcase: Box, recipe: CodeXml, menu: Menu, close: X, globe: Globe,
	github: [['path', { d: githubPath }]] as const, external: ExternalLink,
};
export type IconName = keyof typeof icons;

/** Shared icon rendering for the application shells. */
export function createIcon(document: Document, name: IconName): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	for (const [key, value] of Object.entries({
		viewBox: name === 'github' ? '0 0 16 16' : '0 0 24 24', fill: name === 'github' ? 'currentColor' : 'none', stroke: name === 'github' ? 'none' : 'currentColor',
		'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
		'aria-hidden': 'true', focusable: 'false', class: 'ui-icon',
	})) svg.setAttribute(key, value);
	svg.dataset.icon = name;
	for (const [tag, attributes] of icons[name]) {
		const child = document.createElementNS(ns, tag);
		for (const [key, value] of Object.entries(attributes)) if (value !== undefined) child.setAttribute(key, String(value));
		svg.append(child);
	}
	return svg;
}

export function setIconButton(button: HTMLButtonElement, name: IconName, label: string): void {
	button.classList.add('icon-button');
	button.setAttribute('aria-label', label);
	button.title = label;
	const text = button.ownerDocument.createElement('span');
	text.className = 'sr-only';
	text.textContent = label;
	button.replaceChildren(createIcon(button.ownerDocument, name), text);
}
