import type { FrameGraphDebugResource, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { analyzeSnapshotAliases, type AliasAnalysisAllocation } from './panelAliasAnalysis.ts';
import { createMutedText, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';
import {
	createFilterSelect, createRelationButton, createSearchInput, createViewToolbar,
	formatEstimatedBytes, formatEstimateCoverage, groupPath, registerSelectable,
	selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type MemoryFilter = 'all' | 'aliased' | 'single' | 'unallocated';
type MemorySort = 'allocation' | 'size';

export class MemoryView {
	readonly root = document.createElement('section');
	private readonly metrics = document.createElement('div');
	private readonly scroller = document.createElement('div');
	private readonly timeline = document.createElement('div');
	private readonly count = document.createElement('span');
	private readonly search: HTMLInputElement;
	private readonly filterSelect: HTMLSelectElement;
	private readonly rows = new Map<string, HTMLElement[]>();
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
		const note = createMutedText('Whole-snapshot estimates, not total GPU memory or a measured peak. Bars include the first and last execution slots; missing lifetimes have no bar.');
		note.classList.add('zenfg-inspector-memory-note');
		this.scroller.className = 'zenfg-inspector-memory-scroller';
		this.scroller.setAttribute('aria-label', 'Resource lifetimes by execution slot');
		this.timeline.className = 'zenfg-inspector-memory-timeline';
		this.scroller.appendChild(this.timeline);
		this.root.append(this.metrics, toolbar, note, this.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		this.renderMetrics();
		this.renderTimeline();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	/** Explicit navigation can remove filters; ordinary selection never does. */
	reveal(selection: Selection): void {
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
		this.metrics.replaceChildren(
			this.createMetric('Resource estimate', formatEstimateCoverage(metrics.transientEstimatedByteSize, coverage.transient),
				'The declared estimated sizes of all transient logical resources.'),
			this.createMetric('Logical capacity', allocationAvailable ? formatEstimateCoverage(metrics.logicalCapacityBytes, coverage.logical) : 'Not collected',
				'Assigned allocation capacity counted once per logical transient resource.'),
			this.createMetric('Physical estimate', allocationAvailable ? formatEstimateCoverage(metrics.physicalEstimatedBytes, coverage.physical) : 'Not collected',
				'Estimated allocation sizes, counting each physical allocation once.'),
			this.createMetric('Alias reuse', allocationAvailable ? formatEstimatedBytes(metrics.aliasReuseBytes) : 'Not collected',
				'Logical allocation capacity minus physical allocation estimate; not a measured saving.'),
			this.createMetric('Pool retained', pool.status === 'available' ? formatEstimatedBytes(pool.estimatedRetainedBytes) : 'Not collected',
				'Estimated bytes retained by the resource pool, including allocations outside this frame.'),
			this.createMetric('Allocations', allocationAvailable ? `${snapshot.physicalAllocations.length} · ${metrics.aliasedAllocationCount} aliased` : 'Not collected',
				'Physical allocation count for the entire snapshot.'),
		);
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
			if (this.filter === 'unallocated' || (this.filter === 'aliased' && !group.aliases) || (this.filter === 'single' && group.aliases)) return [];
			const allocationMatch = !query || [group.allocation.id, group.allocation.compatibilityClassId]
				.some((value) => value.toLocaleLowerCase().includes(query));
			const resources = allocationMatch ? group.resources : group.resources.filter(matches);
			return resources.length > 0 || allocationMatch ? [{ ...group, resources }] : [];
		});
		if (this.sort === 'size') groups.sort((a, b) => compareSize(a.allocation.estimatedByteSize, b.allocation.estimatedByteSize));
		let shown = 0;
		for (const group of groups) {
			this.timeline.appendChild(this.createAllocationHeader(group));
			for (const resource of group.resources) {
				this.timeline.appendChild(this.createResourceRow(resource, analysis.minUse, analysis.maxUse, ticks));
				shown++;
			}
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

	private createAllocationHeader(group: AliasAnalysisAllocation): HTMLElement {
		const selection: Selection = { kind: 'allocation', id: group.allocation.id };
		const header = document.createElement('div');
		header.className = 'zenfg-inspector-memory-allocation';
		header.dataset.kind = group.allocation.kind;
		registerSelectable(this.rows, header, selection, this.callbacks);
		const name = createRelationButton(`Allocation ${group.allocation.id.replace(/^allocation:/, '')}`, selection, this.callbacks.onSelect);
		name.title = group.allocation.id;
		const meta = document.createElement('span');
		meta.textContent = `${group.allocation.kind} · class ${group.allocation.compatibilityClassId} · ${formatEstimatedBytes(group.allocation.estimatedByteSize)} · ${group.aliases ? `aliased ×${group.allocation.resourceIds.length}` : 'single'}`;
		header.append(name, meta);
		return header;
	}

	private createMetric(label: string, value: string, explanation: string): HTMLElement {
		const item = document.createElement('div');
		item.title = explanation;
		const term = document.createElement('span');
		term.textContent = label;
		const amount = document.createElement('strong');
		amount.textContent = value;
		item.append(term, amount);
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
			const reveal = document.createElement('button');
			reveal.type = 'button';
			reveal.className = 'zenfg-inspector-memory-reveal';
			reveal.textContent = 'Locate';
			reveal.title = 'Locate in Resources';
			reveal.setAttribute('aria-label', `Locate ${labelResource(resource)} in Resources`);
			reveal.addEventListener('click', () => this.callbacks.onReveal?.(selection, 'resources'));
			name.appendChild(reveal);
		}
		const range = document.createElement('span');
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
