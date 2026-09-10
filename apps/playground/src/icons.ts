import { Moon, Sun, Maximize, Minimize, PanelLeftClose, PanelLeftOpen, Copy, Check, CircleAlert, TriangleAlert, LoaderCircle, Pause, ChevronDown, Box, CodeXml } from 'lucide';

const icons = { moon: Moon, sun: Sun, maximize: Maximize, minimize: Minimize, panelClose: PanelLeftClose, panelOpen: PanelLeftOpen, copy: Copy, check: Check, error: CircleAlert, warning: TriangleAlert, loading: LoaderCircle, pause: Pause, chevron: ChevronDown, showcase: Box, recipe: CodeXml };
type IconName = keyof typeof icons;

/** Named imports keep the app bundle limited to the icons it uses. */
export function createIcon(document: Document, name: IconName): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'ui-icon' })) svg.setAttribute(key, value);
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
