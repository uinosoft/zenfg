import { createIcon } from './icons.ts';
import type { ExamplesExampleDefinition, ExamplesPanel } from './types.ts';
import { routeSearch } from './routing.ts';

export function createExampleDirectory(options: {
	host: HTMLElement;
	examples: readonly Pick<ExamplesExampleDefinition, 'id' | 'title' | 'group'>[];
	selectedId?: string;
	panel: ExamplesPanel;
}): { setPanel: (panel: ExamplesPanel) => void; destroy: () => void } {
	const { host, examples } = options;
	const document = host.ownerDocument;
	host.replaceChildren();
	const links = new Map<string, HTMLAnchorElement>();
	const search = document.createElement('input');
	search.type = 'search';
	search.className = 'directory-search';
	search.placeholder = 'Filter examples…';
	search.setAttribute('aria-label', 'Filter examples');
	const empty = document.createElement('p');
	empty.className = 'directory-empty';
	empty.textContent = 'No matching examples.';
	empty.setAttribute('role', 'status');
	empty.hidden = true;
	host.append(search);
	const sections: HTMLDetailsElement[] = [];
	const previousOpen = new Map<HTMLDetailsElement, boolean>();
	let filtering = false;
	for (const group of new Set(examples.map(example => example.group))) {
		const entries = examples.filter(example => example.group === group);
		const section = document.createElement('details');
		section.open = group === 'Showcases' || entries.some(example => example.id === options.selectedId);
		const summary = document.createElement('summary');
		summary.textContent = group;
		const list = document.createElement('div');
		list.className = 'directory-items';
		for (const example of entries) {
			const link = document.createElement('a');
			const label = document.createElement('span');
			label.textContent = example.title;
			link.append(createIcon(document, group === 'Showcases' ? 'showcase' : 'recipe'), label);
			link.dataset.exampleId = example.id;
			if (example.id === options.selectedId) link.setAttribute('aria-current', 'page');
			links.set(example.id, link);
			list.append(link);
		}
		section.append(summary, list);
		host.append(section);
		sections.push(section);
	}
	host.append(empty);
	const filter = () => {
		const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const active = terms.length > 0;
		if (active && !filtering) for (const section of sections) previousOpen.set(section, section.open);
		let count = 0;
		for (const example of examples) {
			const text = [example.title, example.id, example.group].join(' ').toLowerCase();
			const match = terms.every(term => text.includes(term));
			links.get(example.id)!.hidden = !match;
			if (match) count++;
		}
		for (const section of sections) {
			section.hidden = ![...section.querySelectorAll('a')].some(link => !link.hidden);
			if (active) section.open = !section.hidden;
			else if (filtering) section.open = previousOpen.get(section) ?? section.open;
		}
		empty.hidden = count !== 0;
		filtering = active;
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && search.value) { event.preventDefault(); search.value = ''; filter(); }
	};
	search.addEventListener('input', filter);
	search.addEventListener('keydown', keydown);
	function setPanel(panel: ExamplesPanel): void {
		for (const [exampleId, link] of links) link.href = routeSearch({ exampleId, panel, full: false });
	}
	setPanel(options.panel);
	return { setPanel, destroy: () => { search.removeEventListener('input', filter); search.removeEventListener('keydown', keydown); host.replaceChildren(); } };
}
