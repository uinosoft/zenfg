import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { labelNode, labelResource } from './panelDomHelpers.ts';
import { resolveNodeSelection } from './panelSelection.ts';
import type { Selection, WorkbenchTab } from './panelTypes.ts';
import {
	createFilterSelect, createRelationButton, createSearchInput, createViewToolbar,
	registerSelectable, selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

const severityOrder = { error: 0, warning: 1, info: 2 } as const;

export class DiagnosticsView {
	readonly root = document.createElement('section');
	private readonly scroller = document.createElement('div');
	private readonly content = document.createElement('div');
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly openSections = new Set<string>();
	private readonly count = document.createElement('span');
	private readonly searchInput: HTMLInputElement;
	private readonly severitySelect: HTMLSelectElement;
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private severity = 'all';
	private search = '';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-diagnostics-view';
		this.root.id = `${idPrefix}-view-diagnostics`;
		this.root.setAttribute('role', 'tabpanel');
		const toolbar = createViewToolbar('Diagnostic filters');
		this.searchInput = createSearchInput('Search diagnostic code or message', '', (value) => {
			this.search = value.trim().toLocaleLowerCase();
			this.render();
		});
		this.severitySelect = createFilterSelect('Diagnostic severity', this.severity, [
			['all', 'All severities'], ['error', 'Error'], ['warning', 'Warning'], ['info', 'Info'],
		], (value) => { this.severity = value; this.render(); });
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.textContent = 'Clear filters';
		clear.addEventListener('click', () => { this.clearFilters(); this.render(); });
		this.count.className = 'zenfg-inspector-result-count';
		this.count.setAttribute('role', 'status');
		toolbar.append(this.searchInput, this.severitySelect, clear, this.count);
		this.scroller.className = 'zenfg-inspector-diagnostics-scroller';
		this.content.className = 'zenfg-inspector-diagnostics-sections';
		this.scroller.appendChild(this.content);
		this.root.append(toolbar, this.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		this.render();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	reveal(selection: Selection): void {
		this.clearFilters();
		if (selection.kind === 'root') this.openSections.add('roots');
		if (selection.kind === 'culled') this.openSections.add('culled');
		if (selection.kind === 'segment') {
			this.openSections.add('segments');
			this.openSections.add(`segment:${selection.index}`);
		}
		this.render();
		this.rows.get(selectionKey(selection))?.[0]?.scrollIntoView?.({ block: 'nearest' });
	}

	private clearFilters(): void {
		this.search = '';
		this.severity = 'all';
		this.searchInput.value = '';
		this.severitySelect.value = 'all';
	}

	private render(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		this.rows.clear();
		this.content.replaceChildren(
			this.createMessages(snapshot), this.createRoots(snapshot), this.createCulled(snapshot), this.createSegments(snapshot),
		);
		updateSelectedRows(this.rows, this.selected);
	}

	private createMessages(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = document.createElement('section');
		section.className = 'zenfg-inspector-diagnostic-messages';
		const heading = document.createElement('h2');
		heading.textContent = 'Diagnostics';
		const summary = document.createElement('p');
		const all = snapshot.protocol.diagnostics;
		const errors = all.filter((entry) => entry.severity === 'error').length;
		const warnings = all.filter((entry) => entry.severity === 'warning').length;
		const infos = all.length - errors - warnings;
		summary.textContent = `${errors} errors · ${warnings} warnings · ${infos} info`;
		section.append(heading, summary);
		// Sort a copy. Stable sort preserves capture order within each severity, including repeated codes.
		const messages = all.filter((entry) => (this.severity === 'all' || entry.severity === this.severity)
			&& (!this.search || `${entry.code} ${entry.message}`.toLocaleLowerCase().includes(this.search)))
			.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
		this.count.textContent = `${messages.length} / ${all.length} diagnostics`;
		for (const diagnostic of messages) {
			const article = document.createElement('article');
			article.className = 'zenfg-inspector-diagnostic-message';
			article.dataset.severity = diagnostic.severity;
			const title = document.createElement('h3');
			const severity = document.createElement('span');
			severity.className = 'zenfg-inspector-diagnostic-severity';
			severity.textContent = diagnostic.severity;
			const code = document.createElement('code');
			code.textContent = diagnostic.code;
			title.append(severity, code);
			const message = document.createElement('p');
			message.textContent = diagnostic.message;
			article.append(title, message);
			if (diagnostic.nodeId !== undefined) {
				const selection = resolveNodeSelection(snapshot, diagnostic.nodeId);
				const node = snapshot.canonicalNodeById.get(diagnostic.nodeId);
				if (selection && node) article.appendChild(this.createObjectLink(labelNode(node), selection, 'passes'));
			}
			if (diagnostic.resourceId !== undefined) {
				const resource = snapshot.resourceById.get(diagnostic.resourceId);
				if (resource) article.appendChild(this.createObjectLink(labelResource(resource), { kind: 'resource', id: resource.id }, 'resources'));
			}
			section.appendChild(article);
		}
		if (messages.length === 0) {
			const empty = document.createElement('p');
			empty.className = 'zenfg-inspector-muted';
			empty.textContent = all.length === 0 ? 'No diagnostic messages in this snapshot.' : 'No diagnostics match the current filters.';
			section.appendChild(empty);
		}
		return section;
	}

	private createObjectLink(label: string, selection: Selection, tab: WorkbenchTab): HTMLElement {
		const links = document.createElement('span');
		links.className = 'zenfg-inspector-diagnostic-links';
		const select = createRelationButton(label, selection, this.callbacks.onSelect);
		registerSelectable(this.rows, select, selection, this.callbacks);
		const reveal = document.createElement('button');
		reveal.type = 'button';
		reveal.className = 'zenfg-inspector-relation-button zenfg-inspector-diagnostic-reveal';
		reveal.textContent = `Show in ${tab === 'passes' ? 'Passes' : 'Resources'}`;
		reveal.setAttribute('aria-label', `${reveal.textContent}: ${label}`);
		reveal.addEventListener('click', () => this.callbacks.onReveal?.(selection, tab));
		links.append(select, reveal);
		return links;
	}

	private createSection(key: string, title: string, description?: string): HTMLDetailsElement {
		const section = document.createElement('details');
		section.className = 'zenfg-inspector-diagnostic-section';
		section.dataset.section = key;
		section.open = this.openSections.has(key);
		const heading = document.createElement('summary');
		heading.textContent = title;
		section.appendChild(heading);
		if (description) {
			const text = document.createElement('p');
			text.textContent = description;
			section.appendChild(text);
		}
		section.addEventListener('toggle', () => {
			if (section.open) this.openSections.add(key);
			else this.openSections.delete(key);
		});
		return section;
	}

	private createRoots(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = this.createSection('roots', `Retention roots (${snapshot.roots.length})`, 'Roots explain why graph work survived dead-node elimination.');
		const list = document.createElement('div');
		list.className = 'zenfg-inspector-diagnostic-list';
		for (const root of snapshot.roots) {
			const selection: Selection = { kind: 'root', key: root.key };
			const node = root.nodeId === undefined ? undefined : snapshot.canonicalNodeById.get(root.nodeId);
			const label = root.resource ? labelResource(root.resource) : node ? labelNode(node) : root.nodeId ?? 'Unknown';
			const button = createRelationButton(`${root.reason} · ${label}`, selection, this.callbacks.onSelect);
			registerSelectable(this.rows, button, selection, this.callbacks);
			list.appendChild(button);
		}
		if (snapshot.roots.length === 0) list.textContent = 'No retention roots.';
		section.appendChild(list);
		return section;
	}

	private createCulled(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = this.createSection('culled', `Culled passes (${snapshot.culledNodes.length})`, 'Recorded passes removed during compilation. Inspect their reasons and accesses in Passes.');
		const reasons = new Map<string, number>();
		for (const entry of snapshot.culledNodes) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
		const list = document.createElement('ul');
		for (const [reason, count] of reasons) {
			const item = document.createElement('li');
			item.textContent = `${reason}: ${count}`;
			list.appendChild(item);
		}
		section.appendChild(list);
		if (snapshot.culledNodes.length > 0) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'zenfg-inspector-relation-button';
			button.textContent = 'Show culled passes';
			button.addEventListener('click', () => this.callbacks.onNavigate?.('passes', 'culled'));
			section.appendChild(button);
		}
		return section;
	}

	private createSegments(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = this.createSection('segments', `Execution segments (${snapshot.executionSegments.length})`,
			'An opaque interval marks external work. Its GPU submissions and duration are not measured here.');
		for (const segment of snapshot.executionSegments) {
			const selection: Selection = { kind: 'segment', index: segment.index };
			const members = this.createSection(`segment:${segment.index}`, `${segment.index} · ${segment.kind === 'frame-graph' ? 'FrameGraph command segment' : 'Opaque interval'} · ${segment.nodeIds.length} passes`);
			const button = createRelationButton('Inspect segment', selection, this.callbacks.onSelect);
			registerSelectable(this.rows, button, selection, this.callbacks);
			members.appendChild(button);
			const list = document.createElement('div');
			list.className = 'zenfg-inspector-diagnostic-list';
			for (const id of segment.nodeIds) {
				const node = snapshot.canonicalNodeById.get(id);
				const nodeSelection = resolveNodeSelection(snapshot, id);
				if (node && nodeSelection) list.appendChild(this.createObjectLink(labelNode(node), nodeSelection, 'passes'));
			}
			members.appendChild(list);
			section.appendChild(members);
		}
		if (snapshot.executionSegments.length === 0) {
			const empty = document.createElement('p');
			empty.textContent = 'No execution segments.';
			section.appendChild(empty);
		}
		return section;
	}
}
