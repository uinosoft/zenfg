import type { FrameGraphDebugGroup, FrameGraphDebugNode, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, labelNode } from './panelDomHelpers.ts';
import type { PassesSubview, Selection } from './panelTypes.ts';
import {
	createEmptyTableRow, createKindCell, createFilterSelect, createSearchInput, createSelectionCell,
	createTableScroller, createViewToolbar, enableTabKeyboard, formatMeasuredGpuWork, formatTimingCoverage,
	groupPath, registerSelectable, selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type PassSort = 'order' | 'label' | 'kind' | 'gpu';
type PassEntry = {
	readonly node: Omit<FrameGraphDebugNode, 'order'>;
	readonly selection: Selection;
	readonly order?: number;
	readonly recordingOrder: number;
};

export class PassesView {
	readonly root = document.createElement('section');
	private readonly toolbar = createViewToolbar('Pass filters and sorting');
	private readonly groupToolbar = createViewToolbar('Group search');
	private readonly tabList = document.createElement('div');
	private readonly listButton = this.createSubviewButton('list', 'Pass List');
	private readonly groupsButton = this.createSubviewButton('groups', 'Group Hierarchy');
	private readonly listPane = document.createElement('div');
	private readonly groupsPane = document.createElement('div');
	private readonly listTable = createTableScroller([
		{ label: 'Name' }, { label: 'Compile state', column: 'kind' }, { label: 'Order', column: 'numeric' },
		{ label: 'Kind', column: 'kind' }, { label: 'GPU (ms)', column: 'numeric' }, { label: 'R / W', column: 'numeric' },
	]);
	private readonly groupsTable = createTableScroller([
		{ label: 'Group' }, { label: 'Retained', column: 'numeric' }, { label: 'Culled', column: 'numeric' },
		{ label: 'Measured pass sum', column: 'numeric' }, { label: 'Inputs', column: 'numeric' },
		{ label: 'Outputs', column: 'numeric' }, { label: 'Locate' },
	]);
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly collapsedGroups = new Set<string>();
	private readonly count = document.createElement('span');
	private readonly groupCount = document.createElement('span');
	private readonly timing = document.createElement('p');
	private readonly searchInput: HTMLInputElement;
	private readonly groupSearchInput: HTMLInputElement;
	private readonly kindSelect: HTMLSelectElement;
	private readonly statusSelect: HTMLSelectElement;
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private subview: PassesSubview = 'list';
	private search = '';
	private groupSearch = '';
	private kind = 'all';
	private status = 'all';
	private sort: PassSort = 'order';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-passes-view';
		this.root.id = `${idPrefix}-view-passes`;
		this.root.setAttribute('role', 'tabpanel');
		this.tabList.className = 'zenfg-inspector-subtabs';
		this.tabList.setAttribute('role', 'tablist');
		this.tabList.setAttribute('aria-label', 'Pass views');
		this.tabList.append(this.listButton, this.groupsButton);
		enableTabKeyboard(this.tabList);
		this.searchInput = createSearchInput('Search pass, ID or group', '', (value) => {
			this.search = value.trim().toLocaleLowerCase(); this.renderRows();
		});
		this.statusSelect = createFilterSelect('Pass compile state', this.status, [
			['all', 'All'], ['retained', 'Retained'], ['culled', 'Culled'],
		], (value) => { this.status = value; this.renderRows(); });
		this.kindSelect = createFilterSelect('Pass kind', this.kind, [
			['all', 'All kinds'], ['render', 'Render'], ['compute', 'Compute'], ['copy', 'Copy'],
			['clear-buffer', 'Clear Buffer'], ['command', 'Command'], ['external-submission', 'External'],
		], (value) => { this.kind = value; this.renderRows(); });
		const sort = createFilterSelect('Sort passes', this.sort, [
			['order', 'Execution order'], ['label', 'Name'], ['kind', 'Kind'], ['gpu', 'GPU: slowest first'],
		], (value) => { this.sort = value as PassSort; this.renderRows(); });
		const clear = document.createElement('button');
		clear.type = 'button'; clear.textContent = 'Clear filters';
		clear.addEventListener('click', () => { this.clearFilters(); this.renderRows(); });
		this.count.className = 'zenfg-inspector-result-count'; this.count.setAttribute('role', 'status');
		this.toolbar.append(this.searchInput, this.statusSelect, this.kindSelect, sort, clear, this.count);
		this.groupSearchInput = createSearchInput('Search group path or ID', '', (value) => {
			this.groupSearch = value.trim().toLocaleLowerCase(); this.renderRows();
		});
		const clearGroups = document.createElement('button');
		clearGroups.type = 'button'; clearGroups.textContent = 'Clear filters';
		clearGroups.addEventListener('click', () => {
			this.groupSearch = ''; this.groupSearchInput.value = ''; this.renderRows();
		});
		this.groupCount.className = 'zenfg-inspector-result-count'; this.groupCount.setAttribute('role', 'status');
		this.groupToolbar.append(this.groupSearchInput, clearGroups, this.groupCount);
		this.timing.className = 'zenfg-inspector-list-context';
		this.listButton.id = `${idPrefix}-list-subtab`;
		this.listButton.setAttribute('aria-controls', `${idPrefix}-pass-list-panel`);
		this.groupsButton.id = `${idPrefix}-groups-subtab`;
		this.groupsButton.setAttribute('aria-controls', `${idPrefix}-group-list-panel`);
		this.listPane.id = `${idPrefix}-pass-list-panel`; this.listPane.className = 'zenfg-inspector-subview';
		this.listPane.setAttribute('role', 'tabpanel'); this.listPane.setAttribute('aria-labelledby', this.listButton.id);
		this.listPane.appendChild(this.listTable.scroller);
		this.groupsPane.id = `${idPrefix}-group-list-panel`; this.groupsPane.className = 'zenfg-inspector-subview';
		this.groupsPane.setAttribute('role', 'tabpanel'); this.groupsPane.setAttribute('aria-labelledby', this.groupsButton.id);
		this.groupsPane.appendChild(this.groupsTable.scroller);
		this.root.append(this.tabList, this.toolbar, this.groupToolbar, this.timing, this.listPane, this.groupsPane);
		this.updateSubview();
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		if (snapshot.debugGroups.length === 0 && this.subview === 'groups') this.subview = 'list';
		this.groupsButton.disabled = snapshot.debugGroups.length === 0;
		for (const path of this.collapsedGroups) if (!snapshot.groupByPathKey.has(path)) this.collapsedGroups.delete(path);
		this.renderRows(); this.updateSubview();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected; updateSelectedRows(this.rows, selected);
	}

	showCulled(): void {
		this.clearFilters(); this.status = 'culled'; this.statusSelect.value = 'culled'; this.subview = 'list';
		this.updateSubview(); this.renderRows();
	}

	reveal(selection: Selection): void {
		if (selection.kind === 'group') {
			this.subview = 'groups'; this.groupSearch = ''; this.groupSearchInput.value = '';
			const group = this.snapshot?.groupByPathKey.get(selection.pathKey);
			for (const id of group?.ancestorIds ?? []) {
				const ancestor = this.snapshot?.groupById.get(id);
				if (ancestor) this.collapsedGroups.delete(ancestor.pathKey);
			}
		} else if (selection.kind === 'node' || selection.kind === 'culled') {
			this.subview = 'list'; this.clearFilters();
		} else return;
		this.updateSubview(); this.renderRows();
		this.rows.get(selectionKey(selection))?.[0]?.scrollIntoView?.({ block: 'nearest' });
	}

	private clearFilters(): void {
		this.search = ''; this.kind = 'all'; this.status = 'all';
		this.searchInput.value = ''; this.kindSelect.value = 'all'; this.statusSelect.value = 'all';
	}

	private createSubviewButton(subview: PassesSubview, label: string): HTMLButtonElement {
		const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
		button.setAttribute('role', 'tab');
		button.addEventListener('click', () => { this.subview = subview; this.updateSubview(); });
		return button;
	}

	private updateSubview(): void {
		const listActive = this.subview === 'list';
		this.listButton.setAttribute('aria-selected', String(listActive));
		this.groupsButton.setAttribute('aria-selected', String(!listActive));
		this.listButton.tabIndex = listActive ? 0 : -1; this.groupsButton.tabIndex = listActive ? -1 : 0;
		this.listButton.classList.toggle('active', listActive); this.groupsButton.classList.toggle('active', !listActive);
		this.listPane.hidden = !listActive; this.groupsPane.hidden = listActive;
		this.toolbar.hidden = !listActive; this.groupToolbar.hidden = listActive; this.timing.hidden = !listActive;
	}

	private renderRows(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		this.rows.clear(); this.listTable.body.replaceChildren(); this.groupsTable.body.replaceChildren();
		const entries = snapshot.protocol.graph.nodes.flatMap((canonical, index): PassEntry[] => {
			const node = snapshot.nodeById.get(canonical.id) ?? snapshot.culledById.get(canonical.id)?.node;
			if (!node) return [];
			return [{ node,
				selection: { kind: canonical.compileState.status === 'retained' ? 'node' : 'culled', id: node.id },
				order: canonical.compileState.status === 'retained' ? canonical.compileState.executionOrder : undefined,
				recordingOrder: canonical.recordingOrder ?? index,
			}];
		});
		const passes = entries.filter((entry) => this.matchesNode(snapshot, entry));
		passes.sort((a, b) => this.compareNodes(a, b)); this.count.textContent = `${passes.length} / ${entries.length} passes`;
		const metrics = snapshot.metrics;
		this.timing.textContent = `Retained means kept by compilation. GPU timing: ${formatTimingCoverage(metrics.timedNodeCount, metrics.timingEligibleNodeCount)}${snapshot.profiling.status === 'unavailable' ? ` (${snapshot.profiling.reason})` : ''}.`;
		for (const { node, selection, order } of passes) {
			const row = document.createElement('tr'); registerSelectable(this.rows, row, selection, this.callbacks);
			const labelCell = createSelectionCell(labelNode(node), selection, this.callbacks); labelCell.title = node.id;
			if (node.debugGroupId !== undefined) {
				const group = document.createElement('small'); group.textContent = groupPath(snapshot, node.debugGroupId); labelCell.appendChild(group);
			}
			const stateCell = createKindCell(selection.kind === 'culled' ? 'culled' : 'retained', selection.kind === 'culled' ? 'Culled' : 'Retained');
			stateCell.title = selection.kind === 'culled' ? snapshot.culledById.get(node.id)?.reason ?? '' : 'Kept by compilation; this does not prove GPU execution.';
			const gpu = selection.kind === 'culled' ? 'Not applicable' : node.kind === 'external-submission' ? 'Opaque'
				: node.gpuDurationMicros !== undefined ? (node.gpuDurationMicros / 1000).toFixed(3)
					: node.kind === 'render' || node.kind === 'compute' ? 'Not collected' : 'Not applicable';
			row.append(labelCell, stateCell, createCell(order === undefined ? 'Not applicable' : String(order), { column: 'numeric' }),
				createKindCell(node.kind), createCell(gpu, { column: 'numeric' }), createCell(`${node.reads.length} / ${node.writes.length}`, { column: 'numeric' }));
			this.listTable.body.appendChild(row);
		}
		if (passes.length === 0) this.listTable.body.appendChild(createEmptyTableRow(6, 'No passes match the current filters.'));
		this.renderGroups(snapshot); updateSelectedRows(this.rows, this.selected);
	}

	private renderGroups(snapshot: FrameGraphDebugViewModel): void {
		const included = new Set<string>();
		const childrenByParent = new Map<string | undefined, FrameGraphDebugGroup[]>();
		for (const group of snapshot.debugGroups) {
			const siblings = childrenByParent.get(group.parentId) ?? [];
			siblings.push(group);
			childrenByParent.set(group.parentId, siblings);
		}
		// Parent-before-child capture order need not be depth-first; keep each subtree together.
		const orderedGroups: FrameGraphDebugGroup[] = [];
		const pending = [...(childrenByParent.get(undefined) ?? [])].reverse();
		while (pending.length) {
			const group = pending.pop()!;
			orderedGroups.push(group);
			pending.push(...[...(childrenByParent.get(group.id) ?? [])].reverse());
		}
		const parents = new Set(childrenByParent.keys());
		if (this.groupSearch) for (const group of snapshot.debugGroups) {
			if (`${group.path.join(' / ')} ${group.id}`.toLocaleLowerCase().includes(this.groupSearch)) {
				for (const id of group.ancestorIds) included.add(id);
			}
		}
		const groups = orderedGroups.filter((group) => this.groupSearch ? included.has(group.id)
			: !group.ancestorIds.slice(0, -1).some((id) => this.collapsedGroups.has(snapshot.groupById.get(id)!.pathKey)));
		this.groupCount.textContent = `${groups.length} / ${snapshot.debugGroups.length} groups`;
		for (const group of groups) {
			const selection: Selection = { kind: 'group', pathKey: group.pathKey };
			const row = document.createElement('tr'); registerSelectable(this.rows, row, selection, this.callbacks);
			const labelCell = createSelectionCell(group.label, selection, this.callbacks);
			labelCell.style.paddingLeft = `${8 + group.depth * 18}px`; labelCell.title = group.path.join(' / ');
			const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'zenfg-inspector-group-toggle';
			const expanded = this.groupSearch.length > 0 || !this.collapsedGroups.has(group.pathKey);
			toggle.textContent = parents.has(group.id) ? expanded ? '▾' : '▸' : '·';
			toggle.disabled = !parents.has(group.id) || this.groupSearch.length > 0;
			toggle.title = this.groupSearch ? 'Matching groups and ancestors are expanded while searching.' : 'Toggle this group hierarchy';
			toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} group ${group.path.join(' / ')}`);
			if (parents.has(group.id)) toggle.setAttribute('aria-expanded', String(expanded));
			toggle.addEventListener('click', () => {
				if (expanded) this.collapsedGroups.add(group.pathKey); else this.collapsedGroups.delete(group.pathKey);
				this.renderRows();
				this.rows.get(selectionKey(selection))?.[0]?.querySelector<HTMLButtonElement>('.zenfg-inspector-group-toggle')?.focus({ preventScroll: true });
			});
			labelCell.prepend(toggle);
			const summary = group.summary;
			const revealCell = document.createElement('td'); const reveal = document.createElement('button');
			reveal.type = 'button'; reveal.className = 'zenfg-inspector-relation-button'; reveal.textContent = 'Show in Graph';
			reveal.addEventListener('click', () => this.callbacks.onReveal?.(selection, 'graph')); revealCell.appendChild(reveal);
			row.append(labelCell, createCell(String(summary.retainedNodeCount), { column: 'numeric' }),
				createCell(String(summary.culledNodeCount), { column: 'numeric' }),
				createCell(formatMeasuredGpuWork(summary.gpuWorkDurationMicros, summary.timedNodeCount, summary.timingEligibleNodeCount), { column: 'numeric' }),
				createCell(String(summary.inputResources.length), { column: 'numeric' }),
				createCell(String(summary.outputResources.length), { column: 'numeric' }), revealCell);
			this.groupsTable.body.appendChild(row);
		}
		if (groups.length === 0) this.groupsTable.body.appendChild(createEmptyTableRow(7, 'No groups match the current filters.'));
	}

	private matchesNode(snapshot: FrameGraphDebugViewModel, entry: PassEntry): boolean {
		const { node, selection } = entry;
		if (this.status === 'retained' && selection.kind !== 'node' || this.status === 'culled' && selection.kind !== 'culled') return false;
		if (this.kind !== 'all' && node.kind !== this.kind) return false;
		return !this.search || `${labelNode(node)} ${node.id} ${groupPath(snapshot, node.debugGroupId)}`.toLocaleLowerCase().includes(this.search);
	}

	private compareNodes(a: PassEntry, b: PassEntry): number {
		const order = () => a.order === undefined ? b.order === undefined ? a.recordingOrder - b.recordingOrder : 1
			: b.order === undefined ? -1 : a.order - b.order;
		switch (this.sort) {
			case 'label': return labelNode(a.node).localeCompare(labelNode(b.node)) || order();
			case 'kind': return a.node.kind.localeCompare(b.node.kind) || order();
			case 'gpu': return (b.node.gpuDurationMicros ?? -1) - (a.node.gpuDurationMicros ?? -1) || order();
			case 'order': return order();
		}
	}
}
