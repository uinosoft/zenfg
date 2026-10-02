import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createPanelIcon, setPanelButtonContent } from './panelIcons.ts';
import { DiagnosticsView } from './panelDiagnosticsView.ts';
import { InspectorView } from './panelInspectorView.ts';
import { MemoryView } from './panelMemoryView.ts';
import { OverviewView } from './panelOverviewView.ts';
import { PassesView } from './panelPassesView.ts';
import { ResourcesView } from './panelResourcesView.ts';
import { renderGraphView, resizeGraph } from './panelGraphView.ts';
import { DetailLayout } from './panelDetailLayout.ts';
import { GraphSearch } from './panelGraphSearch.ts';
import type { GraphViewState, Selection, WorkbenchTab } from './panelTypes.ts';
import { enableTabKeyboard, type WorkbenchCallbacks } from './panelWorkbenchHelpers.ts';

export type FrameGraphDebugWorkbenchActions = {
	onCapture(): void;
	onImport(file: File): void;
	onDownload(): void;
	onCopyJson(): void;
};
export type FrameGraphDebugWorkbenchOptions = {
	branding: string | false;
	idPrefix: string;
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
	private readonly commandBar = document.createElement('div');
	private readonly brand = document.createElement('div');
	private readonly tabList = document.createElement('div');
	private readonly commandActions = document.createElement('div');
	private readonly commandStatus = document.createElement('span');
	private readonly feedback = document.createElement('details');
	private readonly feedbackTitle = document.createElement('summary');
	private readonly workspace = document.createElement('div');
	private readonly main = document.createElement('main');
	private readonly emptyHost = document.createElement('div');
	private readonly overviewRoot = document.createElement('section');
	private readonly overview: OverviewView;
	private readonly graphRoot = document.createElement('section');
	private readonly passes: PassesView;
	private readonly resources: ResourcesView;
	private readonly memory: MemoryView;
	private readonly diagnostics: DiagnosticsView;
	private readonly inspector: InspectorView;
	private readonly detailLayout: DetailLayout;
	private readonly graphSearch: GraphSearch;
	private readonly dirtyViews = new Set<WorkbenchTab>();
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
	private destroyed = false;

	constructor(
		private readonly graphView: GraphViewState,
		private readonly callbacks: WorkbenchCallbacks,
		actions: FrameGraphDebugWorkbenchActions,
		options: FrameGraphDebugWorkbenchOptions,
	) {
		this.root.className = 'zenfg-inspector-workbench';
		this.overview = new OverviewView(callbacks);
		this.commandBar.className = 'zenfg-inspector-workbench-command-bar';
		this.brand.className = 'zenfg-inspector-brand';
		if (options.branding === false) this.commandBar.classList.add('branding-hidden');
		else this.brand.textContent = options.branding;
		this.tabList.className = 'zenfg-inspector-workbench-tabs';
		this.tabList.setAttribute('role', 'tablist');
		this.tabList.setAttribute('aria-label', 'FrameGraph debug views');
		this.commandActions.className = 'zenfg-inspector-workbench-actions';
		this.commandActions.setAttribute('role', 'toolbar');
		this.commandActions.setAttribute('aria-label', 'FrameGraph commands');
		this.commandStatus.className = 'zenfg-inspector-command-status';
		this.commandStatus.setAttribute('role', 'status');
		this.commandStatus.setAttribute('aria-live', 'polite');
		this.workspace.className = 'zenfg-inspector-workspace';
		this.main.className = 'zenfg-inspector-main';
		this.emptyHost.className = 'zenfg-inspector-workbench-empty';
		this.emptyHost.setAttribute('role', 'status');
		this.emptyHost.setAttribute('aria-live', 'polite');

		this.overviewRoot.className = 'zenfg-inspector-view zenfg-inspector-overview-view';
		this.overviewRoot.id = `${options.idPrefix}-view-overview`;
		this.overviewRoot.setAttribute('role', 'tabpanel');
		this.overviewRoot.append(this.overview.root);
		this.graphRoot.className = 'zenfg-inspector-view zenfg-inspector-graph-view';
		this.graphRoot.id = `${options.idPrefix}-view-graph`;
		this.graphRoot.setAttribute('role', 'tabpanel');
		const graphViewport = document.createElement('div');
		graphViewport.className = 'zenfg-inspector-graph-viewport';
		graphViewport.append(this.graphView.host, this.graphView.toolbar);
		if (this.graphView.legend) {
			const legend = document.createElement('details');
			legend.className = 'zenfg-inspector-legend-details';
			const title = document.createElement('summary');
			title.textContent = 'Legend';
			legend.append(title, this.graphView.legend);
			graphViewport.append(legend);
		}
		this.graphRoot.append(graphViewport);
		this.passes = new PassesView(callbacks, options.idPrefix);
		this.resources = new ResourcesView(callbacks, options.idPrefix);
		this.memory = new MemoryView(callbacks, options.idPrefix);
		this.diagnostics = new DiagnosticsView(callbacks, options.idPrefix);
		this.inspector = new InspectorView(callbacks, (open) => this.handleInspectorOpenChange(open), options.idPrefix);
		this.graphSearch = new GraphSearch((selection) => callbacks.onReveal?.(selection, 'graph'), `${options.idPrefix}-graph-search`);
		this.graphView.toolbar.prepend(this.graphSearch.root);

		this.views.set('overview', this.overviewRoot);
		this.views.set('graph', this.graphRoot);
		this.views.set('passes', this.passes.root);
		this.views.set('resources', this.resources.root);
		this.views.set('memory', this.memory.root);
		this.views.set('diagnostics', this.diagnostics.root);
		for (const [tab, label] of [
			['overview', 'Overview'],
			['graph', 'Graph'],
			['passes', 'Passes'],
			['resources', 'Resources'],
			['memory', 'Memory'],
			['diagnostics', 'Diagnostics'],
		] as const) {
			const button = document.createElement('button');
			button.type = 'button';
			button.id = `${options.idPrefix}-tab-${tab}`;
			button.textContent = label;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', `${options.idPrefix}-view-${tab}`);
			button.addEventListener('click', () => this.setActiveTab(tab));
			this.tabButtons.set(tab, button);
			this.tabList.appendChild(button);
		}
		enableTabKeyboard(this.tabList);

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
		this.importButton.className = 'zenfg-inspector-import-action';
		setPanelButtonContent(this.importButton, 'import', 'Import');
		this.importButton.title = 'Import a FrameGraph Snapshot JSON file';
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
		this.exportButton.className = 'zenfg-inspector-export-action';
		setPanelButtonContent(this.exportButton, 'download', 'Export');
		this.exportButton.title = 'Export the current FrameGraph Snapshot';
		this.exportButton.append(createPanelIcon('chevron-down'));
		this.exportButton.setAttribute('aria-haspopup', 'menu');
		this.exportButton.setAttribute('aria-expanded', 'false');
		this.exportButton.setAttribute('aria-controls', `${options.idPrefix}-export-menu`);
		this.exportButton.addEventListener('click', () => {
			this.setExportMenuOpen(this.exportMenu.hidden !== false);
		});
		this.exportMenu.className = 'zenfg-inspector-export-menu';
		this.exportMenu.id = `${options.idPrefix}-export-menu`;
		this.exportMenu.setAttribute('role', 'menu');
		this.exportMenu.hidden = true;
		this.downloadButton.type = 'button';
		this.downloadButton.className = 'zenfg-inspector-download-action';
		setPanelButtonContent(this.downloadButton, 'download', 'Download JSON');
		this.downloadButton.setAttribute('role', 'menuitem');
		this.downloadButton.addEventListener('click', () => {
			this.setExportMenuOpen(false);
			actions.onDownload();
		});
		this.copyButton.type = 'button';
		this.copyButton.className = 'zenfg-inspector-copy-action';
		this.copyButton.textContent = 'Copy JSON';
		this.copyButton.setAttribute('role', 'menuitem');
		this.copyButton.addEventListener('click', () => {
			this.setExportMenuOpen(false);
			actions.onCopyJson();
		});
		this.exportMenu.append(this.downloadButton, this.copyButton);

		this.commandActions.append(
			this.inspectorOpenButton,
			this.captureButton,
			this.importButton,
			this.exportButton,
			this.importInput,
		);
		if (options.branding === false) this.commandBar.append(this.tabList, this.commandActions, this.exportMenu);
		else this.commandBar.append(this.brand, this.tabList, this.commandActions, this.exportMenu);
		this.root.addEventListener('click', (event) => {
			const target = event.target;
			if (!target || typeof (target as Node).nodeType !== 'number' || this.exportMenu.hidden) return;
			const targetNode = target as Node;
			if (!this.exportButton.contains(targetNode) && !this.exportMenu.contains(targetNode)) this.setExportMenuOpen(false);
		});
		this.root.addEventListener('keydown', (event) => this.handleMenuKey(event));
		this.main.append(this.emptyHost, ...this.views.values());
		this.workspace.append(this.main, this.inspector.root);
		this.feedback.className = 'zenfg-inspector-feedback';
		this.feedback.hidden = true;
		this.feedback.append(this.feedbackTitle, this.commandStatus);
		this.root.append(this.commandBar, this.feedback, this.workspace);
		this.detailLayout = new DetailLayout(this.workspace, this.main, this.inspector.root, this.commandBar, () => this.inspector.setOpen(false));
		this.workspace.addEventListener('detail-layout-change', () => this.resizeGraph());
		this.showEmptyState('empty', 'Drop a ZenFG Snapshot here or choose Import.', 'Files are processed locally in your browser.');
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
		for (const tab of this.views.keys()) this.dirtyViews.add(tab);
		this.renderDiagnosticBadge(snapshot);
		this.graphSearch.setSnapshot(snapshot);
		this.inspector.setSnapshot(snapshot);
		this.inspector.setSelection(selected, false);
		this.emptyHost.hidden = true;
		this.ensureActiveView();
		this.updateActiveTab();
		this.updateWorkspaceState();
		if (this.activeTab === 'graph') this.renderGraph();
	}

	showEmptyState(kind: FrameGraphDebugEmptyStateKind, message: string, detail?: string): void {
		this.hasSnapshot = false;
		this.snapshot = undefined;
		this.selected = undefined;
		this.hovered = undefined;
		this.emptyHost.hidden = false;
		this.emptyHost.dataset.state = kind;
		const icon = createPanelIcon(kind === 'capturing' ? 'spinner' : kind === 'error' ? 'error' : kind === 'waiting' ? 'waiting' : 'empty');
		const label = document.createElement('span');
		label.className = 'zenfg-inspector-empty-message';
		label.textContent = message;
		const detailLabel = document.createElement('span');
		detailLabel.className = 'zenfg-inspector-empty-detail';
		detailLabel.textContent = detail ?? '';
		this.emptyHost.replaceChildren(icon, label, ...(detail ? [detailLabel] : []));
		this.updateActiveTab();
		this.updateWorkspaceState();
	}

	setSnapshotActionState(state: FrameGraphDebugSnapshotActionState): void {
		const captureLabel = state.capturing ? 'Capturing…' : 'Capture';
		setPanelButtonContent(this.captureButton, state.capturing ? 'spinner' : 'capture', captureLabel);
		this.captureButton.disabled = state.capturing || !state.providerAvailable;
		this.captureButton.hidden = !state.providerAvailable;
		this.captureButton.classList.toggle('active', state.capturing);
		this.captureButton.setAttribute('aria-busy', state.capturing ? 'true' : 'false');
		this.captureButton.dataset.tone = state.capturing ? 'pending' : 'accent';
		this.captureButton.title = !state.providerAvailable
			? 'Waiting for a FrameGraph capture source.'
			: state.capturing
				? 'Capturing the next rendered frame.'
				: 'Capture and display the next rendered frame.';

		setPanelButtonContent(this.importButton, state.importing ? 'spinner' : 'import', state.importing ? 'Importing…' : 'Import');
		this.importButton.disabled = state.importing;
		this.importButton.setAttribute('aria-busy', state.importing ? 'true' : 'false');
		this.exportButton.disabled = !state.hasCapture;
		this.downloadButton.disabled = !state.hasCapture;
		if (!state.hasCapture) this.setExportMenuOpen(false);

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
		this.feedback.hidden = !state.message;
		this.feedback.dataset.tone = state.messageTone ?? 'neutral';
		this.feedbackTitle.textContent = state.message ? state.messageTone === 'error' ? 'Operation failed · show details' : 'Operation feedback · show details' : '';
	}

	setSelection(selected: Selection | undefined): void {
		this.selected = selected;
		this.updateActiveSelection();
		this.inspector.setSelection(selected);
		if (this.activeTab === 'graph') this.renderGraph();
	}

	setHovered(hovered: Selection | undefined): void {
		this.hovered = hovered;
		if (this.activeTab === 'graph') this.renderGraph();
	}

	setActiveTab(tab: WorkbenchTab): void {
		if (this.destroyed) return;
		if (this.activeTab === tab) return;
		if (this.activeTab === 'graph') {
			this.graphView.revealOnNextRender = undefined;
			this.graphView.renderer?.cancelReveal?.();
		}
		this.activeTab = tab;
		this.updateActiveTab();
		this.ensureActiveView();
		this.updateWorkspaceState();
		if (tab === 'graph') {
			window.requestAnimationFrame(() => {
				if (this.destroyed || this.activeTab !== 'graph') return;
				resizeGraph(this.graphView);
				this.renderGraph();
			});
		}
	}

	refreshGraphStructure(): void {
		if (!this.snapshot) return;
		if (this.activeTab === 'graph') this.renderGraph();
	}

	resizeGraph(fit = false): void {
		if (fit) this.graphView.fitOnNextRender = true;
		window.requestAnimationFrame(() => {
			if (this.destroyed) return;
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
			button.tabIndex = active ? 0 : -1;
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
		this.overview.setSnapshot(snapshot);
	}

	private setExportMenuOpen(open: boolean): void {
		this.exportMenu.hidden = !open;
		this.exportButton.setAttribute('aria-expanded', open ? 'true' : 'false');
		if (open) this.downloadButton.focus();
	}

	private handleInspectorOpenChange(_open: boolean): void {
		this.updateWorkspaceState();
		if (this.activeTab === 'graph') this.resizeGraph(false);
	}

	private updateWorkspaceState(): void {
		const inspectorOpen = this.hasSnapshot && this.inspector.isOpen && this.activeTab !== 'overview';
		this.workspace.classList.toggle('has-capture', this.hasSnapshot);
		this.inspector.root.classList.toggle('unavailable', !inspectorOpen);
		this.inspectorOpenButton.hidden = !this.hasSnapshot || !this.selected || inspectorOpen || this.activeTab === 'overview';
		this.detailLayout.update(inspectorOpen);
	}

	reveal(selection: Selection, tab: WorkbenchTab): void {
		if (this.feedbackTitle.textContent === 'Graph location unavailable') {
			this.feedback.hidden = true;
			this.commandStatus.replaceChildren();
			this.commandStatus.hidden = true;
		}
		this.setActiveTab(tab);
		if (tab === 'passes') this.passes.reveal(selection);
		else if (tab === 'resources') this.resources.reveal(selection);
		else if (tab === 'memory') this.memory.reveal(selection);
		else if (tab === 'diagnostics') this.diagnostics.reveal(selection);
		if (this.detailLayout.isDrawer) this.inspector.setOpen(false);
		if (tab === 'graph') this.renderGraph();
	}

	navigate(tab: WorkbenchTab, filter?: 'culled' | 'all'): void {
		this.setActiveTab(tab);
		if (tab === 'passes' && filter === 'culled') this.passes.showCulled();
		if (tab === 'passes' && filter === 'all') this.passes.showAll();
		if (this.detailLayout.isDrawer) this.inspector.setOpen(false);
	}

	showNavigationIssue(message: string, selection: Selection): void {
		if (this.detailLayout.isDrawer) this.inspector.setOpen(false);
		this.feedback.hidden = false;
		this.feedback.open = true;
		this.feedback.dataset.tone = 'neutral';
		this.feedbackTitle.textContent = 'Graph location unavailable';
		const action = document.createElement('button');
		action.type = 'button';
		action.className = 'zenfg-inspector-relation-button';
		const tab = selection.kind === 'resource' ? 'resources' : selection.kind === 'allocation' ? 'memory'
			: selection.kind === 'root' || selection.kind === 'segment' ? 'diagnostics' : 'passes';
		action.textContent = `Show in ${tab}`;
		action.addEventListener('click', () => this.callbacks.onReveal?.(selection, tab));
		this.commandStatus.hidden = false;
		this.commandStatus.replaceChildren(document.createTextNode(`${message} `), action);
		action.focus();
	}

	destroy(): void { this.destroyed = true; this.detailLayout.destroy(); }

	private ensureActiveView(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		if (this.dirtyViews.has(this.activeTab)) {
			switch (this.activeTab) {
				case 'overview': this.renderSummary(snapshot); break;
				case 'passes': this.passes.setSnapshot(snapshot); break;
				case 'resources': this.resources.setSnapshot(snapshot); break;
				case 'memory': this.memory.setSnapshot(snapshot); break;
				case 'diagnostics': this.diagnostics.setSnapshot(snapshot); break;
			}
			this.dirtyViews.delete(this.activeTab);
		}
		this.updateActiveSelection();
	}

	private updateActiveSelection(): void {
		switch (this.activeTab) {
			case 'passes': this.passes.setSelection(this.selected); break;
			case 'resources': this.resources.setSelection(this.selected); break;
			case 'memory': this.memory.setSelection(this.selected); break;
			case 'diagnostics': this.diagnostics.setSelection(this.selected); break;
		}
	}

	private diagnosticCounts(snapshot: FrameGraphDebugViewModel): Record<'error' | 'warning' | 'info', number> {
		const counts = { error: 0, warning: 0, info: 0 };
		for (const entry of snapshot.protocol.diagnostics) counts[entry.severity]++;
		return counts;
	}

	private renderDiagnosticBadge(snapshot: FrameGraphDebugViewModel): void {
		const counts = this.diagnosticCounts(snapshot);
		const tab = this.tabButtons.get('diagnostics')!;
		const label = document.createElement('span');
		label.textContent = 'Diagnostics';
		const badge = document.createElement('span');
		badge.className = 'zenfg-inspector-diagnostic-badge';
		badge.textContent = `${counts.error} / ${counts.warning}`;
		badge.title = `${counts.error} errors, ${counts.warning} warnings`;
		badge.setAttribute('aria-hidden', 'true');
		tab.replaceChildren(label, ...(counts.error + counts.warning ? [badge] : []));
		tab.title = badge.title;
	}

	private handleMenuKey(event: KeyboardEvent): void {
		if (this.exportMenu.hidden || event.defaultPrevented) return;
		if (event.key === 'Escape') {
			event.preventDefault(); event.stopPropagation();
			this.setExportMenuOpen(false); this.exportButton.focus();
		} else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			event.preventDefault(); event.stopPropagation();
			const items = [this.downloadButton, this.copyButton].filter((button) => !button.disabled);
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
				: (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		}
	}
}
