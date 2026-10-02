import type { FrameGraphDebugResource, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';
import {
	createEmptyTableRow, createKindCell, createFilterSelect, createSearchInput, createSelectionCell,
	createTableScroller, createViewToolbar, formatEstimatedBytes, formatResourceDescriptor, groupPath, registerSelectable,
	resourceAccessCounts, selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type ResourceSort = 'name' | 'size' | 'lifetime';

export class ResourcesView {
	readonly root = document.createElement('section');
	private readonly table = createTableScroller([
		{ label: 'Name' },
		{ label: 'Type / Origin', column: 'kind' },
		{ label: 'Estimated size', column: 'numeric' },
		{ label: 'Lifetime (slots)', column: 'code' },
		{ label: 'R / W', column: 'numeric' },
	]);
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly count = document.createElement('span');
	private readonly searchInput: HTMLInputElement;
	private readonly kindSelect: HTMLSelectElement;
	private readonly originSelect: HTMLSelectElement;
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private search = '';
	private kind = 'all';
	private origin = 'all';
	private sort: ResourceSort = 'name';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-resources-view';
		this.root.id = `${idPrefix}-view-resources`;
		this.root.setAttribute('role', 'tabpanel');
		const toolbar = createViewToolbar('Resource filters and sorting');
		this.searchInput = createSearchInput('Search resource, ID or group', this.search, (value) => {
			this.search = value.trim().toLocaleLowerCase();
			this.renderRows();
		});
		this.kindSelect = createFilterSelect('Resource kind', this.kind, [
			['all', 'All kinds'], ['texture', 'Texture'], ['buffer', 'Buffer'],
		], (value) => { this.kind = value; this.renderRows(); });
		this.originSelect = createFilterSelect('Resource origin', this.origin, [
			['all', 'All origins'], ['transient', 'Transient'], ['imported', 'Imported'], ['surface', 'Surface'],
		], (value) => { this.origin = value; this.renderRows(); });
		const sort = createFilterSelect('Sort resources', this.sort, [
			['name', 'Name'], ['size', 'Size: largest first'], ['lifetime', 'Lifetime: first use'],
		], (value) => { this.sort = value as ResourceSort; this.renderRows(); });
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.textContent = 'Clear filters';
		clear.addEventListener('click', () => { this.clearFilters(); this.renderRows(); });
		this.count.className = 'zenfg-inspector-result-count';
		this.count.setAttribute('role', 'status');
		toolbar.append(this.searchInput, this.kindSelect, this.originSelect, sort, clear, this.count);
		this.table.table.classList.add('zenfg-inspector-resource-table');
		const notes = document.createElement('details'); notes.className = 'zenfg-inspector-list-notes zenfg-inspector-resource-notes';
		const summary = document.createElement('summary'); summary.textContent = 'Resource estimates';
		const explanation = document.createElement('p');
		explanation.textContent = 'Sizes are logical resource estimates from this snapshot, not actual GPU memory use. Lifetimes use inclusive execution slots. Shared physical allocations are shown in Memory.';
		notes.append(summary, explanation);
		this.root.append(toolbar, notes, this.table.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		this.renderRows();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	reveal(selection: Selection): void {
		if (selection.kind !== 'resource') return;
		this.clearFilters();
		this.renderRows();
		this.rows.get(selectionKey(selection))?.[0]?.scrollIntoView?.({ block: 'nearest' });
	}

	private clearFilters(): void {
		this.search = ''; this.kind = 'all'; this.origin = 'all';
		this.searchInput.value = ''; this.kindSelect.value = 'all'; this.originSelect.value = 'all';
	}

	private renderRows(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		this.rows.clear();
		this.table.body.replaceChildren();
		const resources = snapshot.resources.filter((resource) => {
			if (this.kind !== 'all' && resource.kind !== this.kind) return false;
			if (this.origin !== 'all' && resource.origin !== this.origin) return false;
			return !this.search || `${labelResource(resource)} ${resource.id} ${groupPath(snapshot, resource.debugGroupId)}`
				.toLocaleLowerCase().includes(this.search);
		}).sort((a, b) => this.compareResources(a, b));
		this.count.textContent = `${resources.length} / ${snapshot.resources.length} resources`;
		this.table.table.dataset.sort = this.sort;
		for (const [index, header] of Array.from(this.table.table.querySelectorAll('th')).entries()) {
			header.setAttribute('aria-sort', this.sort === 'size' && index === 2 ? 'descending' : this.sort === 'lifetime' && index === 3 ? 'ascending' : 'none');
		}
		for (const resource of resources) {
			const selection: Selection = { kind: 'resource', id: resource.id };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			const [reads, writes] = resourceAccessCounts(snapshot, resource.id);
			const resourceCell = createSelectionCell(labelResource(resource), selection, this.callbacks);
			resourceCell.title = `${labelResource(resource)} · ${resource.id}`;
			if (resource.debugGroupId !== undefined) {
				const group = document.createElement('small');
				group.className = 'zenfg-inspector-list-group-path';
				group.textContent = groupPath(snapshot, resource.debugGroupId);
				group.title = group.textContent;
				resourceCell.appendChild(group);
			}
			const metadata = document.createElement('small'); metadata.className = 'zenfg-inspector-list-row-meta';
			metadata.textContent = `${resource.kind} · ${resource.origin}`; resourceCell.appendChild(metadata);
			const descriptor = document.createElement('small'); descriptor.className = 'zenfg-inspector-resource-descriptor';
			descriptor.textContent = formatResourceDescriptor(resource); descriptor.title = descriptor.textContent; resourceCell.appendChild(descriptor);
			const extra = document.createElement('small'); extra.className = 'zenfg-inspector-list-row-extra';
			extra.textContent = `${resource.lifetime ? `Slots ${resource.lifetime.firstUse}–${resource.lifetime.lastUse}` : 'Lifetime unknown'} · ${reads} reads · ${writes} writes`;
			resourceCell.appendChild(extra);
			const estimated = createCell(formatEstimatedBytes(resource.estimatedByteSize), { column: 'numeric' });
			estimated.dataset.label = 'Estimated size'; estimated.className = resource.estimatedByteSize === undefined ? 'zenfg-inspector-list-unmeasured' : 'zenfg-inspector-list-measured';
			estimated.setAttribute('aria-label', 'Estimated size: ' + estimated.textContent);
			row.append(resourceCell,
				createKindCell(resource.kind, `${resource.kind} · ${resource.origin}`),
				estimated,
				createCell(resource.lifetime ? `${resource.lifetime.firstUse}–${resource.lifetime.lastUse}` : 'Unknown', { column: 'code' }),
				createCell(`${reads} / ${writes}`, { column: 'numeric' }));
			this.table.body.appendChild(row);
		}
		if (resources.length === 0) this.table.body.appendChild(createEmptyTableRow(5, 'No resources match the current filters.'));
		updateSelectedRows(this.rows, this.selected);
	}

	private compareResources(a: FrameGraphDebugResource, b: FrameGraphDebugResource): number {
		const byName = () => labelResource(a).localeCompare(labelResource(b)) || a.id.localeCompare(b.id);
		const knownFirst = (left: number | undefined, right: number | undefined, descending: boolean): number => (
			left === undefined ? right === undefined ? 0 : 1
				: right === undefined ? -1 : descending ? right - left : left - right
		);
		if (this.sort === 'size') return knownFirst(a.estimatedByteSize, b.estimatedByteSize, true) || byName();
		if (this.sort === 'lifetime') return knownFirst(a.lifetime?.firstUse, b.lifetime?.firstUse, false) || byName();
		return byName();
	}
}
