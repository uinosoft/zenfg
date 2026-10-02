import type { SelectedCanonicalDetail } from './panelSelection.ts';
import { createIconAction, createSearchInput, writeClipboardText } from './panelWorkbenchHelpers.ts';

/** Created only when Raw is visited and retained for the current object/capture. */
export class RawDetailView {
	readonly root = document.createElement('div');
	private readonly tree = document.createElement('div');
	private readonly status = document.createElement('span');
	private readonly expanded = new Set<string>(['$']);
	private query = '';
	private readonly json: string;

	constructor(private readonly detail: SelectedCanonicalDetail, migrated: boolean) {
		this.root.className = 'zenfg-inspector-raw-view';
		this.json = JSON.stringify(detail.value, null, 2);
		const path = document.createElement('code');
		path.className = 'zenfg-inspector-raw-path';
		path.textContent = detail.path;
		const toolbar = document.createElement('div');
		toolbar.className = 'zenfg-inspector-raw-toolbar';
		const search = createSearchInput('Search Raw fields or values', '', (value) => {
			this.query = value.trim().toLocaleLowerCase();
			this.renderTree();
		});
		search.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !search.value) return;
			search.value = '';
			this.query = '';
			this.renderTree();
			event.preventDefault();
			event.stopPropagation();
		});
		const copy = createIconAction('copy', 'Copy object', () => {
			void writeClipboardText(this.json).then(() => {
				this.status.textContent = 'Copied complete object';
			}, () => {
				this.status.textContent = 'Copy failed. Select the Raw fields to copy manually.';
			});
		});
		copy.title = 'Copy the complete canonical object, including fields hidden by search';
		this.status.setAttribute('role', 'status');
		this.status.className = 'zenfg-inspector-muted';
		toolbar.append(search, copy);
		this.tree.className = 'zenfg-inspector-raw-detail';
		this.tree.setAttribute('aria-label', 'Canonical object fields');
		this.root.append(path, toolbar, this.status);
		if (migrated) {
			const note = document.createElement('p');
			note.className = 'zenfg-inspector-muted';
			note.textContent = 'Legacy import: showing the migrated canonical Snapshot object.';
			this.root.appendChild(note);
		}
		this.root.appendChild(this.tree);
		this.renderTree();
	}

	private renderTree(): void {
		this.tree.replaceChildren();
		const node = this.createValue('$', this.detail.value, '$', false);
		if (node) this.tree.appendChild(node);
		else this.tree.textContent = 'No matching fields or values.';
	}

	private createValue(key: string, value: unknown, path: string, includeChildren: boolean): HTMLElement | undefined {
		const keyMatches = key.toLocaleLowerCase().includes(this.query);
		const matched = !this.query || includeChildren || keyMatches;
		if (typeof value !== 'object' || value === null) {
			const literal = JSON.stringify(value) ?? 'undefined';
			if (!matched && !literal.toLocaleLowerCase().includes(this.query)) return undefined;
			const leaf = document.createElement('div');
			leaf.className = 'zenfg-inspector-raw-leaf';
			this.appendHighlighted(leaf, `${key}: ${literal}`);
			return leaf;
		}
		const entries = Object.entries(value);
		const children = entries.flatMap(([childKey, childValue]) => {
			const child = this.createValue(childKey, childValue, `${path}.${childKey}`, matched);
			return child ? [child] : [];
		});
		if (this.query && !matched && children.length === 0) return undefined;
		const group = document.createElement('details');
		const summary = document.createElement('summary');
		this.appendHighlighted(summary, `${key}: ${Array.isArray(value) ? `[${entries.length} items]` : `{${entries.length} fields}`}`);
		group.open = Boolean(this.query) || this.expanded.has(path);
		group.addEventListener('toggle', () => {
			if (this.query || !this.tree.contains(group)) return;
			if (group.open) this.expanded.add(path);
			else this.expanded.delete(path);
		});
		const body = document.createElement('div');
		body.className = 'zenfg-inspector-raw-children';
		body.append(...children);
		group.append(summary, body);
		return group;
	}

	private appendHighlighted(parent: HTMLElement, text: string): void {
		if (!this.query) { parent.textContent = text; return; }
		const lower = text.toLocaleLowerCase();
		const ranges: [number, number][] = [];
		if (lower.length !== text.length) {
			// Map expanded case folds back to the original text, keeping combining marks with their base.
			for (const part of text.matchAll(/.\p{M}*/gsu)) {
				const range: [number, number] = [part.index, part.index + part[0].length];
				for (let i = 0; i < part[0].toLocaleLowerCase().length; i++) ranges.push(range);
			}
		}
		let start = 0;
		let index = lower.indexOf(this.query);
		while (index !== -1) {
			const end = index + this.query.length;
			const sourceStart = ranges[index]?.[0] ?? index;
			const sourceEnd = ranges[end - 1]?.[1] ?? end;
			if (sourceStart >= start) {
				parent.appendChild(document.createTextNode(text.slice(start, sourceStart)));
				const match = document.createElement('mark');
				match.className = 'zenfg-inspector-raw-match';
				match.textContent = text.slice(sourceStart, sourceEnd);
				parent.appendChild(match);
				start = sourceEnd;
			}
			index = lower.indexOf(this.query, end);
		}
		parent.appendChild(document.createTextNode(text.slice(start)));
	}
}
