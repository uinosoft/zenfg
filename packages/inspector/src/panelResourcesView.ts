import type { FrameGraphDebugResource, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, formatBytes, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';
import {
	createEmptyTableRow, createFilterSelect, createSearchInput, createRelationButton, createResourceLifetime,
	createTableScroller, createViewToolbar, formatEstimatedBytes, formatResourceDescriptor, formatResourceListDescriptor,
	groupPath, registerSelectable, resourceAccessCounts, selectionKey, setObjectName, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type ResourceSort = 'name' | 'size' | 'lifetime';
export type ResourceAccessMode = 'all' | 'read' | 'write';

export class ResourcesView {
	readonly root = document.createElement('section');
	private readonly table = createTableScroller([
		{ label: 'Resource' }, { label: 'Logical estimate', column: 'numeric' },
		{ label: 'Lifetime (Order)', column: 'code' }, { label: 'Declared accesses' },
	]);
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly count = document.createElement('span');
	private readonly clearButton = document.createElement('button');
	private readonly scopeDescription = document.createElement('p');
	private readonly searchInput: HTMLInputElement;
	private readonly kindSelect: HTMLSelectElement;
	private readonly originSelect: HTMLSelectElement;
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private search = '';
	private kind = 'all';
	private origin = 'all';
	private sort: ResourceSort = 'name';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string,
		private readonly onAccesses?: (resourceId: string, mode: ResourceAccessMode) => void) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-resources-view';
		this.root.id = `${idPrefix}-view-resources`;
		this.root.setAttribute('role', 'tabpanel');
		const toolbar = createViewToolbar('Resource filters and sorting');
		this.searchInput = createSearchInput('Search resource, ID or group', this.search, (value) => {
			this.search = value.trim().toLocaleLowerCase(); this.renderRows();
		});
		this.kindSelect = createFilterSelect('Resource kind', this.kind, [
			['all', 'All kinds'], ['texture', 'Texture'], ['buffer', 'Buffer'],
		], (value) => { this.kind = value; this.renderRows(); });
		this.originSelect = createFilterSelect('Resource origin', this.origin, [
			['all', 'All origins'], ['transient', 'Transient'], ['imported', 'Imported'], ['surface', 'Surface'],
		], (value) => { this.origin = value; this.renderRows(); });
		const sort = createFilterSelect('Sort resources', this.sort, [
			['name', 'Name'], ['size', 'Size: largest first'], ['lifetime', 'First use: Order'],
		], (value) => { this.sort = value as ResourceSort; this.renderRows(); });
		this.clearButton.type = 'button'; this.clearButton.textContent = 'Clear filters'; this.clearButton.hidden = true;
		this.clearButton.addEventListener('click', () => { this.clearFilters(); this.renderRows(); this.searchInput.focus({ preventScroll: true }); });
		this.count.className = 'zenfg-inspector-result-count'; this.count.setAttribute('role', 'status');
		const notes = document.createElement('details'); notes.className = 'zenfg-inspector-resource-notes';
		const summary = document.createElement('summary'); summary.textContent = 'Data scope';
		notes.append(summary, this.scopeDescription);
		toolbar.append(this.searchInput, this.kindSelect, this.originSelect, sort, this.clearButton, this.count, notes);
		this.table.table.classList.add('zenfg-inspector-resource-table');
		const headers = this.table.table.querySelectorAll('th');
		headers.forEach((header, index) => { header.scope = 'col'; header.dataset.resourceColumn = ['name', 'size', 'lifetime', 'access'][index]; });
		headers[1]!.title = 'Snapshot logical resource estimates. Bars share the largest known estimate in this capture, including filtered-out resources. Unknown is not zero.';
		headers[2]!.title = 'Inclusive retained execution Order, matching Passes; not elapsed time. Select a boundary to locate its pass.';
		headers[3]!.title = 'Declared read/write access records, including repeated accesses and culled passes; not execution counts or unique pass counts.';
		this.root.append(toolbar, this.table.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void { this.snapshot = snapshot; this.renderRows(); }
	setSelection(selected: Selection | undefined): void { this.selected = selected; updateSelectedRows(this.rows, selected); }

	reveal(selection: Selection): void {
		if (selection.kind !== 'resource') return;
		this.clearFilters(); this.renderRows();
		this.rows.get(selectionKey(selection))?.[0]?.scrollIntoView?.({ block: 'nearest' });
	}

	private clearFilters(): void {
		this.search = ''; this.kind = 'all'; this.origin = 'all';
		this.searchInput.value = ''; this.kindSelect.value = 'all'; this.originSelect.value = 'all';
	}

	private renderRows(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		const active = this.root.ownerDocument.activeElement as HTMLElement | null;
		const focusKey = active && this.table.body.contains(active) ? active.dataset.resourceFocus : undefined;
		this.rows.clear(); this.table.body.replaceChildren();
		const resources = snapshot.resources.filter((resource) => {
			if (this.kind !== 'all' && resource.kind !== this.kind || this.origin !== 'all' && resource.origin !== this.origin) return false;
			return !this.search || `${labelResource(resource)} ${resource.id} ${groupPath(snapshot, resource.debugGroupId)}`.toLocaleLowerCase().includes(this.search);
		}).sort((a, b) => this.compareResources(a, b));
		const maximum = snapshot.resources.reduce((value, resource) => Math.max(value, resource.estimatedByteSize ?? 0), 0);
		const known = snapshot.resources.filter(resource => resource.estimatedByteSize !== undefined).length;
		const counts = new Map(snapshot.resources.map(resource => [resource.id, resourceAccessCounts(snapshot, resource.id)]));
		let sizeCharacters = 9; let accessExtraDigits = 0;
		for (const resource of snapshot.resources) {
			sizeCharacters = Math.max(sizeCharacters, formatEstimatedBytes(resource.estimatedByteSize).length);
			const [reads, writes] = counts.get(resource.id)!;
			accessExtraDigits = Math.max(accessExtraDigits, String(reads).length + String(writes).length - 2);
		}
		this.table.table.style.setProperty('--fgd-resource-size-width', `${sizeCharacters}ch`);
		this.table.table.style.setProperty('--fgd-resource-access-extra-digits', String(accessExtraDigits));
		const nodesByOrder = new Map(snapshot.nodes.map(node => [node.order, node]));
		this.scopeDescription.textContent = `${known}/${snapshot.resources.length} logical estimates known. Sizes are snapshot logical estimates, not actual GPU memory use; declared capacity and physical allocation are separate. Bars use the largest known logical estimate in the full capture${maximum > 0 ? ` (${formatBytes(maximum)})` : ''}, unchanged by filters. Unknown is not zero. Lifetimes use inclusive retained execution Order, not elapsed time; unavailable does not mean unused. Read/Write counts are declared access records, including repeated accesses and culled passes, not execution or unique pass counts. Inspect shared physical allocations in Memory.`;
		this.count.textContent = `${resources.length} / ${snapshot.resources.length} resources`;
		this.clearButton.hidden = !this.search && this.kind === 'all' && this.origin === 'all';
		this.table.table.dataset.sort = this.sort; this.table.table.dataset.maxBytes = String(maximum);
		for (const [index, header] of Array.from(this.table.table.querySelectorAll('th')).entries()) {
			header.setAttribute('aria-sort', this.sort === 'size' && index === 1 ? 'descending' : this.sort === 'lifetime' && index === 2 || this.sort === 'name' && index === 0 ? 'ascending' : 'none');
		}
		for (const resource of resources) {
			const selection: Selection = { kind: 'resource', id: resource.id };
			const row = document.createElement('tr'); registerSelectable(this.rows, row, selection, this.callbacks);
			const cell = createCell(''); cell.dataset.resourceColumn = 'name';
			const identity = document.createElement('div'); identity.className = 'zenfg-inspector-resource-identity';
			const name = createRelationButton(labelResource(resource), selection, this.callbacks.onSelect);
			setObjectName(name, labelResource(resource), resource.id); name.dataset.resourceFocus = `${resource.id}:name`;
			const attributes = document.createElement('div'); attributes.className = 'zenfg-inspector-resource-attributes';
			for (const [attribute, value] of [['kind', resource.kind], ['origin', resource.origin]] as const) {
				const badge = document.createElement('span'); badge.className = 'zenfg-inspector-resource-badge';
				badge.dataset[attribute] = value; badge.textContent = value[0]!.toUpperCase() + value.slice(1); attributes.append(badge);
			}
			const description = formatResourceListDescriptor(resource);
			if (description) {
				const descriptor = document.createElement('span'); descriptor.className = 'zenfg-inspector-resource-descriptor';
				descriptor.textContent = description; descriptor.title = formatResourceDescriptor(resource); attributes.append(descriptor);
			}
			identity.append(name, attributes); cell.append(identity);
			const lifetime = createCell('', { column: 'code' }); lifetime.dataset.resourceColumn = 'lifetime';
			lifetime.append(createResourceLifetime(resource, nodesByOrder, this.callbacks.onReveal));
			row.append(cell, this.createSizeCell(resource, maximum), lifetime, this.createAccessCell(snapshot, resource, counts.get(resource.id)!));
			this.table.body.append(row);
		}
		if (resources.length === 0) this.table.body.append(createEmptyTableRow(4, 'No resources match the current filters.'));
		updateSelectedRows(this.rows, this.selected);
		if (focusKey) {
			const target = [...this.table.body.querySelectorAll<HTMLButtonElement>('[data-resource-focus]')].find(button => button.dataset.resourceFocus === focusKey && !button.disabled);
			(target ?? this.searchInput).focus({ preventScroll: true });
		}
	}

	private createSizeCell(resource: FrameGraphDebugResource, maximum: number): HTMLTableCellElement {
		const cell = createCell('', { column: 'numeric' }); cell.dataset.resourceColumn = 'size';
		const size = resource.estimatedByteSize; cell.dataset.sizeState = size === undefined ? 'unknown' : 'known';
		cell.setAttribute('aria-label', `Logical estimate: ${formatEstimatedBytes(size)}`);
		cell.title = size === undefined ? 'Logical estimate not captured; declared capacity may still be available.' : `${size.toLocaleString('en-US')} bytes · snapshot logical resource estimate`;
		const content = document.createElement('div'); content.className = 'zenfg-inspector-resource-size';
		const label = document.createElement('span'); label.className = 'zenfg-inspector-resource-size-label'; label.textContent = 'Logical estimate'; content.append(label);
		const value = document.createElement('span'); value.className = 'zenfg-inspector-resource-size-value'; value.textContent = formatEstimatedBytes(size);
		if (size !== undefined) {
			const bar = document.createElement('span'); bar.className = 'zenfg-inspector-resource-size-bar'; bar.setAttribute('aria-hidden', 'true');
			const fill = document.createElement('span'); fill.style.width = `${maximum > 0 ? size / maximum * 100 : 0}%`;
			bar.append(fill); content.append(bar);
		}
		content.append(value); cell.append(content); return cell;
	}

	private createAccessCell(snapshot: FrameGraphDebugViewModel, resource: FrameGraphDebugResource, counts: readonly [number, number]): HTMLTableCellElement {
		const cell = createCell(''); cell.dataset.resourceColumn = 'access';
		const accesses = document.createElement('div'); accesses.className = 'zenfg-inspector-resource-accesses';
		const [reads, writes] = counts;
		for (const [mode, count] of [['read', reads], ['write', writes]] as const) {
			const button = document.createElement('button'); button.type = 'button'; button.className = 'zenfg-inspector-resource-access';
			button.dataset.access = mode; button.disabled = count === 0; button.dataset.resourceFocus = `${resource.id}:${mode}`;
			const label = document.createElement('span'); label.textContent = mode === 'read' ? 'Read' : 'Write';
			const number = document.createElement('strong'); number.textContent = String(count); button.append(label, number);
			button.setAttribute('aria-label', `${label.textContent} ${count} declared access records for ${labelResource(resource)}`);
			button.title = `Inspect ${count} declared ${mode} access records, including culled passes.`;
			button.addEventListener('click', () => this.onAccesses ? this.onAccesses(resource.id, mode) : this.callbacks.onSelect({ kind: 'resource', id: resource.id }));
			accesses.append(button);
		}
		cell.append(accesses);
		const culled = (snapshot.accessesByResourceId.get(resource.id) ?? []).filter(access => snapshot.culledById.has(access.nodeId)).length;
		const note = document.createElement('small'); note.className = 'zenfg-inspector-resource-culled';
		if (culled) {
			note.textContent = `${culled} culled ${culled === 1 ? 'access' : 'accesses'}`; note.title = 'Included in the declared Read/Write counts; these passes do not execute.';
		}
		cell.append(note); return cell;
	}

	private compareResources(a: FrameGraphDebugResource, b: FrameGraphDebugResource): number {
		const byName = () => labelResource(a).localeCompare(labelResource(b)) || a.id.localeCompare(b.id);
		const knownFirst = (left: number | undefined, right: number | undefined, descending: boolean): number => (
			left === undefined ? right === undefined ? 0 : 1 : right === undefined ? -1 : descending ? right - left : left - right
		);
		if (this.sort === 'size') return knownFirst(a.estimatedByteSize, b.estimatedByteSize, true) || byName();
		if (this.sort === 'lifetime') return knownFirst(a.lifetime?.firstUse, b.lifetime?.firstUse, false) || byName();
		return byName();
	}
}
