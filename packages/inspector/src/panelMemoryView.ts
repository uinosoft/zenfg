import type { FrameGraphDebugResource, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { analyzeSnapshotAliases } from './panelAliasAnalysis.ts';
import { createMutedText, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';
import {
	createRelationButton,
	formatEstimatedBytes,
	registerSelectable,
	type WorkbenchCallbacks,
	updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

export class MemoryView {
	readonly root = document.createElement('section');
	private readonly metrics = document.createElement('div');
	private readonly scroller = document.createElement('div');
	private readonly timeline = document.createElement('div');
	private readonly rows = new Map<string, HTMLElement[]>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;

	constructor(private readonly callbacks: WorkbenchCallbacks) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-memory-view';
		this.root.id = 'zenfg-inspector-view-memory';
		this.root.setAttribute('role', 'tabpanel');
		this.metrics.className = 'zenfg-inspector-memory-summary';
		this.scroller.className = 'zenfg-inspector-memory-scroller';
		this.timeline.className = 'zenfg-inspector-memory-timeline';
		this.scroller.appendChild(this.timeline);
		this.root.append(this.metrics, this.scroller);
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		this.render();
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		updateSelectedRows(this.rows, selected);
	}

	private render(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		const metrics = snapshot.metrics;
		this.metrics.replaceChildren(
			this.createMetric('Logical capacity', formatEstimatedBytes(metrics.logicalCapacityBytes)),
			this.createMetric('Physical estimate', formatEstimatedBytes(metrics.physicalEstimatedBytes)),
			this.createMetric('Alias reuse', formatEstimatedBytes(metrics.aliasReuseBytes)),
			this.createMetric('Allocations', `${snapshot.physicalAllocations.length} · ${metrics.aliasedAllocationCount} aliased`),
		);
		this.rows.clear();
		this.timeline.replaceChildren();
		const analysis = analyzeSnapshotAliases(snapshot);
		this.timeline.appendChild(this.createAxis(analysis.minUse, analysis.maxUse));

		for (const group of analysis.allocations) {
			const selection: Selection = { kind: 'allocation', id: group.allocation.id };
			const header = document.createElement('div');
			header.className = 'zenfg-inspector-memory-allocation';
			header.dataset.kind = group.allocation.kind;
			registerSelectable(this.rows, header, selection, this.callbacks);
			const name = createRelationButton(`Allocation #${group.allocation.id}`, selection, this.callbacks.onSelect);
			const meta = document.createElement('span');
			meta.textContent = `${group.allocation.kind} · class ${group.allocation.compatibilityClassId} · ${formatEstimatedBytes(group.allocation.estimatedByteSize)} · ${group.resources.length > 1 ? `alias ×${group.resources.length}` : 'single'}`;
			header.append(name, meta);
			this.timeline.appendChild(header);
			for (const resource of group.resources) {
				this.timeline.appendChild(this.createResourceRow(resource, analysis.minUse, analysis.maxUse));
			}
		}

		const unallocated = snapshot.resources.filter((resource) => (
			resource.origin === 'transient' && resource.physicalResourceId === undefined
		));
		if (unallocated.length > 0) {
			const header = document.createElement('div');
			header.className = 'zenfg-inspector-memory-allocation muted';
			header.dataset.kind = 'unallocated';
			header.textContent = 'Unallocated transient resources';
			this.timeline.appendChild(header);
			for (const resource of unallocated) {
				this.timeline.appendChild(this.createResourceRow(resource, analysis.minUse, analysis.maxUse));
			}
		}
		if (analysis.allocations.length === 0 && unallocated.length === 0) {
			this.timeline.appendChild(createMutedText('No transient resource lifetimes.'));
		}
		updateSelectedRows(this.rows, this.selected);
	}

	private createMetric(label: string, value: string): HTMLElement {
		const item = document.createElement('div');
		const term = document.createElement('span');
		term.textContent = label;
		const amount = document.createElement('strong');
		amount.textContent = value;
		item.append(term, amount);
		return item;
	}

	private createAxis(minUse: number, maxUse: number): HTMLElement {
		const axis = document.createElement('div');
		axis.className = 'zenfg-inspector-memory-axis';
		const label = document.createElement('span');
		label.textContent = 'Execution order';
		const track = document.createElement('div');
		track.className = 'zenfg-inspector-memory-axis-track';
		const range = Math.max(1, maxUse - minUse);
		const step = Math.max(1, Math.ceil(range / 5));
		for (let value = minUse; value <= maxUse; value += step) {
			const tick = document.createElement('span');
			tick.style.left = `${((value - minUse) / range) * 100}%`;
			tick.textContent = String(value);
			track.appendChild(tick);
		}
		if (maxUse > minUse && (maxUse - minUse) % step !== 0) {
			const tick = document.createElement('span');
			tick.style.left = '100%';
			tick.textContent = String(maxUse);
			track.appendChild(tick);
		}
		axis.append(label, track);
		return axis;
	}

	private createResourceRow(resource: FrameGraphDebugResource, minUse: number, maxUse: number): HTMLElement {
		const selection: Selection = { kind: 'resource', id: resource.id };
		const row = document.createElement('div');
		row.className = 'zenfg-inspector-memory-resource';
		row.dataset.kind = resource.kind;
		registerSelectable(this.rows, row, selection, this.callbacks);
		const name = createRelationButton(labelResource(resource), selection, this.callbacks.onSelect);
		const range = document.createElement('span');
		range.textContent = resource.lifetime ? `${resource.lifetime.firstUse}–${resource.lifetime.lastUse}` : 'no lifetime';
		const track = document.createElement('div');
		track.className = 'zenfg-inspector-memory-track';
		const bar = document.createElement('span');
		bar.className = `zenfg-inspector-memory-bar ${resource.kind}`;
		if (resource.lifetime) {
			const slots = Math.max(1, maxUse - minUse + 1);
			bar.style.left = `${((resource.lifetime.firstUse - minUse) / slots) * 100}%`;
			bar.style.width = `${((resource.lifetime.lastUse - resource.lifetime.firstUse + 1) / slots) * 100}%`;
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
