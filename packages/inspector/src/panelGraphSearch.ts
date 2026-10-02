import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { labelNode, labelResource } from './panelDomHelpers.ts';
import { setPanelButtonContent } from './panelIcons.ts';
import type { Selection } from './panelTypes.ts';

type SearchSelection = Extract<Selection, { kind: 'node' | 'resource' | 'group' | 'root' }>;

type SearchEntry = {
	readonly label: string;
	readonly id: string;
	readonly kind: string;
	readonly detail: string;
	readonly groupPath?: string;
	readonly text: string;
	readonly selection: SearchSelection;
};

const PASS_TYPES = {
	render: 'Render', compute: 'Compute', copy: 'Copy', 'clear-buffer': 'Clear',
	command: 'Command', 'external-submission': 'External',
};

export class GraphSearch {
	readonly root = document.createElement('div');
	private readonly toggle = document.createElement('button');
	private readonly popover = document.createElement('div');
	private readonly input = document.createElement('input');
	private readonly count = document.createElement('p');
	private readonly results = document.createElement('div');
	private entries: SearchEntry[] = [];
	private matches: SearchEntry[] = [];
	private activeIndex = -1;
	private readonly onOutside = (event: Event): void => {
		if (!event.composedPath().includes(this.root)) this.setOpen(false, false);
	};

	constructor(private readonly onReveal: (selection: Selection) => void, private readonly id: string) {
		this.root.className = 'zenfg-inspector-graph-search';
		this.toggle.type = 'button';
		setPanelButtonContent(this.toggle, 'search', 'Search');
		this.toggle.title = 'Search passes, resources, groups and outputs';
		this.toggle.setAttribute('aria-expanded', 'false');
		this.toggle.setAttribute('aria-controls', id);
		this.toggle.addEventListener('click', () => this.setOpen(this.popover.hidden !== false));
		this.popover.className = 'zenfg-inspector-graph-search-popover';
		this.popover.id = id;
		this.popover.hidden = true;
		this.input.type = 'search';
		this.input.placeholder = 'Find pass, resource, group or output';
		this.input.setAttribute('aria-label', 'Find in graph');
		this.input.setAttribute('role', 'combobox');
		this.input.setAttribute('aria-autocomplete', 'list');
		this.input.setAttribute('aria-controls', `${id}-results`);
		this.input.setAttribute('aria-expanded', 'false');
		this.count.className = 'zenfg-inspector-graph-search-count';
		this.count.setAttribute('role', 'status');
		this.count.hidden = true;
		this.results.className = 'zenfg-inspector-graph-search-results';
		this.results.id = `${id}-results`;
		this.results.setAttribute('role', 'listbox');
		this.results.setAttribute('aria-label', 'Graph search results');
		this.results.hidden = true;
		this.input.addEventListener('input', () => this.render(true));
		this.root.addEventListener('keydown', (event) => {
			if (this.popover.hidden) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.setOpen(false);
			} else if (event.target === this.input && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				event.stopPropagation();
				if (!this.matches.length) return;
				const step = event.key === 'ArrowDown' ? 1 : -1;
				const next = this.activeIndex < 0 ? (step > 0 ? 0 : this.matches.length - 1)
					: (this.activeIndex + step + this.matches.length) % this.matches.length;
				this.setActive(next, true);
			} else if (event.target === this.input && event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				const entry = this.matches[Math.max(0, this.activeIndex)];
				if (entry) this.reveal(entry);
			}
		});
		this.popover.append(this.input, this.count, this.results);
		this.root.append(this.toggle, this.popover);
	}

	private setOpen(open: boolean, restoreFocus = true): void {
		this.popover.hidden = !open;
		this.toggle.setAttribute('aria-expanded', String(open));
		this.input.setAttribute('aria-expanded', String(open));
		const ownerDocument = this.root.ownerDocument;
		if (open) {
			ownerDocument.addEventListener('pointerdown', this.onOutside, true);
			ownerDocument.addEventListener('focusin', this.onOutside);
			this.input.focus();
		} else {
			ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
			ownerDocument.removeEventListener('focusin', this.onOutside);
			this.input.value = '';
			this.matches = [];
			this.setActive(-1);
			this.count.hidden = true;
			this.results.hidden = true;
			if (restoreFocus) this.toggle.focus();
		}
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		const groupPath = (id?: string): string | undefined => id ? snapshot.groupById.get(id)?.path.join(' / ') : undefined;
		this.entries = [
			...snapshot.nodes.map((node): SearchEntry => {
				const path = groupPath(node.debugGroupId);
				return { label: labelNode(node), id: node.id, kind: 'Pass', detail: PASS_TYPES[node.kind], groupPath: path,
					text: `${node.id} ${labelNode(node)} ${PASS_TYPES[node.kind]} ${path ?? ''}`, selection: { kind: 'node', id: node.id } };
			}),
			...snapshot.resources.map((resource): SearchEntry => {
				const path = groupPath(resource.debugGroupId);
				return { label: labelResource(resource), id: resource.id, kind: 'Resource',
					detail: resource.kind === 'texture' ? 'Texture' : 'Buffer', groupPath: path,
					text: `${resource.id} ${labelResource(resource)} ${resource.kind} ${path ?? ''}`, selection: { kind: 'resource', id: resource.id } };
			}),
			...snapshot.debugGroups.map((group): SearchEntry => ({ label: group.label, id: group.id, kind: 'Group', detail: '',
				groupPath: group.path.join(' / '), text: `${group.id} ${group.path.join(' / ')}`, selection: { kind: 'group', pathKey: group.pathKey } })),
			...snapshot.roots.filter((root) => root.reason !== 'side-effect').map((root): SearchEntry => ({
				label: root.resource ? labelResource(root.resource) : root.key, id: root.resource?.id ?? root.key,
				kind: 'Output', detail: root.reason,
				text: `${root.reason} ${root.key} ${root.resource?.id ?? ''} ${root.resource?.label ?? ''}`, selection: { kind: 'root', key: root.key },
			})),
		];
		this.render();
	}

	private render(resetActive = false): void {
		const activeEntry = resetActive ? undefined : this.matches[this.activeIndex];
		const query = this.input.value.trim().toLocaleLowerCase();
		this.results.replaceChildren();
		this.results.hidden = !query;
		this.count.hidden = !query;
		this.matches = [];
		if (!query) { this.setActive(-1); return; }
		const matches = this.entries.map((entry, order) => ({ entry, order, score: matchScore(entry, query) }))
			.filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score || a.order - b.order);
		this.count.textContent = matches.length > 50 ? `Showing 50 of ${matches.length} results. Refine your search.` : `${matches.length} results`;
		this.matches = matches.slice(0, 50).map(({ entry }) => entry);
		for (const [index, entry] of this.matches.entries()) {
			const button = document.createElement('button');
			button.type = 'button';
			button.tabIndex = -1;
			button.id = `${this.id}-result-${index}`;
			button.setAttribute('role', 'option');
			button.dataset.selectionKind = entry.selection.kind;
			button.dataset.selectionId = entry.selection.kind === 'group' ? entry.selection.pathKey
				: entry.selection.kind === 'root' ? entry.selection.key : entry.selection.id;
			button.title = `Show in Graph · ${entry.label}\n${entry.id}${entry.groupPath ? `\n${entry.groupPath}` : ''}`;
			const label = document.createElement('span');
			label.className = 'zenfg-inspector-graph-search-label';
			label.textContent = entry.label;
			const metadata = document.createElement('span');
			metadata.className = 'zenfg-inspector-graph-search-metadata';
			metadata.textContent = [entry.kind, entry.detail, entry.id].filter(Boolean).join(' · ');
			button.append(label, metadata);
			if (entry.groupPath) {
				const path = document.createElement('span');
				path.className = 'zenfg-inspector-graph-search-path';
				path.textContent = entry.groupPath;
				button.append(path);
			}
			button.addEventListener('click', () => this.reveal(entry));
			this.results.append(button);
		}
		this.setActive(activeEntry ? this.matches.findIndex((entry) => sameSelection(entry.selection, activeEntry.selection)) : -1);
	}

	private setActive(index: number, scroll = false): void {
		this.activeIndex = index;
		const buttons = this.results.querySelectorAll<HTMLButtonElement>('button');
		buttons.forEach((button, position) => button.setAttribute('aria-selected', String(position === index)));
		const active = buttons[index];
		if (active) {
			this.input.setAttribute('aria-activedescendant', active.id);
			if (scroll) active.scrollIntoView({ block: 'nearest' });
		} else this.input.removeAttribute('aria-activedescendant');
	}

	private reveal(entry: SearchEntry): void {
		this.setOpen(false);
		this.onReveal(entry.selection);
	}

	destroy(): void {
		this.setOpen(false, false);
	}
}

function matchScore(entry: SearchEntry, query: string): number {
	const label = entry.label.toLocaleLowerCase();
	const id = entry.id.toLocaleLowerCase();
	if (label === query || id === query) return 0;
	if (label.startsWith(query) || id.startsWith(query)) return 1;
	if (label.includes(query) || id.includes(query)) return 2;
	return entry.text.toLocaleLowerCase().includes(query) ? 3 : Number.POSITIVE_INFINITY;
}

function sameSelection(a: SearchSelection, b: SearchSelection): boolean {
	return a.kind === b.kind && (a.kind === 'group' ? a.pathKey === (b as typeof a).pathKey
		: a.kind === 'root' ? a.key === (b as typeof a).key : a.id === (b as typeof a).id);
}
