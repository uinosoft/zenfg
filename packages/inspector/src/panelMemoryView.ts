import type { FrameGraphDebugPhysicalAllocation, FrameGraphDebugResource, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { analyzeSnapshotAliases, type AliasAnalysisAllocation } from './panelAliasAnalysis.ts';
import { createMutedText, labelResource } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import type { Selection } from './panelTypes.ts';
import {
	createFilterSelect, createIconAction, createRelationButton, createResourceLifetime, createSearchInput, createViewToolbar,
	formatEstimatedBytes, formatEstimateCoverage, groupPath, registerSelectable, setObjectName,
	selectionKey, type WorkbenchCallbacks, updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

type MemoryFilter = 'all' | 'aliased' | 'single' | 'unreferenced' | 'unallocated';
type MemorySort = 'allocation' | 'size';

export class MemoryView {
	readonly root = document.createElement('section');
	private readonly metrics = document.createElement('div');
	private readonly allocationStats = document.createElement('div');
	private readonly pool = document.createElement('section');
	private readonly estimateDetails = document.createElement('details');
	private readonly estimateContent = document.createElement('div');
	private readonly controls = document.createElement('div');
	private readonly scroller = document.createElement('div');
	private readonly timeline = document.createElement('div');
	private readonly count = document.createElement('span');
	private readonly clearButton = document.createElement('button');
	private readonly search: HTMLInputElement;
	private readonly filterSelect: HTMLSelectElement;
	private readonly resizeObserver: ResizeObserver | undefined;
	private readonly rows = new Map<string, HTMLElement[]>();
	private readonly collapsedAllocations = new Set<string>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private nodesByOrder = new Map<number, { readonly id: string; readonly label?: string }>();
	private selected: Selection | undefined;
	private query = '';
	private filter: MemoryFilter = 'all';
	private sort: MemorySort = 'allocation';

	constructor(private readonly callbacks: WorkbenchCallbacks, idPrefix: string) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-memory-view';
		this.root.id = `${idPrefix}-view-memory`; this.root.setAttribute('role', 'tabpanel');
		this.metrics.className = 'zenfg-inspector-memory-summary';
		this.allocationStats.className = 'zenfg-inspector-memory-allocation-stats';
		this.pool.className = 'zenfg-inspector-memory-pool'; this.pool.setAttribute('aria-label', 'Resource pool');
		this.estimateDetails.className = 'zenfg-inspector-memory-estimate-details';
		const estimateSummary = document.createElement('summary');
		estimateSummary.append(createPanelIcon('chevron-right'), 'Data scope');
		this.estimateContent.className = 'zenfg-inspector-memory-estimate-content';
		this.estimateContent.tabIndex = 0; this.estimateDetails.append(estimateSummary, this.estimateContent);
		const toolbar = createViewToolbar('Memory filters');
		this.search = createSearchInput('Search memory resources or allocations', '', value => { this.query = value; this.renderTimeline(); });
		this.filterSelect = createFilterSelect('Memory allocation status', this.filter, [
			['all', 'All allocations'], ['aliased', 'Shared'], ['single', 'Single'], ['unreferenced', 'Unreferenced'], ['unallocated', 'Unallocated'],
		], value => { this.filter = value as MemoryFilter; this.renderTimeline(); });
		const sort = createFilterSelect('Memory sort', this.sort, [['allocation', 'Allocation order'], ['size', 'Size: largest first']],
			value => { this.sort = value as MemorySort; this.renderTimeline(); });
		sort.title = 'Physical allocation size, largest first; unallocated resources use logical estimates.';
		this.clearButton.type = 'button'; this.clearButton.textContent = 'Clear filters'; this.clearButton.hidden = true;
		this.clearButton.addEventListener('click', () => { this.clearFilters(); this.search.focus({ preventScroll: true }); });
		this.count.className = 'zenfg-inspector-result-count'; this.count.setAttribute('role', 'status');
		toolbar.append(this.search, this.filterSelect, sort, this.clearButton, this.count, this.estimateDetails);
		this.controls.className = 'zenfg-inspector-memory-controls'; this.controls.append(toolbar);
		this.scroller.className = 'zenfg-inspector-memory-scroller'; this.scroller.setAttribute('aria-label', 'Resource lifetimes by Pass Order');
		this.timeline.className = 'zenfg-inspector-memory-timeline';
		this.scroller.append(this.metrics, this.allocationStats, this.pool, this.controls, this.timeline); this.root.append(this.scroller);
		this.resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.updateStickyInset());
		this.resizeObserver?.observe(this.controls);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot; this.nodesByOrder = new Map(snapshot.nodes.map(node => [node.order, node]));
		for (const id of this.collapsedAllocations) if (!snapshot.allocationById.has(id) || snapshot.allocationById.get(id)!.resourceIds.length <= 1) this.collapsedAllocations.delete(id);
		this.renderMetrics(); this.renderTimeline();
	}
	setSelection(selected: Selection | undefined): void { this.selected = selected; this.updateSelection(); }
	destroy(): void { this.resizeObserver?.disconnect(); }

	/** Resolve a rebuilt control when closing a detail drawer after capture refresh. */
	resolveFocus(previous: HTMLElement): HTMLElement | undefined {
		const key = previous.dataset.memoryFocus; if (!key) return undefined;
		const allocation = previous.closest<HTMLElement>('[data-allocation-id]')?.dataset.allocationId;
		const candidates = [...this.timeline.querySelectorAll<HTMLElement>('[data-memory-focus]')].filter(element => !element.matches(':disabled') && !element.closest('[hidden]'));
		return candidates.find(element => element.dataset.memoryFocus === key) ?? candidates.find(element => element.dataset.memoryFocus === `${allocation}:name`) ?? this.search;
	}

	/** Explicit navigation removes blockers and unfolds the complete allocation. */
	reveal(selection: Selection): void {
		const allocationId = selection.kind === 'allocation' ? selection.id : selection.kind === 'resource' ? this.snapshot?.resourceById.get(selection.id)?.physicalResourceId : undefined;
		if (allocationId !== undefined) this.collapsedAllocations.delete(allocationId);
		this.clearFilters(); this.setSelection(selection); this.updateStickyInset();
		const target = this.rows.get(selectionKey(selection))?.[0];
		target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		const button = target?.matches('button') ? target : target?.querySelector<HTMLElement>('.zenfg-inspector-relation-button');
		button?.focus({ preventScroll: true });
	}
	private updateStickyInset(): void { this.scroller.style.scrollPaddingTop = `${this.controls.getBoundingClientRect().height + 4}px`; }
	private clearFilters(): void { this.query = ''; this.filter = 'all'; this.search.value = ''; this.filterSelect.value = 'all'; this.renderTimeline(); }

	private renderMetrics(): void {
		const snapshot = this.snapshot; if (!snapshot) return;
		const metrics = snapshot.metrics, coverage = metrics.estimatedCoverage, report = snapshot.protocol.memory.allocationReport;
		const available = report.status === 'available';
		if (available) {
			this.metrics.replaceChildren(
				this.createMetric('Physical allocation estimate', formatEstimatedBytes(metrics.physicalEstimatedBytes), 'Each reported physical allocation counted once, including unreferenced allocations.',
					metrics.physicalEstimatedBytes === undefined ? `${coverage.physical.known}/${coverage.physical.total} sizes known` : undefined),
				this.createMetric('Alias savings estimate', formatEstimatedBytes(metrics.aliasReuseBytes), 'Extra transient members times allocation capacity, summed per shared allocation. Unreferenced allocations do not reduce savings.',
					metrics.aliasReuseBytes === undefined ? `${coverage.alias.known}/${coverage.alias.total} shared allocation sizes known` : undefined),
			);
		} else {
			const state = createMutedText(`Allocation report unavailable · ${report.reason}`); state.className = 'zenfg-inspector-memory-report-state'; this.metrics.replaceChildren(state);
		}
		const single = snapshot.physicalAllocations.filter(allocation => allocation.resourceIds.length === 1).length;
		const unreferenced = snapshot.physicalAllocations.filter(allocation => allocation.resourceIds.length === 0).length;
		this.allocationStats.hidden = !available;
		this.allocationStats.replaceChildren(this.createMetric('Allocations', String(snapshot.physicalAllocations.length), 'Whole-capture reported allocation count.'),
			createMutedText(`${metrics.aliasedAllocationCount} shared · ${single} single${unreferenced ? ` · ${unreferenced} unreferenced (${formatEstimatedBytes(metrics.unreferencedPhysicalEstimatedBytes)})` : ''}`));
		const poolHeading = document.createElement('h2'); poolHeading.textContent = 'Resource pool';
		const poolMetrics = document.createElement('div'); poolMetrics.className = 'zenfg-inspector-memory-pool-metrics';
		const pool = snapshot.resourcePool;
		if (pool.status === 'available') poolMetrics.append(
			this.createMetric('Idle pool estimate', formatEstimatedBytes(pool.estimatedRetainedBytes), 'Idle pool allocations at sampling time, separate from this captured frame.', `· ${pool.retainedCount} allocation${pool.retainedCount === 1 ? '' : 's'}`),
			this.createMetric('Cumulative reuse', pool.acquireCount > 0 ? `${(pool.reuseCount / pool.acquireCount * 100).toFixed(1)}%` : 'Not applicable',
				'Pool reuse and acquisition counters cover the pool lifetime.', pool.acquireCount > 0 ? `${pool.reuseCount} / ${pool.acquireCount} acquisitions` : 'No acquisitions'),
		); else poolMetrics.append(createMutedText(`Unavailable · ${pool.reason}`));
		this.pool.replaceChildren(poolHeading, poolMetrics);
		const estimates = document.createElement('dl'); estimates.className = 'zenfg-inspector-memory-estimate-facts';
		for (const [label, value] of [
			['Logical transient estimate', formatEstimateCoverage(metrics.transientEstimatedByteSize, coverage.transient)],
			['Logical capacity', available ? formatEstimateCoverage(metrics.logicalCapacityBytes, coverage.logical) : 'Unavailable'],
			['Referenced physical estimate', available ? formatEstimatedBytes(metrics.referencedPhysicalEstimatedBytes) : 'Unavailable'],
			['Unreferenced physical estimate', available ? formatEstimatedBytes(metrics.unreferencedPhysicalEstimatedBytes) : 'Unavailable'],
		]) {
			const row = document.createElement('div'), term = document.createElement('dt'), valueCell = document.createElement('dd');
			term.textContent = label!; valueCell.textContent = value!; row.append(term, valueCell); estimates.append(row);
		}
		this.estimateContent.replaceChildren(estimates,
			createMutedText('Whole-capture estimates, not total GPU memory or a measured peak. Logical transient estimates include culled-only resources. Logical capacity counts the assigned allocation capacity for each transient resource.'),
			createMutedText('Alias savings sum (transient member count − 1) × capacity for each shared allocation. Unreferenced allocations stay in the physical total and do not offset savings. Shared records describe allocation membership; Single does not explain allocator decisions.'),
			createMutedText('Lifetimes use inclusive retained Pass Order, not milliseconds. Missing lifetimes are unavailable, not proof of non-use. Filtering and folding retain the full capture domain and totals. Allocations sort by physical size; unallocated resources sort by logical estimate. Idle pool metrics are separate and reuse is cumulative.'),
		);
		const option = this.filterSelect.querySelector<HTMLOptionElement>('option[value="unallocated"]'); if (option) option.textContent = available ? 'Unallocated' : 'Allocation unavailable';
	}

	private renderTimeline(): void {
		const snapshot = this.snapshot; if (!snapshot) return;
		const active = this.root.ownerDocument.activeElement as HTMLElement | null;
		const focusKey = active && this.timeline.contains(active) ? active.dataset.memoryFocus : undefined;
		const scrollTop = this.scroller.scrollTop;
		this.rows.clear(); this.timeline.replaceChildren();
		const analysis = analyzeSnapshotAliases(snapshot), ticks = analysis.hasLifetimes ? this.executionTicks(analysis.minUse, analysis.maxUse) : [];
		let sizeCharacters = 11, rangeCharacters = 5;
		for (const resource of snapshot.resources) {
			sizeCharacters = Math.max(sizeCharacters, formatEstimatedBytes(resource.estimatedByteSize).length);
			if (resource.lifetime) rangeCharacters = Math.max(rangeCharacters, String(resource.lifetime.firstUse).length + String(resource.lifetime.lastUse).length + 1);
		}
		this.root.style.setProperty('--fgd-memory-size-width', `${sizeCharacters}ch`); this.root.style.setProperty('--fgd-memory-range-width', `${rangeCharacters}ch`);
		this.controls.querySelector('.zenfg-inspector-memory-axis')?.remove(); this.controls.append(this.createAxis(analysis.minUse, analysis.maxUse, ticks));
		const query = this.query.trim().toLocaleLowerCase(); this.clearButton.hidden = !query && this.filter === 'all';
		const matches = (resource: FrameGraphDebugResource) => !query || [resource.id, resource.label, groupPath(snapshot, resource.debugGroupId)].some(value => value?.toLocaleLowerCase().includes(query));
		const groups = analysis.allocations.flatMap(group => {
			if (this.filter === 'unallocated' || this.filter === 'aliased' && !group.aliases || this.filter === 'single' && group.allocation.resourceIds.length !== 1 || this.filter === 'unreferenced' && group.allocation.resourceIds.length !== 0) return [];
			const allocationMatch = !query || [group.allocation.id, group.allocation.compatibilityClassId].some(value => value.toLocaleLowerCase().includes(query));
			const resources = (allocationMatch ? [...group.resources] : group.resources.filter(matches)).sort((a, b) =>
				(a.lifetime?.firstUse ?? Infinity) - (b.lifetime?.firstUse ?? Infinity) || labelResource(a).localeCompare(labelResource(b)) || a.id.localeCompare(b.id));
			return resources.length || allocationMatch ? [{ ...group, resources }] : [];
		});
		if (this.sort === 'size') groups.sort((a, b) => compareSize(a.allocation.estimatedByteSize, b.allocation.estimatedByteSize));
		let shown = 0;
		for (const group of groups) {
			if (group.allocation.resourceIds.length === 1 && group.resources.length === 1) {
				const row = this.createResourceRow(group.resources[0]!, analysis.minUse, analysis.maxUse, ticks, group.allocation);
				row.classList.add('zenfg-inspector-memory-single'); this.timeline.append(row);
			} else {
				const expanded = query !== '' || !this.collapsedAllocations.has(group.allocation.id);
				const section = document.createElement('div'); section.className = 'zenfg-inspector-memory-allocation-group'; section.dataset.allocationId = group.allocation.id;
				const members = document.createElement('div'); members.id = `${this.root.id}-allocation-${encodeURIComponent(group.allocation.id)}`;
				members.className = 'zenfg-inspector-memory-allocation-resources'; members.hidden = !expanded;
				section.append(this.createAllocationHeader(group, expanded, members.id, query !== ''), members);
				if (expanded) for (const resource of group.resources) members.append(this.createResourceRow(resource, analysis.minUse, analysis.maxUse, ticks));
				this.timeline.append(section);
			}
			shown += group.resources.length;
		}
		const allUnallocated = snapshot.resources.filter(resource => resource.origin === 'transient' && (resource.physicalResourceId === undefined || !snapshot.allocationById.has(resource.physicalResourceId)));
		const unallocated = this.filter === 'all' || this.filter === 'unallocated' ? allUnallocated.filter(matches) : [];
		if (this.sort === 'size') unallocated.sort((a, b) => compareSize(a.estimatedByteSize, b.estimatedByteSize));
		if (unallocated.length) {
			const header = document.createElement('div'); header.className = 'zenfg-inspector-memory-allocation muted'; header.dataset.kind = 'unallocated';
			header.textContent = snapshot.protocol.memory.allocationReport.status === 'available' ? 'Unallocated transient resources' : 'Transient resources — allocation report unavailable'; this.timeline.append(header);
			for (const resource of unallocated) this.timeline.append(this.createResourceRow(resource, analysis.minUse, analysis.maxUse, ticks)); shown += unallocated.length;
		}
		const total = analysis.allocations.reduce((sum, group) => sum + group.resources.length, 0) + allUnallocated.length;
		this.count.textContent = `${groups.length} / ${analysis.allocations.length} allocations · ${shown} / ${total} resources`;
		if (!groups.length && !unallocated.length) this.timeline.append(createMutedText(total > 0 ? 'No resources match these filters.' : 'No transient resource lifetimes.'));
		this.updateSelection(); this.updateStickyInset();
		if (focusKey) {
			const target = this.resolveFocus(active!)!;
			this.scroller.scrollTop = scrollTop; target.focus({ preventScroll: true });
		}
	}

	private updateSelection(): void {
		updateSelectedRows(this.rows, this.selected);
		const allocationId = this.selected?.kind === 'allocation' ? this.selected.id : this.selected?.kind === 'resource' ? this.snapshot?.resourceById.get(this.selected.id)?.physicalResourceId : undefined;
		for (const row of this.timeline.querySelectorAll<HTMLElement>('[data-allocation-id]')) row.classList.toggle('related-allocation', row.dataset.allocationId === allocationId);
	}
	private allocationLink(allocation: FrameGraphDebugPhysicalAllocation, compact = false): HTMLButtonElement {
		const selection: Selection = { kind: 'allocation', id: allocation.id };
		const label = `${compact ? 'Alloc' : 'Allocation'} ${allocation.id.replace(/^allocation:/, '')}`;
		const button = createRelationButton(label, selection, this.callbacks.onSelect); setObjectName(button, label, allocation.id);
		button.classList.add('zenfg-inspector-memory-allocation-link'); button.dataset.memoryFocus = `${allocation.id}:name`;
		registerSelectable(this.rows, button, selection, this.callbacks); return button;
	}
	private createBadge(value: string, attribute: 'kind' | 'origin' = 'kind'): HTMLSpanElement {
		const badge = document.createElement('span'); badge.className = 'zenfg-inspector-resource-badge'; badge.dataset[attribute] = value;
		badge.textContent = value[0]!.toUpperCase() + value.slice(1); return badge;
	}
	private createAllocationHeader(group: AliasAnalysisAllocation, expanded: boolean, membersId: string, searching: boolean): HTMLElement {
		const selection: Selection = { kind: 'allocation', id: group.allocation.id };
		const header = document.createElement('div'); header.className = 'zenfg-inspector-memory-allocation'; header.dataset.kind = group.allocation.kind; header.dataset.allocationId = group.allocation.id;
		registerSelectable(this.rows, header, selection, this.callbacks);
		const leading = document.createElement('div'); leading.className = 'zenfg-inspector-memory-allocation-leading';
		if (group.resources.length) {
			const toggle = createIconAction(expanded ? 'chevron-down' : 'chevron-right', `${expanded ? 'Collapse' : 'Expand'} allocation ${group.allocation.id}`, () => {
				toggle.focus({ preventScroll: true });
				if (expanded) this.collapsedAllocations.add(group.allocation.id); else this.collapsedAllocations.delete(group.allocation.id); this.renderTimeline();
			});
			toggle.classList.add('zenfg-inspector-memory-toggle'); toggle.dataset.allocationToggle = group.allocation.id; toggle.dataset.memoryFocus = `${group.allocation.id}:toggle`;
			toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', membersId); toggle.disabled = searching;
			if (searching) toggle.title = 'Matching allocations stay expanded while searching'; leading.append(toggle);
		}
		leading.append(this.allocationLink(group.allocation));
		const meta = document.createElement('div'); meta.className = 'zenfg-inspector-memory-allocation-meta';
		const state = document.createElement('span'); state.className = 'zenfg-inspector-memory-sharing';
		state.textContent = group.aliases ? `Shared ×${group.allocation.resourceIds.length}${group.resources.length !== group.allocation.resourceIds.length ? ` · ${group.resources.length} matching` : ''}` : 'Unreferenced';
		meta.append(this.createBadge(group.allocation.kind), document.createTextNode(`Physical ${formatEstimatedBytes(group.allocation.estimatedByteSize)}`), state);
		meta.title = `Compatibility class: ${group.allocation.compatibilityClassId}`; header.append(leading, meta); return header;
	}
	private createMetric(label: string, value: string, explanation: string, note?: string): HTMLElement {
		const item = document.createElement('div'); item.className = 'zenfg-inspector-memory-metric'; item.title = explanation;
		const term = document.createElement('span'); term.className = 'zenfg-inspector-memory-metric-label'; term.textContent = label;
		const amount = document.createElement('strong'), quantity = /^(\d[\d.,]*) (\w+)$/.exec(value);
		if (quantity) { const unit = document.createElement('span'); unit.className = 'zenfg-inspector-memory-unit'; unit.textContent = ` ${quantity[2]}`; amount.append(quantity[1]!, unit); } else amount.textContent = value;
		if (['Unknown', 'Unavailable', 'Not applicable'].includes(value)) amount.className = 'zenfg-inspector-memory-state-value';
		item.append(term, amount); if (note) { const secondary = document.createElement('small'); secondary.textContent = note; item.append(secondary); } return item;
	}
	private executionTicks(minUse: number, maxUse: number): number[] {
		const count = Math.min(6, maxUse - minUse + 1); return Array.from({ length: count }, (_, index) => count === 1 ? minUse : minUse + Math.round(index * (maxUse - minUse) / (count - 1)));
	}
	private createAxis(minUse: number, maxUse: number, ticks: readonly number[]): HTMLElement {
		const axis = document.createElement('div'); axis.className = 'zenfg-inspector-memory-axis';
		const label = document.createElement('span'); label.textContent = 'Resource / allocation';
		const order = document.createElement('span'); order.textContent = 'Order'; order.title = 'First and last retained Pass Order, inclusive; select a boundary to locate its pass.';
		const track = document.createElement('div'); track.className = 'zenfg-inspector-memory-axis-track'; track.setAttribute('aria-label', 'Pass Order');
		if (!ticks.length) track.textContent = 'No execution lifetimes';
		for (const value of ticks) {
			const tick = document.createElement('span'), halfWidth = `${String(value).length / 2}ch`;
			const position = ((value - minUse + .5) / (maxUse - minUse + 1)) * 100;
			// Keep endpoint labels inside the track without changing slot coordinates.
			tick.style.setProperty('--fgd-memory-tick-position', `${position}%`); tick.style.setProperty('--fgd-memory-tick-half-width', halfWidth);
			tick.textContent = String(value); track.append(tick);
		}
		const size = document.createElement('span'); size.textContent = 'Logical estimate'; axis.append(label, order, track, size); return axis;
	}
	private createResourceRow(resource: FrameGraphDebugResource, minUse: number, maxUse: number, ticks: readonly number[], allocation?: FrameGraphDebugPhysicalAllocation): HTMLElement {
		const selection: Selection = { kind: 'resource', id: resource.id };
		const row = document.createElement('div'); row.className = 'zenfg-inspector-memory-resource'; row.dataset.kind = resource.kind;
		if (resource.physicalResourceId !== undefined) row.dataset.allocationId = resource.physicalResourceId;
		registerSelectable(this.rows, row, selection, this.callbacks);
		const name = document.createElement('div'); name.className = 'zenfg-inspector-memory-name';
		const identity = document.createElement('div'); identity.className = 'zenfg-inspector-memory-identity';
		const title = document.createElement('div'); title.className = 'zenfg-inspector-memory-title';
		const button = createRelationButton(labelResource(resource), selection, this.callbacks.onSelect); setObjectName(button, labelResource(resource), resource.id);
		button.dataset.memoryFocus = `${resource.id}:name`; title.append(button);
		if (this.callbacks.onReveal) { const reveal = createIconAction('locate', `Locate ${labelResource(resource)} in Resources`, () => this.callbacks.onReveal?.(selection, 'resources'));
			reveal.classList.add('zenfg-inspector-memory-reveal'); reveal.dataset.memoryFocus = `${resource.id}:locate`; title.append(reveal); }
		identity.append(title);
		if (allocation || !resource.physicalResourceId || resource.origin !== 'transient') {
			const attributes = document.createElement('div'); attributes.className = 'zenfg-inspector-memory-attributes'; attributes.append(this.createBadge(resource.kind));
			if (resource.origin !== 'transient') attributes.append(this.createBadge(resource.origin, 'origin'));
			if (allocation) { const capacity = document.createElement('span'); capacity.textContent = `Physical ${formatEstimatedBytes(allocation.estimatedByteSize)}`; attributes.append(this.allocationLink(allocation, true), capacity); }
			else if (!resource.physicalResourceId) attributes.append(document.createTextNode(this.snapshot!.protocol.memory.allocationReport.status === 'available' ? 'Unallocated' : 'Allocation unavailable'));
			identity.append(attributes);
		}
		name.append(identity);
		const range = document.createElement('span'); range.className = 'zenfg-inspector-memory-range';
		range.append(createResourceLifetime(resource, this.nodesByOrder, this.callbacks.onReveal));
		for (const boundary of range.querySelectorAll<HTMLElement>('[data-resource-focus]')) boundary.dataset.memoryFocus = boundary.dataset.resourceFocus;
		const track = document.createElement('button'); track.type = 'button'; track.className = 'zenfg-inspector-memory-track'; track.disabled = !resource.lifetime;
		track.dataset.memoryFocus = `${resource.id}:lifetime`;
		track.setAttribute('aria-label', `Inspect ${labelResource(resource)}; ${resource.lifetime ? `Order ${resource.lifetime.firstUse}–${resource.lifetime.lastUse}, inclusive` : 'lifetime unavailable'}`);
		track.addEventListener('click', () => this.callbacks.onSelect(selection));
		const slots = maxUse - minUse + 1;
		for (const value of ticks) { const grid = document.createElement('span'); grid.className = 'zenfg-inspector-memory-gridline'; grid.style.left = `${((value - minUse + .5) / slots) * 100}%`; grid.setAttribute('aria-hidden', 'true'); track.append(grid); }
		const bar = document.createElement('span'); bar.className = `zenfg-inspector-memory-bar ${resource.kind}`; bar.setAttribute('aria-hidden', 'true');
		if (resource.lifetime) { bar.style.left = `${((resource.lifetime.firstUse - minUse) / slots) * 100}%`; bar.style.width = `${((resource.lifetime.lastUse - resource.lifetime.firstUse + 1) / slots) * 100}%`; bar.title = `Pass Order ${resource.lifetime.firstUse}–${resource.lifetime.lastUse} (inclusive), not elapsed time`; }
		else bar.classList.add('empty'); track.append(bar);
		const size = document.createElement('span'); size.className = 'zenfg-inspector-memory-size';
		size.textContent = formatEstimatedBytes(resource.estimatedByteSize); size.title = `Logical estimate: ${formatEstimatedBytes(resource.estimatedByteSize)}`;
		size.dataset.state = resource.estimatedByteSize === undefined ? 'unknown' : 'known';
		const sizeLabel = document.createElement('span'); sizeLabel.className = 'zenfg-inspector-memory-size-label'; sizeLabel.textContent = 'Logical '; size.prepend(sizeLabel);
		row.append(name, range, track, size); return row;
	}
}

function compareSize(a: number | undefined, b: number | undefined): number { return a === undefined ? b === undefined ? 0 : 1 : b === undefined ? -1 : b - a; }
