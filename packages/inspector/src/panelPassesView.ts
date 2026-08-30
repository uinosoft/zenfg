import type { FrameGraphDebugNode, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, formatGpuDuration, labelNode } from './panelDomHelpers.ts';
import type { PassesSubview, Selection } from './panelTypes.ts';
import {
	createEmptyTableRow,
	createKindCell,
	createFilterSelect,
	createSearchInput,
	createSelectionCell,
	createTableScroller,
	createViewToolbar,
	groupPath,
	registerSelectable,
	type WorkbenchCallbacks,
	updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type PassSort = 'order' | 'label' | 'kind' | 'gpu';

export class PassesView {
	readonly root = document.createElement('section');
	private readonly toolbar = createViewToolbar('Pass filters and sorting');
	private readonly tabList = document.createElement('div');
	private readonly listButton = this.createSubviewButton('list', 'Pass List');
	private readonly groupsButton = this.createSubviewButton('groups', 'Group Hierarchy');
	private readonly listPane = document.createElement('div');
	private readonly groupsPane = document.createElement('div');
	private readonly listTable = createTableScroller([
		{ label: 'Order', column: 'numeric' },
		{ label: 'Segment', column: 'code' },
		{ label: 'Label' },
		{ label: 'Group' },
		{ label: 'Kind', column: 'kind' },
		{ label: 'GPU (ms)', column: 'numeric' },
		{ label: 'Reads', column: 'numeric' },
		{ label: 'Writes', column: 'numeric' },
	]);
	private readonly groupsTable = createTableScroller([
		{ label: '' },
		{ label: 'Group' },
		{ label: 'Retained', column: 'numeric' },
		{ label: 'Culled', column: 'numeric' },
		{ label: 'GPU work', column: 'numeric' },
		{ label: 'Inputs', column: 'numeric' },
		{ label: 'Outputs', column: 'numeric' },
	]);
	private readonly rows = new Map<string, HTMLElement[]>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private subview: PassesSubview = 'list';
	private search = '';
	private kind = 'all';
	private sort: PassSort = 'order';

	constructor(private readonly callbacks: WorkbenchCallbacks) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-passes-view';
		this.root.id = 'zenfg-inspector-view-passes';
		this.root.setAttribute('role', 'tabpanel');
		this.tabList.className = 'zenfg-inspector-subtabs';
		this.tabList.setAttribute('role', 'tablist');
		this.tabList.setAttribute('aria-label', 'Pass views');
		this.tabList.append(this.listButton, this.groupsButton);

		const search = createSearchInput('Search pass or group', this.search, (value) => {
			this.search = value.trim().toLocaleLowerCase();
			this.renderRows();
		});
		const kind = createFilterSelect('Pass kind', this.kind, [
			['all', 'All kinds'],
			['render', 'Render'],
			['compute', 'Compute'],
			['copy', 'Copy'],
			['clear-buffer', 'Clear Buffer'],
			['command', 'Command'],
			['external-submission', 'External'],
		], (value) => {
			this.kind = value;
			this.renderRows();
		});
		const sort = createFilterSelect('Sort passes', this.sort, [
			['order', 'Order'],
			['label', 'Label'],
			['kind', 'Kind'],
			['gpu', 'GPU'],
		], (value) => {
			this.sort = value as PassSort;
			this.renderRows();
		});
		this.toolbar.append(search, kind, sort);

		this.listPane.id = 'zenfg-inspector-pass-list-panel';
		this.listPane.className = 'zenfg-inspector-subview';
		this.listPane.setAttribute('role', 'tabpanel');
		this.listPane.setAttribute('aria-labelledby', this.listButton.id);
		this.listPane.appendChild(this.listTable.scroller);
		this.groupsPane.id = 'zenfg-inspector-group-list-panel';
		this.groupsPane.className = 'zenfg-inspector-subview';
		this.groupsPane.setAttribute('role', 'tabpanel');
		this.groupsPane.setAttribute('aria-labelledby', this.groupsButton.id);
		this.groupsPane.appendChild(this.groupsTable.scroller);
		this.root.append(this.tabList, this.toolbar, this.listPane, this.groupsPane);
		this.updateSubview();
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		if (snapshot.debugGroups.length === 0 && this.subview === 'groups') this.subview = 'list';
		this.groupsButton.disabled = snapshot.debugGroups.length === 0;
		this.renderRows();
		this.updateSubview();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	private createSubviewButton(subview: PassesSubview, label: string): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.id = `zenfg-inspector-${subview}-subtab`;
		button.textContent = label;
		button.setAttribute('role', 'tab');
		button.setAttribute('aria-controls', `zenfg-inspector-${subview === 'list' ? 'pass-list' : 'group-list'}-panel`);
		button.addEventListener('click', () => {
			this.subview = subview;
			this.updateSubview();
		});
		return button;
	}

	private updateSubview(): void {
		const listActive = this.subview === 'list';
		this.listButton.setAttribute('aria-selected', listActive ? 'true' : 'false');
		this.groupsButton.setAttribute('aria-selected', listActive ? 'false' : 'true');
		this.listButton.classList.toggle('active', listActive);
		this.groupsButton.classList.toggle('active', !listActive);
		this.listPane.hidden = !listActive;
		this.groupsPane.hidden = listActive;
	}

	private renderRows(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		this.rows.clear();
		this.listTable.body.replaceChildren();
		this.groupsTable.body.replaceChildren();

		const passes = snapshot.nodes.filter((node) => this.matchesNode(snapshot, node));
		passes.sort((a, b) => this.compareNodes(a, b));
		for (const node of passes) {
			const selection: Selection = { kind: 'node', id: node.id };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			const segment = snapshot.segmentByNodeId.get(node.id);
			row.append(
				createCell(String(node.order), { column: 'numeric' }),
				createCell(segment ? `${segment.index}:${segment.kind === 'frame-graph' ? 'FG' : 'opaque'}` : '-', { column: 'code' }),
				createSelectionCell(labelNode(node), selection, this.callbacks),
				createCell(groupPath(snapshot, node.debugGroupId), { column: 'code' }),
				createKindCell(node.kind),
				createCell(node.kind === 'external-submission' ? 'opaque' : formatGpuDuration(node), { column: 'numeric' }),
				createCell(String(node.reads.length), { column: 'numeric' }),
				createCell(String(node.writes.length), { column: 'numeric' }),
			);
			this.listTable.body.appendChild(row);
		}
		if (passes.length === 0) this.listTable.body.appendChild(createEmptyTableRow(8, 'No passes match the current filters.'));

		const query = this.search;
		for (const group of snapshot.debugGroups.filter((candidate) => (
			query.length === 0 || candidate.path.join(' / ').toLocaleLowerCase().includes(query)
		))) {
			const selection: Selection = { kind: 'group', pathKey: group.pathKey };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			const toggleCell = document.createElement('td');
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'zenfg-inspector-group-toggle';
			const expanded = this.callbacks.isGroupExpanded(group.pathKey);
			toggle.textContent = expanded ? '▾' : '▸';
			toggle.title = 'Toggle group in Graph view';
			toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} group ${group.path.join(' / ')}`);
			toggle.addEventListener('click', () => this.callbacks.onGroupToggle(group.pathKey));
			toggleCell.appendChild(toggle);
			const labelCell = createSelectionCell(group.label, selection, this.callbacks);
			labelCell.style.paddingLeft = `${8 + group.depth * 18}px`;
			const summary = group.summary;
			row.append(
				toggleCell,
				labelCell,
				createCell(String(summary.retainedNodeCount), { column: 'numeric' }),
				createCell(String(summary.culledNodeCount), { column: 'numeric' }),
				createCell(summary.timedNodeCount === 0 ? '-' : (summary.gpuWorkDurationMicros / 1000).toFixed(3), { column: 'numeric' }),
				createCell(String(summary.inputResources.length), { column: 'numeric' }),
				createCell(String(summary.outputResources.length), { column: 'numeric' }),
			);
			this.groupsTable.body.appendChild(row);
		}
		if (this.groupsTable.body.childElementCount === 0) this.groupsTable.body.appendChild(createEmptyTableRow(7, 'No diagnostic groups.'));
		updateSelectedRows(this.rows, this.selected);
	}

	private matchesNode(snapshot: FrameGraphDebugViewModel, node: FrameGraphDebugNode): boolean {
		if (this.kind !== 'all' && node.kind !== this.kind) return false;
		if (this.search.length === 0) return true;
		const haystack = `${labelNode(node)} ${groupPath(snapshot, node.debugGroupId)}`.toLocaleLowerCase();
		return haystack.includes(this.search);
	}

	private compareNodes(a: FrameGraphDebugNode, b: FrameGraphDebugNode): number {
		switch (this.sort) {
			case 'label': return labelNode(a).localeCompare(labelNode(b)) || a.order - b.order;
			case 'kind': return a.kind.localeCompare(b.kind) || a.order - b.order;
			case 'gpu': return (b.gpuDurationMicros ?? -1) - (a.gpuDurationMicros ?? -1) || a.order - b.order;
			case 'order': return a.order - b.order;
		}
	}
}
