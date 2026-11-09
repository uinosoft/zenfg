import type { FrameGraphDebugGroup, FrameGraphDebugNode, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, labelNode } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import type { PassesSubview, Selection } from './panelTypes.ts';
import {
	createEmptyTableRow, createIconAction, createFilterSelect, createSearchInput, createSelectionCell,
	createTableScroller, createViewToolbar, enableTabKeyboard, formatTimingCoverage,
	groupPath, registerSelectable, selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type PassSort = 'order' | 'label' | 'kind' | 'gpu' | 'cpu';
type TimingSource = 'cpu' | 'gpu';
type TimingDomain = { readonly total: number; readonly maximum: number; readonly measured: number };
type PassEntry = {
	readonly node: Omit<FrameGraphDebugNode, 'order'>;
	readonly selection: Selection;
	readonly order?: number;
	readonly recordingOrder: number;
};

function nodeDuration(node: Omit<FrameGraphDebugNode, 'order'>, source: TimingSource): number | undefined {
	return source === 'cpu' ? node.cpuDurationMicros
		: node.kind === 'render' || node.kind === 'compute' ? node.gpuDurationMicros : undefined;
}

function axisMaximum(maximum: number): number {
	if (maximum <= 0) return 0;
	const magnitude = 10 ** Math.floor(Math.log10(maximum));
	const normalized = maximum / magnitude;
	const rounded = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
	return Number.isFinite(rounded) && rounded > 0 ? rounded : maximum;
}

function timingDomain(nodes: readonly FrameGraphDebugNode[], source: TimingSource): TimingDomain {
	let total = 0; let maximum = 0; let measured = 0;
	for (const node of nodes) {
		const duration = nodeDuration(node, source);
		if (duration === undefined) continue;
		total += duration; maximum = Math.max(maximum, duration); measured++;
	}
	return { total, maximum: axisMaximum(maximum), measured };
}

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
		{ label: 'Name' }, { label: 'CPU (ms)', column: 'numeric' }, { label: 'GPU (ms)', column: 'numeric' },
	]);
	private readonly groupsTable = createTableScroller([
		{ label: 'Group' }, { label: 'Retained', column: 'numeric' }, { label: 'Culled', column: 'numeric' },
		{ label: 'CPU sum', column: 'numeric' }, { label: 'GPU pass sum', column: 'numeric' }, { label: 'Inputs', column: 'numeric' },
		{ label: 'Outputs', column: 'numeric' }, { label: 'Actions' },
	]);
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly collapsedGroups = new Set<string>();
	private readonly count = document.createElement('span');
	private readonly groupCount = document.createElement('span');
	private readonly clearButton = document.createElement('button');
	private readonly timing = document.createElement('div');
	private readonly cpuCoverage = document.createElement('span');
	private readonly gpuCoverage = document.createElement('span');
	private readonly matchedTiming = document.createElement('p');
	private readonly groupScope = document.createElement('div');
	private readonly scopePath = document.createElement('span');
	private readonly timingNotes = document.createElement('details');
	private readonly timingAvailability = document.createElement('p');
	private readonly searchInput: HTMLInputElement;
	private readonly groupSearchInput: HTMLInputElement;
	private readonly kindSelect: HTMLSelectElement;
	private readonly statusSelect: HTMLSelectElement;
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private subview: PassesSubview = 'list';
	private search = '';
	private groupSearch = '';
	private groupScopeId: string | undefined;
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
			['order', 'Execution order'], ['label', 'Name'], ['kind', 'Kind'], ['gpu', 'GPU: slowest first'], ['cpu', 'CPU: slowest first'],
		], (value) => { this.sort = value as PassSort; this.renderRows(); });
		const clear = this.clearButton;
		clear.type = 'button'; clear.textContent = 'Clear filters';
		clear.dataset.passFocus = 'filters-clear';
		clear.addEventListener('click', () => {
			const focused = this.root.ownerDocument.activeElement === clear;
			this.clearFilters(); this.renderRows();
			if (focused) this.searchInput.focus({ preventScroll: true });
		});
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
		this.groupScope.className = 'zenfg-inspector-pass-scope';
		this.scopePath.className = 'zenfg-inspector-pass-scope-path';
		const scopeNote = document.createElement('small');
		scopeNote.className = 'zenfg-inspector-pass-scope-note'; scopeNote.textContent = 'includes subgroups';
		const clearScope = document.createElement('button'); clearScope.type = 'button'; clearScope.textContent = 'Clear group scope';
		clearScope.dataset.passFocus = 'scope-clear';
		clearScope.addEventListener('click', () => { this.groupScopeId = undefined; this.renderRows(); });
		this.groupScope.append(this.scopePath, scopeNote, clearScope);
		this.timing.className = 'zenfg-inspector-list-context';
		const coverage = document.createElement('div');
		coverage.className = 'zenfg-inspector-list-coverage';
		this.cpuCoverage.dataset.timing = 'cpu'; this.gpuCoverage.dataset.timing = 'gpu';
		coverage.append(this.cpuCoverage, this.gpuCoverage);
		this.matchedTiming.className = 'zenfg-inspector-pass-matched';
		this.timingNotes.className = 'zenfg-inspector-list-notes';
		const noteSummary = document.createElement('summary'); noteSummary.textContent = 'Timing & compile notes';
		const scope = document.createElement('p');
		scope.textContent = 'Retained means kept by compilation; it does not prove GPU execution. CPU measures synchronous elapsed time for retained passes. GPU timestamps cover retained render/compute passes; external submission work is opaque. Zero durations may reflect clock or timestamp precision. Shares use the complete capture\'s measured pass sum, not total frame time. Filtering does not change the share denominator or the millisecond bar axis.';
		this.timingNotes.append(noteSummary, scope, this.timingAvailability);
		this.timing.append(coverage, this.matchedTiming, this.timingNotes);
		this.listTable.table.classList.add('zenfg-inspector-pass-table');
		this.listTable.table.setAttribute('aria-label', 'Pass timing comparison');
		this.groupsTable.table.classList.add('zenfg-inspector-group-table');
		this.groupsTable.table.setAttribute('aria-label', 'Group totals including subgroups');
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
		this.root.append(this.tabList, this.toolbar, this.groupToolbar, this.groupScope, this.timing, this.listPane, this.groupsPane);
		this.updateSubview();
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		if (this.groupScopeId && !snapshot.groupById.has(this.groupScopeId)) this.groupScopeId = undefined;
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

	showAll(): void {
		this.clearFilters(); this.subview = 'list';
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
		this.groupScopeId = undefined;
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
		this.toolbar.hidden = !listActive; this.groupToolbar.hidden = listActive; this.timing.hidden = !listActive || this.status === 'culled';
		this.groupScope.hidden = !listActive || this.groupScopeId === undefined;
	}

	private renderRows(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		const document = this.root.ownerDocument;
		const active = document.activeElement as HTMLElement | null;
		const focusKey = active && this.root.contains(active) ? active.dataset.passFocus : undefined;
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
		this.clearButton.hidden = !this.search && this.kind === 'all' && this.status === 'all' && this.groupScopeId === undefined;
		passes.sort((a, b) => this.compareNodes(a, b)); this.count.textContent = `${passes.length} / ${entries.length} passes`;
		const metrics = snapshot.metrics;
		this.cpuCoverage.textContent = `Capture CPU · ${formatTimingCoverage(metrics.cpuTimedNodeCount, snapshot.nodes.length)}`;
		this.gpuCoverage.textContent = `Capture GPU · ${formatTimingCoverage(metrics.timedNodeCount, metrics.timingEligibleNodeCount)}`;
		const unavailable = [snapshot.cpuProfiling.status === 'unavailable' ? `CPU unavailable: ${snapshot.cpuProfiling.reason}.` : undefined,
			snapshot.profiling.status === 'unavailable' ? `GPU unavailable: ${snapshot.profiling.reason}.` : undefined].filter(Boolean);
		this.timingAvailability.textContent = unavailable.join(' '); this.timingAvailability.hidden = unavailable.length === 0;
		const domains = { cpu: timingDomain(snapshot.nodes, 'cpu'), gpu: timingDomain(snapshot.nodes, 'gpu') };
		const primary: TimingSource = this.sort === 'cpu' || this.sort === 'gpu' ? this.sort
			: domains.gpu.measured ? 'gpu' : domains.cpu.measured ? 'cpu' : 'gpu';
		const matched = passes.filter(entry => entry.selection.kind === 'node' && nodeDuration(entry.node, primary) !== undefined);
		const matchedTotal = matched.reduce((sum, entry) => sum + nodeDuration(entry.node, primary)!, 0);
		const matchedShare = matched.length && domains[primary].total > 0 ? `${(matchedTotal / domains[primary].total * 100).toFixed(1)}%` : '—';
		this.matchedTiming.textContent = `Matched ${primary.toUpperCase()}: ${matched.length ? `${(matchedTotal / 1000).toFixed(3)} ms` : '—'} · ${matchedShare} of capture pass sum`;
		this.listTable.table.dataset.sort = this.sort;
		this.listTable.table.dataset.primary = primary;
		this.listTable.table.dataset.status = this.status;
		this.listTable.table.dataset.maxMicros = String(domains[primary].maximum);
		for (const [index, header] of Array.from(this.listTable.table.querySelectorAll('th')).entries()) {
			header.setAttribute('aria-sort', this.status !== 'culled' && (this.sort === 'cpu' && index === 1 || this.sort === 'gpu' && index === 2) ? 'descending' : 'none');
			if (index === 0) continue;
			const source: TimingSource = index === 1 ? 'cpu' : 'gpu';
			header.dataset.timing = source;
			header.dataset.primary = String(source === primary);
			header.hidden = this.status === 'culled' && source === 'gpu';
			header.colSpan = this.status === 'culled' && source === 'cpu' ? 2 : 1;
			header.textContent = this.status === 'culled' ? 'Culled reason' : `${source.toUpperCase()} (ms)`;
			if (this.status !== 'culled' && source === primary && domains[source].maximum > 0) {
				const axis = document.createElement('span'); axis.className = 'zenfg-inspector-pass-axis';
				axis.setAttribute('aria-label', `${source.toUpperCase()} duration axis in milliseconds`);
				for (const [tick, value] of [0, domains[source].maximum / 2, domains[source].maximum].entries()) {
					const mark = document.createElement('span');
					mark.textContent = `${(value / 1000).toLocaleString('en-US', { maximumSignificantDigits: 3, useGrouping: false })}${tick === 2 ? ' ms' : ''}`;
					axis.append(mark);
				}
				header.append(axis);
			}
		}
		for (const { node, selection, order } of passes) {
			const row = document.createElement('tr'); registerSelectable(this.rows, row, selection, this.callbacks);
			row.dataset.passState = selection.kind === 'culled' ? 'culled' : 'retained';
			const labelCell = createSelectionCell(labelNode(node), selection, this.callbacks); labelCell.title = `${labelNode(node)} · ${node.id}`;
			const name = labelCell.querySelector<HTMLButtonElement>('button')!;
			name.classList.add('zenfg-inspector-pass-name'); name.title = labelCell.title;
			name.setAttribute('aria-label', labelNode(node)); name.dataset.passFocus = `node:${node.id}`;
			const characters = [...labelNode(node)]; const suffixLength = characters.length > 24 ? 12 : 0;
			const prefix = document.createElement('span'); prefix.className = 'zenfg-inspector-pass-name-prefix';
			prefix.textContent = suffixLength ? characters.slice(0, -suffixLength).join('') : labelNode(node);
			name.replaceChildren(prefix);
			if (suffixLength) {
				const suffix = document.createElement('span'); suffix.className = 'zenfg-inspector-pass-name-suffix'; suffix.textContent = characters.slice(-suffixLength).join('');
				name.append(suffix);
			}
			if (node.debugGroupId !== undefined) {
				const group = document.createElement('small'); group.className = 'zenfg-inspector-list-group-path';
				group.textContent = groupPath(snapshot, node.debugGroupId); group.title = group.textContent; labelCell.appendChild(group);
			}
			const metadata = document.createElement('small'); metadata.className = 'zenfg-inspector-list-row-meta zenfg-inspector-pass-identity';
			metadata.textContent = `${selection.kind === 'culled' ? 'Culled · ' : ''}${node.kind}${order === undefined ? '' : ` · #${order}`} · ${node.reads.length} R / ${node.writes.length} W`;
			labelCell.appendChild(metadata);
			row.append(labelCell);
			if (selection.kind === 'culled') {
				const reason = document.createElement('td'); reason.className = 'zenfg-inspector-pass-reason'; reason.colSpan = 2;
				reason.textContent = `Not executed · ${snapshot.culledById.get(node.id)?.reason ?? 'Culled by compilation'}`;
				row.append(reason);
			} else {
				row.append(this.createPassTimingCell(node, 'cpu', domains.cpu, primary), this.createPassTimingCell(node, 'gpu', domains.gpu, primary));
			}
			this.listTable.body.appendChild(row);
		}
		if (passes.length === 0) this.listTable.body.appendChild(createEmptyTableRow(3, 'No passes match the current filters.'));
		const scope = this.groupScopeId ? snapshot.groupById.get(this.groupScopeId) : undefined;
		this.scopePath.textContent = scope?.path.join(' / ') ?? ''; this.scopePath.title = this.scopePath.textContent;
		this.updateSubview();
		this.renderGroups(snapshot); updateSelectedRows(this.rows, this.selected);
		if (focusKey) {
			const target = [...this.root.querySelectorAll<HTMLElement>('[data-pass-focus]')].find(candidate => candidate.dataset.passFocus === focusKey && !candidate.closest('[hidden]'));
			(target ?? (this.subview === 'list' ? this.listButton : this.groupsButton)).focus({ preventScroll: true });
		}
	}

	private createPassTimingCell(node: Omit<FrameGraphDebugNode, 'order'>, source: TimingSource, domain: TimingDomain, primary: TimingSource): HTMLTableCellElement {
		const duration = nodeDuration(node, source);
		const value = duration !== undefined ? (duration / 1000).toFixed(3)
			: source === 'cpu' ? 'Not collected' : node.kind === 'external-submission' ? 'Opaque'
				: node.kind === 'render' || node.kind === 'compute' ? 'Not collected' : 'Not applicable';
		const cell = this.createTimingCell('', `${source.toUpperCase()} (ms)`, source, duration !== undefined);
		cell.dataset.primary = String(source === primary);
		const number = document.createElement('span'); number.className = 'zenfg-inspector-pass-duration'; number.textContent = value;
		cell.append(number);
		if (duration !== undefined) {
			const share = domain.total > 0 ? `${(duration / domain.total * 100).toFixed(1)}%` : '—';
			const percentage = document.createElement('span'); percentage.className = 'zenfg-inspector-pass-share'; percentage.textContent = share;
			cell.append(percentage);
			if (source === primary) {
				const bar = document.createElement('span'); bar.className = 'zenfg-inspector-pass-bar'; bar.setAttribute('aria-hidden', 'true');
				const fill = document.createElement('span'); fill.style.width = `${domain.maximum > 0 ? duration / domain.maximum * 100 : 0}%`;
				bar.append(fill); cell.append(bar);
			}
			cell.setAttribute('aria-label', `${source.toUpperCase()}: ${value} ms; ${share} of capture measured pass sum`);
		} else cell.setAttribute('aria-label', `${source.toUpperCase()}: ${value}`);
		cell.title = source === 'cpu' ? 'Synchronous elapsed time; zero may reflect clock precision. External nodes include synchronous submission.'
			: 'GPU timestamps cover retained render/compute passes. External submission internals are opaque.';
		return cell;
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
			labelCell.querySelector<HTMLButtonElement>('button')!.dataset.passFocus = `group:${group.id}`;
			labelCell.style.setProperty('--fgd-group-depth-offset', `${group.depth * 18}px`); labelCell.title = group.path.join(' / ');
			const expanded = this.groupSearch.length > 0 || !this.collapsedGroups.has(group.pathKey);
			if (parents.has(group.id)) {
				const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'zenfg-inspector-group-toggle';
				toggle.appendChild(createPanelIcon(expanded ? 'chevron-down' : 'chevron-right'));
				toggle.disabled = this.groupSearch.length > 0;
				toggle.title = this.groupSearch ? 'Matching groups and ancestors are expanded while searching.' : 'Toggle this group hierarchy';
				toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} group ${group.path.join(' / ')}`);
				toggle.setAttribute('aria-expanded', String(expanded));
				toggle.dataset.passFocus = `fold:${group.id}`;
				toggle.addEventListener('click', () => {
					if (expanded) this.collapsedGroups.add(group.pathKey); else this.collapsedGroups.delete(group.pathKey);
					this.renderRows();
					this.rows.get(selectionKey(selection))?.[0]?.querySelector<HTMLButtonElement>('.zenfg-inspector-group-toggle')?.focus({ preventScroll: true });
				});
				labelCell.prepend(toggle);
			} else {
				const spacer = document.createElement('span'); spacer.className = 'zenfg-inspector-group-toggle-spacer'; spacer.setAttribute('aria-hidden', 'true');
				labelCell.prepend(spacer);
			}
			const summary = group.summary;
			const metadata = document.createElement('small'); metadata.className = 'zenfg-inspector-list-row-meta';
			metadata.textContent = `${summary.retainedNodeCount} retained · ${summary.culledNodeCount} culled · ${summary.inputResources.length} inputs · ${summary.outputResources.length} outputs`;
			labelCell.appendChild(metadata);
			const revealCell = document.createElement('td'); revealCell.className = 'zenfg-inspector-group-actions';
			const drill = document.createElement('button'); drill.type = 'button'; drill.textContent = 'View passes';
			drill.className = 'zenfg-inspector-group-view-passes'; drill.setAttribute('aria-label', `View passes in group ${group.path.join(' / ')}`);
			drill.dataset.passFocus = `passes:${group.id}`;
			drill.addEventListener('click', () => {
				this.clearFilters(); this.groupScopeId = group.id; this.subview = 'list';
				this.renderRows(); this.listButton.focus({ preventScroll: true });
			});
			const graph = createIconAction('locate', `Show in Graph: ${group.path.join(' / ')}`, () => this.callbacks.onReveal?.(selection, 'graph'));
			graph.dataset.passFocus = `graph:${group.id}`;
			revealCell.append(drill, graph);
			row.append(labelCell, createCell(String(summary.retainedNodeCount), { column: 'numeric' }),
				createCell(String(summary.culledNodeCount), { column: 'numeric' }),
				this.createGroupTimingCell(summary.cpuWorkDurationMicros, summary.cpuTimedNodeCount, summary.retainedNodeCount, 'CPU sum'),
				this.createGroupTimingCell(summary.gpuWorkDurationMicros, summary.timedNodeCount, summary.timingEligibleNodeCount, 'GPU pass sum'),
				createCell(String(summary.inputResources.length), { column: 'numeric' }),
				createCell(String(summary.outputResources.length), { column: 'numeric' }), revealCell);
			this.groupsTable.body.appendChild(row);
		}
		if (groups.length === 0) this.groupsTable.body.appendChild(createEmptyTableRow(8, 'No groups match the current filters.'));
	}

	private createTimingCell(value: string, label: string, timing: 'cpu' | 'gpu', measured: boolean): HTMLTableCellElement {
		const cell = createCell(value, { column: 'numeric' });
		cell.dataset.label = label; cell.dataset.timing = timing; cell.className = measured ? 'zenfg-inspector-list-measured' : 'zenfg-inspector-list-unmeasured';
		cell.setAttribute('aria-label', `${label}: ${value}`);
		return cell;
	}

	private createGroupTimingCell(micros: number, timed: number, eligible: number, label: string): HTMLTableCellElement {
		const value = eligible === 0 ? 'Not applicable' : timed === 0 ? 'Not collected' : `${(micros / 1000).toFixed(3)} ms`;
		const cell = this.createTimingCell(value, label, label.startsWith('CPU') ? 'cpu' : 'gpu', timed > 0);
		const coverage = document.createElement('small'); coverage.textContent = formatTimingCoverage(timed, eligible); cell.appendChild(coverage);
		cell.setAttribute('aria-label', `${label}: ${value}; ${coverage.textContent}`);
		return cell;
	}

	private matchesNode(snapshot: FrameGraphDebugViewModel, entry: PassEntry): boolean {
		const { node, selection } = entry;
		if (this.groupScopeId && (!node.debugGroupId || !snapshot.groupById.get(node.debugGroupId)?.ancestorIds.includes(this.groupScopeId))) return false;
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
			case 'cpu': return (b.node.cpuDurationMicros ?? -1) - (a.node.cpuDurationMicros ?? -1) || order();
			case 'gpu': return (b.node.gpuDurationMicros ?? -1) - (a.node.gpuDurationMicros ?? -1) || order();
			case 'order': return order();
		}
	}
}
