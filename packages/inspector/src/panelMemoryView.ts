import type { FrameGraphDebugResource, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { analyzeSnapshotAliases, type AliasAnalysisAllocation } from './panelAliasAnalysis.ts';
import { createMutedText, labelResource } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import type { Selection } from './panelTypes.ts';
import {
	createFilterSelect, createIconAction, createRelationButton, createSearchInput, createViewToolbar,
	formatEstimatedBytes, formatEstimateCoverage, groupPath, registerSelectable,
	selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type MemoryFilter = 'all' | 'aliased' | 'single' | 'unallocated';
type MemorySort = 'allocation' | 'size';

export class MemoryView {
	readonly root = document.createElement('section');
	private readonly metrics = document.createElement('div');
	private readonly pool = document.createElement('section');
	private readonly estimateDetails = document.createElement('details');
	private readonly estimateContent = document.createElement('div');
	private readonly scroller = document.createElement('div');
	private readonly timeline = document.createElement('div');
	private readonly count = document.createElement('span');
	private readonly search: HTMLInputElement;
	private readonly filterSelect: HTMLSelectElement;
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly collapsedAllocations = new Set<string>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private query = '';
	private filter: MemoryFilter = 'all';
	private sort: MemorySort = 'allocation';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-memory-view';
		this.root.id = `${idPrefix}-view-memory`;
		this.root.setAttribute('role', 'tabpanel');
		this.metrics.className = 'zenfg-inspector-memory-summary';
		this.pool.className = 'zenfg-inspector-memory-pool';
		this.pool.setAttribute('aria-label', 'Resource pool');
		this.estimateDetails.className = 'zenfg-inspector-memory-estimate-details';
		const estimateSummary = document.createElement('summary');
		estimateSummary.append(createPanelIcon('chevron-right'), 'Estimate information');
		this.estimateContent.className = 'zenfg-inspector-memory-estimate-content';
		this.estimateDetails.append(estimateSummary, this.estimateContent);
		const toolbar = createViewToolbar('Memory filters');
		this.search = createSearchInput('Search memory resources or allocations', '', (value) => {
			this.query = value;
			this.renderTimeline();
		});
		this.filterSelect = createFilterSelect('Memory allocation status', this.filter, [
			['all', 'All'], ['aliased', 'Aliased'], ['single', 'Single'], ['unallocated', 'Unallocated'],
		], (value) => {
			this.filter = value as MemoryFilter;
			this.renderTimeline();
		});
		const sort = createFilterSelect('Memory sort', this.sort, [
			['allocation', 'Allocation order'], ['size', 'Size: largest first'],
		], (value) => {
			this.sort = value as MemorySort;
			this.renderTimeline();
		});
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.textContent = 'Clear filters';
		clear.addEventListener('click', () => this.clearFilters());
		this.count.className = 'zenfg-inspector-result-count';
		this.count.setAttribute('role', 'status');
		toolbar.append(this.search, this.filterSelect, sort, clear, this.count);
		const note = createMutedText('Whole-snapshot estimates · inclusive execution-slot lifetimes');
		note.classList.add('zenfg-inspector-memory-note');
		this.scroller.className = 'zenfg-inspector-memory-scroller';
		this.scroller.setAttribute('aria-label', 'Resource lifetimes by execution slot');
		this.timeline.className = 'zenfg-inspector-memory-timeline';
		this.scroller.append(this.metrics, this.pool, this.estimateDetails, toolbar, note, this.timeline);
		this.root.appendChild(this.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		for (const id of this.collapsedAllocations) {
			if (!snapshot.allocationById.has(id)) this.collapsedAllocations.delete(id);
		}
		this.renderMetrics();
		this.renderTimeline();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	/** Explicit navigation can remove filters; ordinary selection never does. */
	reveal(selection: Selection): void {
		const allocationId = selection.kind === 'allocation' ? selection.id
			: selection.kind === 'resource' ? this.snapshot?.resourceById.get(selection.id)?.physicalResourceId : undefined;
		if (allocationId !== undefined) this.collapsedAllocations.delete(allocationId);
		this.clearFilters();
		this.setSelection(selection);
		const row = this.rows.get(selectionKey(selection))?.[0];
		row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		row?.querySelector<HTMLButtonElement>('.zenfg-inspector-relation-button')?.focus({ preventScroll: true });
	}

	private clearFilters(): void {
		this.query = '';
		this.filter = 'all';
		this.search.value = '';
		this.filterSelect.value = 'all';
		this.renderTimeline();
	}

	private renderMetrics(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		const metrics = snapshot.metrics;
		const coverage = metrics.estimatedCoverage;
		const allocationAvailable = snapshot.protocol.memory.allocationReport.status === 'available';
		const pool = snapshot.resourcePool;
		const singleCount = snapshot.physicalAllocations.filter((allocation) => allocation.resourceIds.length === 1).length;
		const unreferencedCount = snapshot.physicalAllocations.filter((allocation) => allocation.resourceIds.length === 0).length;
		this.metrics.replaceChildren(
			this.createMetric('Physical allocation estimate', allocationAvailable ? formatEstimatedBytes(metrics.physicalEstimatedBytes) : 'Unavailable',
				'Estimated allocation sizes, counting each physical allocation once.', allocationAvailable
					? metrics.physicalEstimatedBytes === undefined ? `${coverage.physical.known}/${coverage.physical.total} sizes known` : 'Each physical allocation counted once'
					: snapshot.protocol.memory.allocationReport.status === 'unavailable' ? snapshot.protocol.memory.allocationReport.reason : ''),
			this.createMetric('Alias savings estimate', allocationAvailable ? formatEstimatedBytes(metrics.aliasReuseBytes) : 'Unavailable',
				'Logical allocation capacity minus physical allocation estimate; not a measured saving.', 'Logical capacity − physical estimate'),
			this.createMetric('Allocations', allocationAvailable ? String(snapshot.physicalAllocations.length) : 'Unavailable',
				'Physical allocation count for the entire snapshot.', allocationAvailable ? `${metrics.aliasedAllocationCount} shared · ${singleCount} single${unreferencedCount > 0 ? ` · ${unreferencedCount} unreferenced` : ''}` : 'Allocation report unavailable'),
		);
		const poolHeading = document.createElement('h2');
		poolHeading.textContent = 'Resource pool';
		const poolMetrics = document.createElement('div');
		poolMetrics.className = 'zenfg-inspector-memory-pool-metrics';
		if (pool.status === 'available') {
			poolMetrics.append(
				this.createMetric('Idle retained estimate', formatEstimatedBytes(pool.estimatedRetainedBytes), 'Estimated bytes of idle allocations retained by the pool at sampling time.'),
				this.createMetric('Idle allocations', String(pool.retainedCount), 'Idle allocations retained by the pool at sampling time.'),
				this.createMetric('Cumulative reuse', pool.acquireCount > 0 ? `${(pool.reuseCount / pool.acquireCount * 100).toFixed(1)}%` : 'Not applicable',
					'Pool reuse and acquisition counters cover the pool lifetime.', pool.acquireCount > 0 ? `${pool.reuseCount} / ${pool.acquireCount} acquisitions` : 'No acquisitions'),
			);
		} else {
			poolMetrics.appendChild(createMutedText(`Unavailable · ${pool.reason}`));
		}
		this.pool.replaceChildren(poolHeading, poolMetrics);
		const estimates = document.createElement('dl');
		estimates.className = 'zenfg-inspector-memory-estimate-facts';
		for (const [label, value] of [
			['Logical transient estimate', formatEstimateCoverage(metrics.transientEstimatedByteSize, coverage.transient)],
			['Logical capacity', allocationAvailable ? formatEstimateCoverage(metrics.logicalCapacityBytes, coverage.logical) : 'Unavailable'],
		] as const) {
			const row = document.createElement('div');
			const term = document.createElement('dt');
			term.textContent = label;
			const amount = document.createElement('dd');
			amount.textContent = value;
			row.append(term, amount);
			estimates.appendChild(row);
		}
		this.estimateContent.replaceChildren(estimates,
			createMutedText('Logical transient estimate includes all declared transient resources, including resources referenced only by culled passes. Logical capacity counts the assigned allocation capacity for each logical transient resource.'),
			createMutedText('These are whole-snapshot estimates, not total GPU memory or a measured peak. Pool idle allocations are separate from the captured frame. Alias savings use logical capacity minus physical allocation estimate.'),
			createMutedText('Lifecycle bars include the first and last execution slots. Missing lifetimes have no bar. Filtering and folding preserve the snapshot execution-slot range and whole-snapshot totals.'),
		);
		if (snapshot.protocol.memory.allocationReport.status === 'unavailable') {
			this.estimateContent.appendChild(createMutedText(`Allocation report unavailable: ${snapshot.protocol.memory.allocationReport.reason}`));
		}
		const unallocatedOption = this.filterSelect.querySelector<HTMLOptionElement>('option[value="unallocated"]');
		if (unallocatedOption) unallocatedOption.textContent = allocationAvailable ? 'Unallocated' : 'Allocation unavailable';
	}

	private renderTimeline(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		this.rows.clear();
		this.timeline.replaceChildren();
		const analysis = analyzeSnapshotAliases(snapshot);
		const ticks = analysis.hasLifetimes ? this.executionTicks(analysis.minUse, analysis.maxUse) : [];
		this.timeline.appendChild(this.createAxis(analysis.minUse, analysis.maxUse, ticks));
		const query = this.query.trim().toLocaleLowerCase();
		const matches = (resource: FrameGraphDebugResource): boolean => !query || [
			resource.id, resource.label, groupPath(snapshot, resource.debugGroupId),
		].some((value) => value?.toLocaleLowerCase().includes(query));
		const groups = analysis.allocations.flatMap((group) => {
			if (this.filter === 'unallocated' || (this.filter === 'aliased' && !group.aliases) || (this.filter === 'single' && group.allocation.resourceIds.length !== 1)) return [];
			const allocationMatch = !query || [group.allocation.id, group.allocation.compatibilityClassId]
				.some((value) => value.toLocaleLowerCase().includes(query));
			const resources = allocationMatch ? group.resources : group.resources.filter(matches);
			return resources.length > 0 || allocationMatch ? [{ ...group, resources }] : [];
		});
		if (this.sort === 'size') groups.sort((a, b) => compareSize(a.allocation.estimatedByteSize, b.allocation.estimatedByteSize));
		let shown = 0;
		for (const group of groups) {
			const expanded = query !== '' || !this.collapsedAllocations.has(group.allocation.id);
			const section = document.createElement('div');
			section.className = 'zenfg-inspector-memory-allocation-group';
			const members = document.createElement('div');
			members.id = `${this.root.id}-allocation-${encodeURIComponent(group.allocation.id)}`;
			members.className = 'zenfg-inspector-memory-allocation-resources';
			members.hidden = !expanded;
			section.append(this.createAllocationHeader(group, expanded, members.id, query !== ''), members);
			if (expanded) {
				for (const resource of group.resources) {
					members.appendChild(this.createResourceRow(resource, analysis.minUse, analysis.maxUse, ticks));
				}
			}
			this.timeline.appendChild(section);
			shown += group.resources.length;
		}

		const allUnallocated = snapshot.resources.filter((resource) => resource.origin === 'transient'
			&& (resource.physicalResourceId === undefined || !snapshot.allocationById.has(resource.physicalResourceId)));
		const unallocated = this.filter === 'all' || this.filter === 'unallocated' ? allUnallocated.filter(matches) : [];
		if (this.sort === 'size') unallocated.sort((a, b) => compareSize(a.estimatedByteSize, b.estimatedByteSize));
		if (unallocated.length > 0) {
			const header = document.createElement('div');
			header.className = 'zenfg-inspector-memory-allocation muted';
			header.dataset.kind = 'unallocated';
			header.textContent = snapshot.protocol.memory.allocationReport.status === 'available'
				? 'Unallocated transient resources' : 'Transient resources — allocation report unavailable';
			this.timeline.appendChild(header);
			for (const resource of unallocated) {
				this.timeline.appendChild(this.createResourceRow(resource, analysis.minUse, analysis.maxUse, ticks));
				shown++;
			}
		}
		const total = analysis.allocations.reduce((sum, group) => sum + group.resources.length, 0) + allUnallocated.length;
		this.count.textContent = `${shown} / ${total} resources`;
		if (groups.length === 0 && unallocated.length === 0) {
			this.timeline.appendChild(createMutedText(total > 0 ? 'No resources match these filters.' : 'No transient resource lifetimes.'));
		}
		updateSelectedRows(this.rows, this.selected);
	}

	private createAllocationHeader(group: AliasAnalysisAllocation, expanded: boolean, membersId: string, searching: boolean): HTMLElement {
		const selection: Selection = { kind: 'allocation', id: group.allocation.id };
		const header = document.createElement('div');
		header.className = 'zenfg-inspector-memory-allocation';
		header.dataset.kind = group.allocation.kind;
		registerSelectable(this.rows, header, selection, this.callbacks);
		const leading = document.createElement('div');
		leading.className = 'zenfg-inspector-memory-allocation-leading';
		const toggle = createIconAction(expanded ? 'chevron-down' : 'chevron-right', `${expanded ? 'Collapse' : 'Expand'} allocation ${group.allocation.id}`, () => {
			if (expanded) this.collapsedAllocations.add(group.allocation.id);
			else this.collapsedAllocations.delete(group.allocation.id);
			const scrollTop = this.scroller.scrollTop;
			this.renderTimeline();
			this.scroller.scrollTop = scrollTop;
			Array.from(this.timeline.querySelectorAll<HTMLButtonElement>('[data-allocation-toggle]'))
				.find((button) => button.dataset.allocationToggle === group.allocation.id)?.focus({ preventScroll: true });
		});
		toggle.classList.add('zenfg-inspector-memory-toggle');
		toggle.dataset.allocationToggle = group.allocation.id;
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.setAttribute('aria-controls', membersId);
		toggle.disabled = searching || group.resources.length === 0;
		if (searching) toggle.title = 'Matching allocations stay expanded while searching';
		const name = createRelationButton(`Allocation ${group.allocation.id.replace(/^allocation:/, '')}`, selection, this.callbacks.onSelect);
		name.title = group.allocation.id;
		leading.append(toggle, name);
		const meta = document.createElement('span');
		meta.className = 'zenfg-inspector-memory-allocation-meta';
		meta.textContent = `${group.allocation.kind} · ${formatEstimatedBytes(group.allocation.estimatedByteSize)} · ${group.aliases ? `Shared ×${group.allocation.resourceIds.length}` : group.allocation.resourceIds.length === 1 ? 'Single' : 'Unreferenced'}`;
		meta.title = `Compatibility class: ${group.allocation.compatibilityClassId}`;
		header.append(leading, meta);
		return header;
	}

	private createMetric(label: string, value: string, explanation: string, note?: string): HTMLElement {
		const item = document.createElement('div');
		item.className = 'zenfg-inspector-memory-metric';
		item.title = explanation;
		const term = document.createElement('span');
		term.className = 'zenfg-inspector-memory-metric-label';
		term.textContent = label;
		const amount = document.createElement('strong');
		const quantity = /^(\d[\d.,]*) (\w+)$/.exec(value);
		if (quantity) {
			const unit = document.createElement('span');
			unit.className = 'zenfg-inspector-memory-unit';
			unit.textContent = ` ${quantity[2]}`;
			amount.append(quantity[1]!, unit);
		} else amount.textContent = value;
		if (value === 'Unknown' || value === 'Unavailable' || value === 'Not applicable') amount.className = 'zenfg-inspector-memory-state-value';
		item.append(term, amount);
		if (note) {
			const secondary = document.createElement('small');
			secondary.textContent = note;
			item.appendChild(secondary);
		}
		return item;
	}

	private executionTicks(minUse: number, maxUse: number): number[] {
		const count = Math.min(6, maxUse - minUse + 1);
		return Array.from({ length: count }, (_, index) => count === 1 ? minUse : minUse + Math.round(index * (maxUse - minUse) / (count - 1)));
	}

	private createAxis(minUse: number, maxUse: number, ticks: readonly number[]): HTMLElement {
		const axis = document.createElement('div');
		axis.className = 'zenfg-inspector-memory-axis';
		const label = document.createElement('span');
		label.textContent = 'Resource';
		const lifetime = document.createElement('span');
		lifetime.textContent = 'First–last slot';
		const track = document.createElement('div');
		track.className = 'zenfg-inspector-memory-axis-track';
		track.setAttribute('aria-label', 'Execution slots');
		if (ticks.length === 0) track.textContent = 'No execution lifetimes';
		const slots = maxUse - minUse + 1;
		for (const value of ticks) {
			const tick = document.createElement('span');
			tick.style.left = `${((value - minUse + 0.5) / slots) * 100}%`;
			tick.textContent = String(value);
			track.appendChild(tick);
		}
		const size = document.createElement('span');
		size.textContent = 'Estimate';
		axis.append(label, lifetime, track, size);
		return axis;
	}

	private createResourceRow(resource: FrameGraphDebugResource, minUse: number, maxUse: number, ticks: readonly number[]): HTMLElement {
		const selection: Selection = { kind: 'resource', id: resource.id };
		const row = document.createElement('div');
		row.className = 'zenfg-inspector-memory-resource';
		row.dataset.kind = resource.kind;
		registerSelectable(this.rows, row, selection, this.callbacks);
		const name = document.createElement('div');
		name.className = 'zenfg-inspector-memory-name';
		const button = createRelationButton(labelResource(resource), selection, this.callbacks.onSelect);
		button.title = resource.id;
		name.appendChild(button);
		if (this.callbacks.onReveal) {
			const reveal = createIconAction('locate', `Locate ${labelResource(resource)} in Resources`, () => this.callbacks.onReveal?.(selection, 'resources'));
			reveal.classList.add('zenfg-inspector-memory-reveal');
			name.appendChild(reveal);
		}
		const range = document.createElement('span');
		range.className = 'zenfg-inspector-memory-range';
		range.textContent = resource.lifetime ? `${resource.lifetime.firstUse}–${resource.lifetime.lastUse}` : 'No lifetime';
		const track = document.createElement('div');
		track.className = 'zenfg-inspector-memory-track';
		const slots = maxUse - minUse + 1;
		for (const value of ticks) {
			const grid = document.createElement('span');
			grid.className = 'zenfg-inspector-memory-gridline';
			grid.style.left = `${((value - minUse + 0.5) / slots) * 100}%`;
			grid.setAttribute('aria-hidden', 'true');
			track.appendChild(grid);
		}
		const bar = document.createElement('span');
		bar.className = `zenfg-inspector-memory-bar ${resource.kind}`;
		if (resource.lifetime) {
			bar.style.left = `${((resource.lifetime.firstUse - minUse) / slots) * 100}%`;
			bar.style.width = `${((resource.lifetime.lastUse - resource.lifetime.firstUse + 1) / slots) * 100}%`;
			bar.title = `Execution slots ${resource.lifetime.firstUse}–${resource.lifetime.lastUse} (inclusive)`;
		} else {
			bar.classList.add('empty');
		}
		track.appendChild(bar);
		const size = document.createElement('span');
		size.className = 'zenfg-inspector-memory-size';
		size.textContent = formatEstimatedBytes(resource.estimatedByteSize);
		row.append(name, range, track, size);
		return row;
	}
}

function compareSize(a: number | undefined, b: number | undefined): number {
	if (a === undefined) return b === undefined ? 0 : 1;
	if (b === undefined) return -1;
	return b - a;
}
