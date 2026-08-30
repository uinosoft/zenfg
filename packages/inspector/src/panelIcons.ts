export type PanelIconName =
	| 'capture'
	| 'check'
	| 'close'
	| 'copy'
	| 'empty'
	| 'error'
	| 'fit'
	| 'inspector'
	| 'relayout'
	| 'spinner'
	| 'waiting';

const ICON_PATHS: Record<PanelIconName, readonly string[]> = {
	capture: [
		'M6 2.5H2.5V6',
		'M10 2.5h3.5V6',
		'M6 13.5H2.5V10',
		'M10 13.5h3.5V10',
		'M8 6.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5',
	],
	check: ['M3 8.2 6.3 11.5 13 4.8'],
	close: ['M4 4l8 8', 'M12 4l-8 8'],
	copy: ['M5.5 4h7.5v9H5.5z', 'M3 11V2.5h7.5'],
	empty: ['M3 3h10v10H3z', 'M5.5 8h5'],
	error: ['M8 2.5l5.5 10H2.5z', 'M8 6v3', 'M8 11.2v.1'],
	fit: ['M6 2.5H2.5V6', 'M10 2.5h3.5V6', 'M6 13.5H2.5V10', 'M10 13.5h3.5V10'],
	inspector: ['M2.5 3h11v10h-11z', 'M9.5 3v10'],
	relayout: ['M13.5 5.5V2.8l-1.7 1.7A5.8 5.8 0 1 0 13.4 10', 'M2.5 10.5v2.7l1.7-1.7'],
	spinner: ['M13 8a5 5 0 1 1-2-4'],
	waiting: ['M5.5 5v6', 'M10.5 5v6'],
};

export function createPanelIcon(name: PanelIconName): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('zenfg-inspector-control-icon');
	svg.dataset.icon = name;
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '14');
	svg.setAttribute('height', '14');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	for (const data of ICON_PATHS[name]) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', data);
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', 'currentColor');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		path.setAttribute('stroke-width', '1.4');
		svg.appendChild(path);
	}
	return svg;
}

export function setPanelButtonContent(button: HTMLButtonElement, icon: PanelIconName, label: string): void {
	button.replaceChildren(createPanelIcon(icon), document.createTextNode(label));
}
