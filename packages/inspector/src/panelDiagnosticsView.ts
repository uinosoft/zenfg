import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createCell, labelNode, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';
import {
	createEmptyTableRow,
	createKindCell,
	createRelationButton,
	createSelectionCell,
	createTableScroller,
	registerSelectable,
	type WorkbenchCallbacks,
	updateSelectedRows,
} from './panelWorkbenchHelpers.ts';

export class DiagnosticsView {
	readonly root = document.createElement('section');
	private readonly scroller = document.createElement('div');
	private readonly content = document.createElement('div');
	private readonly rows = new Map<string, HTMLElement[]>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;

	constructor(private readonly callbacks: WorkbenchCallbacks) {
		this.root.className = 'zenfg-inspector-view zenfg-inspector-diagnostics-view';
		this.root.id = 'zenfg-inspector-view-diagnostics';
		this.root.setAttribute('role', 'tabpanel');
		this.scroller.className = 'zenfg-inspector-diagnostics-scroller';
		this.content.className = 'zenfg-inspector-diagnostics-grid';
		this.scroller.appendChild(this.content);
		this.root.appendChild(this.scroller);
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
		this.rows.clear();
		this.content.replaceChildren(
			this.createRoots(snapshot),
			this.createCulled(snapshot),
			this.createSegments(snapshot),
			this.createTiming(snapshot),
		);
		updateSelectedRows(this.rows, this.selected);
	}

	private createSection(title: string, description?: string): HTMLElement {
		const section = document.createElement('section');
		section.className = 'zenfg-inspector-diagnostic-card';
		const heading = document.createElement('h2');
		heading.textContent = title;
		section.appendChild(heading);
		if (description) {
			const text = document.createElement('p');
			text.textContent = description;
			section.appendChild(text);
		}
		return section;
	}

	private createRoots(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = this.createSection('Retention roots', 'Roots explain why graph work survived dead-node elimination.');
		const list = document.createElement('div');
		list.className = 'zenfg-inspector-diagnostic-list';
		snapshot.roots.forEach((root, index) => {
			const selection: Selection = { kind: 'root', index };
			const button = createRelationButton(
				`${root.reason} · ${root.resource ? labelResource(root.resource) : root.nodeId === undefined ? '-' : `node-${root.nodeId}`}`,
				selection,
				this.callbacks.onSelect,
			);
			registerSelectable(this.rows, button, selection, this.callbacks);
			list.appendChild(button);
		});
		if (snapshot.roots.length === 0) list.textContent = 'No retention roots.';
		section.appendChild(list);
		return section;
	}

	private createCulled(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = this.createSection('Culled nodes', 'Recorded nodes that were not reachable from a retention root.');
		const table = createTableScroller([{ label: 'Node' }, { label: 'Kind', column: 'kind' }, { label: 'Reason' }]);
		for (const [index, entry] of snapshot.culledNodes.entries()) {
			const selection: Selection = { kind: 'culled', index };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			row.append(
				createSelectionCell(labelNode(entry.node), selection, this.callbacks),
				createKindCell(entry.node.kind),
				createCell(entry.reason),
			);
			table.body.appendChild(row);
		}
		if (snapshot.culledNodes.length === 0) table.body.appendChild(createEmptyTableRow(3, 'No culled nodes.'));
		section.appendChild(table.scroller);
		return section;
	}

	private createSegments(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const section = this.createSection(
			'Execution segments',
			'An opaque interval is a graph boundary around external work; it is not a count or timing of third-party GPU submissions.',
		);
		const table = createTableScroller([{ label: '#', column: 'numeric' }, { label: 'Kind', column: 'kind' }, { label: 'Nodes' }]);
		for (const segment of snapshot.executionSegments) {
			const selection: Selection = { kind: 'segment', index: segment.index };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			const labels = segment.nodeIds.map((id) => snapshot.nodeById.get(id))
				.filter((node) => node !== undefined)
				.map((node) => labelNode(node));
			row.append(
				createSelectionCell(String(segment.index), selection, this.callbacks, 'numeric'),
				createKindCell(segment.kind, segment.kind === 'frame-graph' ? 'FrameGraph command segment' : 'Opaque interval'),
				createCell(labels.join(', ') || '-'),
			);
			table.body.appendChild(row);
		}
		if (snapshot.executionSegments.length === 0) table.body.appendChild(createEmptyTableRow(3, 'No execution segments.'));
		section.appendChild(table.scroller);
		return section;
	}

	private createTiming(snapshot: FrameGraphDebugViewModel): HTMLElement {
		const metrics = snapshot.metrics;
		const coverage = metrics.timingEligibleNodeCount === 0
			? 'No eligible render or compute passes'
			: `${metrics.timedNodeCount}/${metrics.timingEligibleNodeCount} eligible passes timed (${((metrics.timedNodeCount / metrics.timingEligibleNodeCount) * 100).toFixed(0)}%)`;
		const section = this.createSection('GPU timing coverage', coverage);
		if (snapshot.profiling.status === 'unavailable') {
			const status = document.createElement('p');
			status.textContent = `Timing unavailable: ${snapshot.profiling.reason}.`;
			section.appendChild(status);
		}
		const table = createTableScroller([{ label: 'Pass' }, { label: 'Status', column: 'kind' }, { label: 'GPU (ms)', column: 'numeric' }]);
		for (const node of snapshot.nodes.filter((candidate) => candidate.kind === 'render' || candidate.kind === 'compute')) {
			const selection: Selection = { kind: 'node', id: node.id };
			const row = document.createElement('tr');
			registerSelectable(this.rows, row, selection, this.callbacks);
			row.append(
				createSelectionCell(labelNode(node), selection, this.callbacks),
				createKindCell(node.gpuDurationMicros === undefined ? 'not-timed' : 'timed', node.gpuDurationMicros === undefined ? 'Not timed' : 'Timed'),
				createCell(node.gpuDurationMicros === undefined ? '-' : (node.gpuDurationMicros / 1000).toFixed(3), { column: 'numeric' }),
			);
			table.body.appendChild(row);
		}
		if (table.body.childElementCount === 0) table.body.appendChild(createEmptyTableRow(3, 'No timing-eligible passes.'));
		section.appendChild(table.scroller);
		return section;
	}
}
