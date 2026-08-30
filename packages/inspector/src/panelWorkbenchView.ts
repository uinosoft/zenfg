import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import {
	formatBytes,
	formatGpuFrameDuration,
	formatPoolHitRate,
	labelNode,
} from './panelDomHelpers.ts';
import { createPanelIcon, setPanelButtonContent } from './panelIcons.ts';
import { DiagnosticsView } from './panelDiagnosticsView.ts';
import { InspectorView } from './panelInspectorView.ts';
import { MemoryView } from './panelMemoryView.ts';
import { PassesView } from './panelPassesView.ts';
import { ResourcesView } from './panelResourcesView.ts';
import { renderGraphView, resizeGraph } from './panelGraphView.ts';
import type { GraphViewState, Selection, WorkbenchTab } from './panelTypes.ts';
import { formatEstimatedBytes, type WorkbenchCallbacks } from './panelWorkbenchHelpers.ts';

export type FrameGraphDebugWorkbenchActions = {
	onCapture(): void;
	onImport(file: File): void;
	onDownload(): void;
	onCopyJson(): void;
};
export type FrameGraphDebugEmptyStateKind = 'waiting' | 'capturing' | 'empty' | 'error';


export type FrameGraphDebugSnapshotActionState = {
	providerAvailable: boolean;
	hasCapture: boolean;
	capturing: boolean;
	importing: boolean;
	copying: boolean;
	copied: boolean;
	message?: string;
	messageTone?: 'neutral' | 'error';
};

export class FrameGraphDebugWorkbench {
	readonly root = document.createElement('div');
	private readonly summary = document.createElement('div');
	private readonly commandBar = document.createElement('div');
	private readonly tabList = document.createElement('div');
	private readonly commandActions = document.createElement('div');
	private readonly commandStatus = document.createElement('span');
	private readonly workspace = document.createElement('div');
	private readonly main = document.createElement('main');
	private readonly emptyHost = document.createElement('div');
	private readonly graphRoot = document.createElement('section');
	private readonly passes: PassesView;
	private readonly resources: ResourcesView;
	private readonly memory: MemoryView;
	private readonly diagnostics: DiagnosticsView;
	private readonly inspector: InspectorView;
	private readonly inspectorOpenButton = document.createElement('button');
	private readonly captureButton = document.createElement('button');
	private readonly importButton = document.createElement('button');
	private readonly importInput = document.createElement('input');
	private readonly exportButton = document.createElement('button');
	private readonly exportMenu = document.createElement('div');
	private readonly downloadButton = document.createElement('button');
	private readonly copyButton = document.createElement('button');
	private readonly tabButtons = new Map<WorkbenchTab, HTMLButtonElement>();
	private readonly views = new Map<WorkbenchTab, HTMLElement>();
	private activeTab: WorkbenchTab = 'graph';
	private hasSnapshot = false;
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private hovered: Selection | undefined;

	constructor(
		private readonly graphView: GraphViewState,
		private readonly callbacks: WorkbenchCallbacks,
		actions: FrameGraphDebugWorkbenchActions,
	) {
		this.root.className = 'zenfg-inspector-workbench';
		this.summary.className = 'zenfg-inspector-capture-summary';
		this.commandBar.className = 'zenfg-inspector-workbench-command-bar';
		this.tabList.className = 'zenfg-inspector-workbench-tabs';
		this.tabList.setAttribute('role', 'tablist');
		this.tabList.setAttribute('aria-label', 'FrameGraph debug views');
		this.commandActions.className = 'zenfg-inspector-workbench-actions';
		this.commandActions.setAttribute('role', 'toolbar');
		this.commandActions.setAttribute('aria-label', 'FrameGraph commands');
		this.commandStatus.className = 'zenfg-inspector-command-status';
		this.commandStatus.setAttribute('role', 'status');
		this.commandStatus.setAttribute('aria-live', 'polite');
		this.workspace.className = 'zenfg-inspector-workspace inspector-open';
		this.main.className = 'zenfg-inspector-main';
		this.emptyHost.className = 'zenfg-inspector-workbench-empty';
		this.emptyHost.setAttribute('role', 'status');
		this.emptyHost.setAttribute('aria-live', 'polite');

		this.graphRoot.className = 'zenfg-inspector-view zenfg-inspector-graph-view';
		this.graphRoot.id = 'zenfg-inspector-view-graph';
		this.graphRoot.setAttribute('role', 'tabpanel');
		this.graphRoot.append(this.graphView.toolbar, this.graphView.host);
		this.passes = new PassesView(callbacks);
		this.resources = new ResourcesView(callbacks);
		this.memory = new MemoryView(callbacks);
		this.diagnostics = new DiagnosticsView(callbacks);
		this.inspector = new InspectorView(callbacks, (open) => this.handleInspectorOpenChange(open));

		this.views.set('graph', this.graphRoot);
		this.views.set('passes', this.passes.root);
		this.views.set('resources', this.resources.root);
		this.views.set('memory', this.memory.root);
		this.views.set('diagnostics', this.diagnostics.root);
		for (const [tab, label] of [
			['graph', 'Graph'],
			['passes', 'Passes'],
			['resources', 'Resources'],
			['memory', 'Memory'],
			['diagnostics', 'Diagnostics'],
		] as const) {
			const button = document.createElement('button');
			button.type = 'button';
			button.id = `zenfg-inspector-tab-${tab}`;
			button.textContent = label;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', `zenfg-inspector-view-${tab}`);
			button.addEventListener('click', () => this.setActiveTab(tab));
			this.tabButtons.set(tab, button);
			this.tabList.appendChild(button);
		}

		this.inspectorOpenButton.type = 'button';
		this.inspectorOpenButton.hidden = true;
		this.inspectorOpenButton.className = 'zenfg-inspector-open-inspector';
		setPanelButtonContent(this.inspectorOpenButton, 'inspector', 'Inspector');
		this.inspectorOpenButton.title = 'Open selection inspector';
		this.inspectorOpenButton.addEventListener('click', () => this.inspector.setOpen(true));

		this.captureButton.type = 'button';
		this.captureButton.className = 'zenfg-inspector-capture-action';
		this.captureButton.addEventListener('click', actions.onCapture);
		this.importButton.type = 'button';
		this.importButton.textContent = 'Import';
		this.importButton.addEventListener('click', () => this.importInput.click());
		this.importInput.type = 'file';
		this.importInput.accept = '.fgsnapshot.json,.json,application/json';
		this.importInput.hidden = true;
		this.importInput.addEventListener('change', () => {
			const file = this.importInput.files?.[0];
			this.importInput.value = '';
			if (file) actions.onImport(file);
		});
		this.exportButton.type = 'button';
		this.exportButton.textContent = 'Export';
		this.exportButton.setAttribute('aria-haspopup', 'menu');
		this.exportButton.setAttribute('aria-expanded', 'false');
		this.exportButton.addEventListener('click', () => {
			const open = this.exportMenu.hidden;
			this.exportMenu.hidden = !open;
			this.exportButton.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
		this.exportMenu.className = 'zenfg-inspector-export-menu';
		this.exportMenu.setAttribute('role', 'menu');
		this.exportMenu.hidden = true;
		this.downloadButton.type = 'button';
		this.downloadButton.textContent = 'Download JSON';
		this.downloadButton.setAttribute('role', 'menuitem');
		this.downloadButton.addEventListener('click', () => {
			this.exportMenu.hidden = true;
			this.exportButton.setAttribute('aria-expanded', 'false');
			actions.onDownload();
		});
		this.copyButton.type = 'button';
		this.copyButton.className = 'zenfg-inspector-copy-action';
		this.copyButton.textContent = 'Copy JSON';
		this.copyButton.setAttribute('role', 'menuitem');
		this.copyButton.addEventListener('click', () => {
			this.exportMenu.hidden = true;
			this.exportButton.setAttribute('aria-expanded', 'false');
			actions.onCopyJson();
		});
		this.exportMenu.append(this.downloadButton, this.copyButton);

		this.commandActions.append(
			this.commandStatus,
			this.inspectorOpenButton,
			this.captureButton,
			this.importButton,
			this.exportButton,
			this.exportMenu,
			this.importInput,
		);
		this.commandBar.append(this.tabList, this.commandActions);
		this.main.append(this.emptyHost, ...this.views.values());
		this.workspace.append(this.main, this.inspector.root);
		this.root.append(this.summary, this.commandBar, this.workspace);
		this.showEmptyState('waiting', 'Waiting for a FrameGraph capture source.');
		this.setSnapshotActionState({
			providerAvailable: false,
			hasCapture: false,
			capturing: false,
			importing: false,
			copying: false,
			copied: false,
		});
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel, selected: Selection | undefined): void {
		this.hasSnapshot = true;
		this.snapshot = snapshot;
		this.selected = selected;
		this.hovered = undefined;
		this.renderSummary(snapshot);
		this.passes.setSnapshot(snapshot);
		this.resources.setSnapshot(snapshot);
		this.memory.setSnapshot(snapshot);
		this.diagnostics.setSnapshot(snapshot);
		this.inspector.setSnapshot(snapshot);
		this.passes.setSelection(selected);
		this.resources.setSelection(selected);
		this.memory.setSelection(selected);
		this.diagnostics.setSelection(selected);
		this.inspector.setSelection(selected, false);
		this.summary.hidden = false;
		this.emptyHost.hidden = true;
		this.updateActiveTab();
		this.updateWorkspaceState();
		if (this.activeTab === 'graph') this.renderGraph();
	}

	showEmptyState(kind: FrameGraphDebugEmptyStateKind, message: string): void {
		this.hasSnapshot = false;
		this.snapshot = undefined;
		this.selected = undefined;
		this.hovered = undefined;
		this.summary.hidden = true;
		this.emptyHost.hidden = false;
		this.emptyHost.dataset.state = kind;
		const icon = createPanelIcon(kind === 'capturing' ? 'spinner' : kind === 'error' ? 'error' : kind === 'waiting' ? 'waiting' : 'empty');
		const label = document.createElement('span');
		label.className = 'zenfg-inspector-empty-message';
		label.textContent = message;
		this.emptyHost.replaceChildren(icon, label);
		this.updateActiveTab();
		this.updateWorkspaceState();
	}

	setSnapshotActionState(state: FrameGraphDebugSnapshotActionState): void {
		const captureLabel = state.capturing ? 'Capturing…' : 'Capture';
		setPanelButtonContent(this.captureButton, state.capturing ? 'spinner' : 'capture', captureLabel);
		this.captureButton.disabled = state.capturing || !state.providerAvailable;
		this.captureButton.classList.toggle('active', state.capturing);
		this.captureButton.setAttribute('aria-busy', state.capturing ? 'true' : 'false');
		this.captureButton.dataset.tone = state.capturing ? 'pending' : 'accent';
		this.captureButton.title = !state.providerAvailable
			? 'Waiting for a FrameGraph capture source.'
			: state.capturing
				? 'Capturing the next rendered frame.'
				: 'Capture and display the next rendered frame.';

		this.importButton.textContent = state.importing ? 'Importing…' : 'Import';
		this.importButton.disabled = state.importing;
		this.importButton.setAttribute('aria-busy', state.importing ? 'true' : 'false');
		this.exportButton.disabled = !state.hasCapture;
		this.downloadButton.disabled = !state.hasCapture;

		const copyLabel = state.copying ? 'Copying…' : state.copied ? 'Copied' : 'Copy JSON';
		const copyIcon = state.copying ? 'spinner' : state.copied ? 'check' : 'copy';
		setPanelButtonContent(this.copyButton, copyIcon, copyLabel);
		this.copyButton.disabled = !state.hasCapture || state.copying;
		this.copyButton.classList.toggle('active', state.copying || state.copied);
		this.copyButton.setAttribute('aria-busy', state.copying ? 'true' : 'false');
		this.copyButton.dataset.tone = state.copied ? 'success' : state.copying ? 'pending' : 'neutral';
		this.copyButton.title = state.hasCapture
			? 'Copy the current canonical FrameGraph Snapshot JSON.'
			: 'Load a snapshot before exporting.';

		this.commandStatus.textContent = state.message ?? '';
		this.commandStatus.hidden = !state.message;
		this.commandStatus.dataset.tone = state.message ? state.messageTone ?? 'error' : 'neutral';
		if (state.message) this.commandStatus.title = state.message;
		else this.commandStatus.removeAttribute('title');
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		this.passes.setSelection(selected);
		this.resources.setSelection(selected);
		this.memory.setSelection(selected);
		this.diagnostics.setSelection(selected);
		this.inspector.setSelection(selected);
		if (this.activeTab === 'graph') this.renderGraph();
	}

	setHovered(hovered: Selection | undefined): void {
		this.hovered = hovered;
		if (this.activeTab === 'graph') this.renderGraph();
	}

	setActiveTab(tab: WorkbenchTab): void {
		if (this.activeTab === tab) return;
		this.activeTab = tab;
		this.updateActiveTab();
		if (tab === 'graph') {
			window.requestAnimationFrame(() => {
				resizeGraph(this.graphView);
				this.renderGraph();
			});
		}
	}

	refreshGraphStructure(): void {
		if (!this.snapshot) return;
		this.passes.setSnapshot(this.snapshot);
		if (this.activeTab === 'graph') this.renderGraph();
	}

	resizeGraph(fit = false): void {
		if (fit) this.graphView.fitOnNextRender = true;
		window.requestAnimationFrame(() => {
			resizeGraph(this.graphView);
			if (this.activeTab === 'graph') this.renderGraph();
		});
	}

	private updateActiveTab(): void {
		for (const [tab, button] of this.tabButtons) {
			const active = tab === this.activeTab;
			button.disabled = !this.hasSnapshot;
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', active ? 'true' : 'false');
			const view = this.views.get(tab)!;
			view.hidden = !this.hasSnapshot || !active;
			view.setAttribute('aria-labelledby', button.id);
		}
	}

	private renderGraph(): void {
		if (!this.snapshot) return;
		renderGraphView(
			this.graphView,
			this.snapshot,
			this.selected,
			this.hovered,
			this.callbacks.onSelect,
			this.callbacks.onHover,
			this.callbacks.onGroupToggle,
		);
	}

	private renderSummary(snapshot: FrameGraphDebugViewModel): void {
		const frameGraphSegments = snapshot.executionSegments.filter((segment) => segment.kind === 'frame-graph').length;
		const opaqueIntervals = snapshot.executionSegments.length - frameGraphSegments;
		const metrics = snapshot.metrics;
		const coverage = metrics.timingEligibleNodeCount === 0
			? 'No eligible passes'
			: `${metrics.timedNodeCount}/${metrics.timingEligibleNodeCount} timed`;
		const slowest = metrics.slowestNode
			? `${labelNode(metrics.slowestNode)} · ${(metrics.slowestNode.gpuDurationMicros! / 1000).toFixed(3)} ms`
			: 'Unknown';
		const protocol = snapshot.protocol;
		const runtime = protocol.producer.runtime;
		const producer = [
			protocol.producer.name,
			protocol.producer.version,
			protocol.producer.language,
		].filter(Boolean).join(' · ');
		const runtimeLabel = runtime
			? [runtime.implementation, runtime.graphicsApi, runtime.backend].filter(Boolean).join(' · ') || 'Unknown'
			: 'Unknown';
		const poolRetained = snapshot.resourcePool.status === 'available'
			? `${snapshot.resourcePool.estimatedRetainedBytes === undefined ? 'Unknown' : formatBytes(snapshot.resourcePool.estimatedRetainedBytes)} · ${snapshot.resourcePool.retainedCount} allocations`
			: 'Unavailable';
		this.summary.replaceChildren(
			this.createSummaryGroup('Capture', [
				['Source', snapshot.source.label],
				['Schema', `${protocol.format} v${protocol.version.major}.${protocol.version.minor}`],
				['Producer', producer],
				['Runtime', runtimeLabel],
				['Frame', String(snapshot.frameIndex)],
				...(snapshot.source.migratedFromLegacy ? [['Migration', 'Legacy V0 → V1'] as const] : []),
				['Timing', snapshot.profiling.status === 'available' ? 'Available' : snapshot.profiling.reason],
			]),
			this.createSummaryGroup('GPU', [
				['GPU Span', snapshot.profiling.status === 'available' ? `${formatGpuFrameDuration(snapshot)} ms` : 'Unknown'],
				['Coverage', coverage],
				['Slowest', slowest],
			]),
			this.createSummaryGroup('Work', [
				['Nodes', `${snapshot.nodes.length} retained · ${snapshot.culledNodes.length} culled`],
				['Segments', `${frameGraphSegments} FG · ${opaqueIntervals} opaque`],
				['Groups', snapshot.availability.groups ? String(snapshot.debugGroups.length) : 'Unknown'],
				['Recording order', snapshot.availability.recordingOrder ? 'Available' : 'Unknown'],
			]),
			this.createSummaryGroup('Resources', [
				['Logical / physical', `${snapshot.resources.length} / ${snapshot.physicalAllocations.length}`],
				['Texture views', snapshot.availability.textureViews ? String(snapshot.textureViewById.size) : 'Unknown'],
				['Access regions', snapshot.availability.accessRegions ? 'Available' : 'Unknown'],
				['Transient estimate', formatEstimatedBytes(metrics.transientEstimatedByteSize)],
			]),
			this.createSummaryGroup('Pool', [
				['Retained', poolRetained],
				['Reuse', formatPoolHitRate(snapshot)],
			]),
		);
	}

	private createSummaryGroup(title: string, rows: readonly (readonly [string, string])[]): HTMLElement {
		const group = document.createElement('section');
		const heading = document.createElement('h2');
		heading.textContent = title;
		group.appendChild(heading);
		for (const [label, value] of rows) {
			const row = document.createElement('div');
			const term = document.createElement('span');
			term.textContent = label;
			const description = document.createElement('strong');
			description.textContent = value;
			description.title = value;
			row.append(term, description);
			group.appendChild(row);
		}
		return group;
	}

	private handleInspectorOpenChange(_open: boolean): void {
		this.updateWorkspaceState();
		if (this.activeTab === 'graph') this.resizeGraph(false);
	}

	private updateWorkspaceState(): void {
		const inspectorOpen = this.hasSnapshot && this.inspector.isOpen;
		this.workspace.classList.toggle('has-capture', this.hasSnapshot);
		this.workspace.classList.toggle('inspector-open', inspectorOpen);
		this.inspector.root.classList.toggle('unavailable', !this.hasSnapshot);
		this.inspectorOpenButton.hidden = !this.hasSnapshot || inspectorOpen;
	}
}
