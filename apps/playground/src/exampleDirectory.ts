import type { PlaygroundExampleDefinition, PlaygroundPanel } from './types.ts';
import { routeSearch } from './routing.ts';

export function createExampleDirectory(options: {
	host: HTMLElement;
	examples: readonly Pick<PlaygroundExampleDefinition, 'id' | 'title' | 'group'>[];
	selectedId?: string;
	panel: PlaygroundPanel;
}): { setPanel: (panel: PlaygroundPanel) => void; destroy: () => void } {
	const { host, examples } = options;
	const document = host.ownerDocument;
	const caption = document.createElement('div');
	caption.className = 'directory-caption';
	caption.textContent = 'EXAMPLES / ' + examples.length;
	host.replaceChildren(caption);
	const links = new Map<string, HTMLAnchorElement>();
	for (const group of new Set(examples.map(example => example.group))) {
		const entries = examples.filter(example => example.group === group);
		const section = document.createElement('details');
		section.open = group === 'Showcases' || entries.some(example => example.id === options.selectedId);
		const summary = document.createElement('summary');
		summary.textContent = group;
		const count = document.createElement('span');
		count.textContent = String(entries.length).padStart(2, '0');
		summary.append(count);
		const list = document.createElement('div');
		list.className = 'directory-items';
		for (const example of entries) {
			const link = document.createElement('a');
			link.textContent = example.title;
			link.dataset.exampleId = example.id;
			if (example.id === options.selectedId) link.setAttribute('aria-current', 'page');
			links.set(example.id, link);
			list.append(link);
		}
		section.append(summary, list);
		host.append(section);
	}
	function setPanel(panel: PlaygroundPanel): void {
		for (const [exampleId, link] of links) link.href = routeSearch({ exampleId, panel });
	}
	setPanel(options.panel);
	return { setPanel, destroy: () => host.replaceChildren() };
}
