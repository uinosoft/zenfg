import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';
import {
	createEmptyTableRow,
	createKindCell,
	createFilterSelect,
	createSearchInput,
	createSelectionCell,
	createTableScroller,
	createViewToolbar,
	formatEstimatedBytes,
	formatResourceDescriptor,
	groupPath,
	registerSelectable,
	resourceAccessCounts,
	type WorkbenchCallbacks,
	updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

export class ResourcesView {
	readonly root = document.createElement('section');
	private readonly table = createTableScroller([
		{ label: 'Resource / Group' },
		{ label: 'Type / Origin', column: 'kind' },
		{ label: 'Descriptor', column: 'code' },
		{ label: 'Estimated', column: 'numeric' },
		{ label: 'Lifetime', column: 'code' },
		{ label: 'Physical', column: 'numeric' },
		{ label: 'R / W', column: 'numeric' },
	]);
	private readonly rows = new Map<string, HTMLElement[]>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private search = '';
	private kind = 'all';
	private origin = 'all';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-resources-view';
		this.root.id = `${idPrefix}-view-resources`;
		this.root.setAttribute('role', 'tabpanel');
		const toolbar = createViewToolbar('Resource filters');
		toolbar.append(
			createSearchInput('Search resource or group', this.search, (value) => {
				this.search = value.trim().toLocaleLowerCase();
				this.renderRows();
			}),
			createFilterSelect('Resource kind', this.kind, [
				['all', 'All kinds'],
				['texture', 'Texture'],
				['buffer', 'Buffer'],
			], (value) => {
				this.kind = value;
				this.renderRows();
			}),
			createFilterSelect('Resource origin', this.origin, [
				['all', 'All origins'],
				['transient', 'Transient'],
				['imported', 'Imported'],
				['swapchain', 'Swapchain'],
			], (value) => {
				this.origin = value;
				this.renderRows();
			}),
		);
		this.root.append(toolbar, this.table.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		this.renderRows();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	private renderRows(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		this.rows.clear();
		this.table.body.replaceChildren();
		const resources = snapshot.resources.filter((resource) => {
			if (this.kind !== 'all' && resource.kind !== this.kind) return false;
			if (this.origin !== 'all' && resource.origin !== this.origin) return false;
			if (this.search.length === 0) return true;
			return `${labelResource(resource)} ${groupPath(snapshot, resource.debugGroupId)}`
				.toLocaleLowerCase().includes(this.search);
		});
		for (const resource of resources) {
			const selection: Selection = { kind: 'resource', id: resource.id };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			const [reads, writes] = resourceAccessCounts(snapshot, resource.id);
			const resourceCell = createSelectionCell(labelResource(resource), selection, this.callbacks);
			const group = document.createElement('small');
			group.textContent = groupPath(snapshot, resource.debugGroupId);
			resourceCell.appendChild(group);
			row.append(
				resourceCell,
				createKindCell(resource.kind, `${resource.kind} · ${resource.origin}`),
				createCell(formatResourceDescriptor(resource), { column: 'code' }),
				createCell(formatEstimatedBytes(resource.estimatedByteSize), { column: 'numeric' }),
				createCell(resource.lifetime ? `${resource.lifetime.firstUse}–${resource.lifetime.lastUse}` : '-', { column: 'code' }),
				createCell(resource.physicalResourceId === undefined ? '-' : `#${resource.physicalResourceId}`, { column: 'numeric' }),
				createCell(`${reads} / ${writes}`, { column: 'numeric' }),
			);
			this.table.body.appendChild(row);
		}
		if (resources.length === 0) this.table.body.appendChild(createEmptyTableRow(7, 'No resources match the current filters.'));
		updateSelectedRows(this.rows, this.selected);
	}
}
