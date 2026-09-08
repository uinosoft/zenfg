import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { labelNode, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';

type SearchEntry = { readonly label: string; readonly kind: string; readonly text: string; readonly selection: Selection };

export class GraphSearch {
	readonly root = document.createElement('div');
	private readonly input = document.createElement('input');
	private readonly results = document.createElement('div');
	private entries: SearchEntry[] = [];

	constructor(private readonly onReveal: (selection: Selection) => void) {
		this.root.className = 'zenfg-inspector-graph-search';
		this.input.type = 'search';
		this.input.placeholder = 'Find pass, resource, group or output';
		this.input.setAttribute('aria-label', 'Find in graph');
		this.results.className = 'zenfg-inspector-graph-search-results';
		this.results.setAttribute('aria-label', 'Graph search results');
		this.results.hidden = true;
		this.input.addEventListener('input', () => this.render());
		this.root.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && !this.results.hidden) {
				event.preventDefault();
				event.stopPropagation();
				this.input.value = '';
				this.results.hidden = true;
				this.input.focus();
			} else if (event.key === 'ArrowDown' && event.target === this.input) {
				event.preventDefault();
				this.results.querySelector('button')?.focus();
			}
		});
		this.root.append(this.input, this.results);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.entries = [
			...snapshot.nodes.map((node): SearchEntry => ({ label: labelNode(node), kind: 'Pass',
				text: `${node.id} ${labelNode(node)} ${node.debugGroupId ? snapshot.groupById.get(node.debugGroupId)?.path.join(' / ') : ''}`,
				selection: { kind: 'node', id: node.id } })),
			...snapshot.resources.map((resource): SearchEntry => ({ label: labelResource(resource), kind: 'Resource',
				text: `${resource.id} ${labelResource(resource)}`, selection: { kind: 'resource', id: resource.id } })),
			...snapshot.debugGroups.map((group): SearchEntry => ({ label: group.path.join(' / '), kind: 'Group',
				text: `${group.id} ${group.path.join(' / ')}`, selection: { kind: 'group', pathKey: group.pathKey } })),
			...snapshot.roots.filter((root) => root.reason !== 'side-effect').map((root): SearchEntry => ({
				label: `${root.reason} · ${root.resource ? labelResource(root.resource) : root.key}`, kind: 'Output',
				text: `${root.reason} ${root.resource?.id} ${root.resource?.label}`, selection: { kind: 'root', key: root.key },
			})),
		];
		this.render();
	}

	private render(): void {
		const query = this.input.value.trim().toLocaleLowerCase();
		this.results.replaceChildren();
		this.results.hidden = !query;
		if (!query) return;
		const matches = this.entries.filter((entry) => entry.text.toLocaleLowerCase().includes(query));
		const count = document.createElement('p');
		count.setAttribute('role', 'status');
		count.textContent = matches.length > 50 ? `Showing 50 of ${matches.length} results. Refine your search.` : `${matches.length} results`;
		this.results.append(count);
		for (const entry of matches.slice(0, 50)) {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = `${entry.kind} · ${entry.label}`;
			button.title = `Show in Graph · ${entry.label}`;
			button.addEventListener('click', () => {
				this.results.hidden = true;
				this.input.value = '';
				this.onReveal(entry.selection);
			});
			this.results.append(button);
		}
	}
}
