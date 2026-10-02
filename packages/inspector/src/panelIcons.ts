export type PanelIconName =
	| 'capture'
	| 'check'
	| 'chevron-down'
	| 'chevron-right'
	| 'close'
	| 'copy'
	| 'download'
	| 'display'
	| 'empty'
	| 'error'
	| 'external'
	| 'fit'
	| 'fit-selection'
	| 'import'
	| 'inspector'
	| 'legend'
	| 'minus'
	| 'plus'
	| 'relations'
	| 'search'
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
	'chevron-down': ['M4.5 6.25 8 9.75l3.5-3.5'],
	'chevron-right': ['M6.25 4.5 9.75 8l-3.5 3.5'],
	close: ['M4 4l8 8', 'M12 4l-8 8'],
	copy: ['M5.5 4h7.5v9H5.5z', 'M3 11V2.5h7.5'],
	download: ['M8 2.5v7', 'M5.5 7.5 8 10l2.5-2.5', 'M3 12.5h10'],
	display: ['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11', 'M5 2.5v3', 'M10.5 6.5v3', 'M6.5 10.5v3'],
	empty: ['M3 3h10v10H3z', 'M5.5 8h5'],
	error: ['M8 2.5l5.5 10H2.5z', 'M8 6v3', 'M8 11.2v.1'],
	external: ['M9 2.5h4.5V7', 'M13.5 2.5 7.5 8.5', 'M6.5 3.5h-4v10h10v-4'],
	fit: ['M6 2.5H2.5V6', 'M10 2.5h3.5V6', 'M6 13.5H2.5V10', 'M10 13.5h3.5V10'],
	'fit-selection': ['M6 2.5H2.5V6', 'M10 2.5h3.5V6', 'M6 13.5H2.5V10', 'M10 13.5h3.5V10', 'M6 6h4v4H6z'],
	import: ['M8 10V2.5', 'M5.5 5 8 2.5 10.5 5', 'M3 9.5v4h10v-4'],
	inspector: ['M2.5 3h11v10h-11z', 'M9.5 3v10'],
	legend: ['M2.5 3h2v2h-2z', 'M2.5 7h2v2h-2z', 'M2.5 11h2v2h-2z', 'M7 4h6.5', 'M7 8h6.5', 'M7 12h6.5'],
	minus: ['M3 8h10'],
	plus: ['M3 8h10', 'M8 3v10'],
	relations: ['M6.5 6.5h3v3h-3z', 'M2 2h3v3H2z', 'M11 11h3v3h-3z', 'M5 5l1.5 1.5', 'M9.5 9.5 11 11'],
	search: ['M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9', 'M10.3 10.3 13.5 13.5'],
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
	const text = document.createElement('span');
	text.className = 'zenfg-inspector-button-label';
	text.textContent = label;
	button.replaceChildren(createPanelIcon(icon), text);
	button.setAttribute('aria-label', label);
}
