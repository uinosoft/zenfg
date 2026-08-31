import { InspectorShell } from './internal/InspectorShell.ts';
import {
	FrameGraphSnapshotValidationError,
	decodeFrameGraphSnapshot,
	parseFrameGraphSnapshot,
	stringifyFrameGraphSnapshot,
	type FrameGraphSnapshot,
} from '@zenfg/snapshot';
import {
	createDebugViewModel,
	type FrameGraphDebugSnapshotSource,
	type FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';
import { createToolbarButton } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import {
	destroyGraph,
	fitGraph,
	relayoutGraph,
} from './panelGraphView.ts';
import { graphGroupElementId } from './panelGraphScene.ts';
import { selectionExists } from './panelSelection.ts';
import type { GraphViewState, Selection } from './panelTypes.ts';
import { ensureFrameGraphInspectorStyles } from './styles.ts';
import { sameSelection, type WorkbenchCallbacks } from './panelWorkbenchHelpers.ts';
import { FrameGraphDebugWorkbench } from './panelWorkbenchView.ts';

/** Construction and safety limits for an embedded {@link FrameGraphInspector}. */
export type FrameGraphInspectorOptions = {
	/**
	 * Produces a live snapshot when capture is requested. The inspector awaits
	 * promises and displays thrown or rejected errors in its status area.
	 */
	captureSnapshot?: () => FrameGraphSnapshot | undefined | Promise<FrameGraphSnapshot | undefined>;
	/**
	 * Maximum accepted import size in bytes.
	 *
	 * @defaultValue `67108864` (64 MiB)
	 */
	maxImportBytes?: number;
	/**
	 * Maximum graph nodes plus edges accepted by automatic layout.
	 *
	 * @defaultValue `5000`
	 */
	maxGraphElements?: number;
};

const DEFAULT_MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_GRAPH_ELEMENTS = 5_000;

/**
 * Browser lifecycle controller for one embeddable FrameGraph inspector.
 *
 * @remarks The constructor creates, but does not append, {@link dom}. Use
 * {@link mountFrameGraphInspector} for the common append-and-return workflow.
 * Async capture, import, and clipboard failures are reported in the UI. Call
 * {@link destroy} when the controller is no longer needed.
 *
 * @example
 * ```ts
 * const inspector = new FrameGraphInspector({ captureSnapshot: capture });
 * document.body.append(inspector.dom);
 * inspector.setExpanded(true);
 * // Later:
 * inspector.destroy();
 * ```
 */
export class FrameGraphInspector {
	/** Root element owned by this inspector instance. */
	readonly dom: HTMLElement;

	private readonly shell: InspectorShell;
	private readonly content = document.createElement('div');
	private readonly passesGraphModeButton: HTMLButtonElement;
	private readonly resourcesGraphModeButton: HTMLButtonElement;
	private readonly groupsButton: HTMLButtonElement;
	private readonly collapseGroupsButton: HTMLButtonElement;
	private readonly graphView: GraphViewState;
	private readonly workbench: FrameGraphDebugWorkbench;
	private captureSnapshotCallback: FrameGraphInspectorOptions['captureSnapshot'];
	private protocolSnapshot: FrameGraphSnapshot | undefined;
	private operationRevision = 0;
	private viewModel: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private hovered: Selection | undefined;
	private capturing = false;
	private importing = false;
	private copying = false;
	private copied = false;
	private initialAutoCaptureAttempted = false;
	private statusMessage: string | undefined;
	private statusTone: 'neutral' | 'error' = 'neutral';
	private destroyed = false;
	private copyFeedbackTimeout: number | undefined;
	private readonly maxImportBytes: number;

	/**
	 * Creates a detached inspector UI.
	 *
	 * @throws If a configured numeric limit is not a non-negative safe integer,
	 * or if browser DOM globals are unavailable.
	 */
	constructor(options: FrameGraphInspectorOptions = {}) {
		ensureFrameGraphInspectorStyles();
		this.captureSnapshotCallback = options.captureSnapshot;
		this.maxImportBytes = normalizeMaxImportBytes(options.maxImportBytes);
		this.shell = new InspectorShell({
			id: 'zenfg-inspector',
			title: 'FrameGraph',
			onExpandedChange: (expanded) => this.handleExpandedChange(expanded),
		});
		this.dom = this.shell.dom;
		this.shell.body.classList.add('zenfg-inspector-body');
		this.content.className = 'zenfg-inspector-content';

		const graphLegend = document.createElement('div');
		graphLegend.className = 'zenfg-inspector-graph-legend';
		graphLegend.setAttribute('aria-label', 'Graph legend');
		this.graphView = {
			host: document.createElement('div'),
			toolbar: document.createElement('div'),
			legend: graphLegend,
			layoutElementBudget: normalizeLimit(options.maxGraphElements, DEFAULT_MAX_GRAPH_ELEMENTS, 'maxGraphElements'),
			graphMode: 'passes',
			groupsEnabled: true,
			expandedGroupPaths: new Set(),
			fitOnNextRender: true,
		};
		this.graphView.host.className = 'zenfg-inspector-graph';
		this.graphView.toolbar.className = 'zenfg-inspector-graph-toolbar';
		this.graphView.toolbar.setAttribute('role', 'toolbar');
		this.graphView.toolbar.setAttribute('aria-label', 'Frame graph view controls');

		this.passesGraphModeButton = createToolbarButton('Pass dependency', 'Show pass dependency graph', () => this.setGraphMode('passes'));
		this.resourcesGraphModeButton = createToolbarButton('Resource access', 'Show resource access graph', () => this.setGraphMode('resources'));
		this.groupsButton = createToolbarButton('Groups', 'Toggle diagnostic group projection', () => this.toggleGroups());
		this.collapseGroupsButton = createToolbarButton('Collapse All', 'Collapse every diagnostic group', () => this.collapseAllGroups());
		this.passesGraphModeButton.classList.add('zenfg-inspector-mode-button');
		this.resourcesGraphModeButton.classList.add('zenfg-inspector-mode-button');

		const modeControls = document.createElement('div');
		modeControls.className = 'zenfg-inspector-graph-mode-controls';
		modeControls.setAttribute('role', 'group');
		modeControls.setAttribute('aria-label', 'Graph mode');
		modeControls.append(this.passesGraphModeButton, this.resourcesGraphModeButton);
		const actionControls = document.createElement('div');
		actionControls.className = 'zenfg-inspector-graph-action-controls';
		actionControls.append(
			this.groupsButton,
			this.collapseGroupsButton,
			createGraphIconButton('relayout', 'Relayout graph', () => relayoutGraph(this.graphView)),
			createGraphIconButton('fit', 'Fit graph to view', () => fitGraph(this.graphView)),
		);
		this.graphView.toolbar.append(modeControls, graphLegend, actionControls);

		const callbacks: WorkbenchCallbacks = {
			onSelect: (selection) => this.handleSelect(selection),
			onHover: (selection) => this.handleHover(selection),
			onGroupToggle: (pathKey) => this.toggleGroup(pathKey),
			isGroupExpanded: (pathKey) => this.graphView.expandedGroupPaths.has(pathKey),
		};
		this.workbench = new FrameGraphDebugWorkbench(this.graphView, callbacks, {
			onCapture: () => { void this.captureSnapshot(); },
			onImport: (file) => { void this.importSnapshot(file); },
			onDownload: () => this.downloadSnapshot(),
			onCopyJson: () => { void this.copySnapshotJson(); },
		});
		this.content.append(this.workbench.root);
		this.shell.body.appendChild(this.content);
		this.updateCaptureActions();
		this.updateGraphModeButtonState();
		this.showEmptyState();
	}

	/** Whether the inspector shell is currently expanded. */
	get expanded(): boolean {
		return this.shell.expanded;
	}

	/**
	 * Expands or collapses the shell. The first expansion may automatically
	 * request a live capture when a provider is configured.
	 */
	setExpanded(expanded: boolean): void {
		this.shell.setExpanded(expanded);
	}

	/**
	 * Replaces or removes the live-capture provider.
	 *
	 * @remarks Installing a provider while expanded may immediately begin an
	 * asynchronous capture when no snapshot is displayed.
	 */
	setCaptureSnapshotProvider(provider: FrameGraphInspectorOptions['captureSnapshot']): void {
		const changed = this.captureSnapshotCallback !== provider;
		this.captureSnapshotCallback = provider;
		if (changed && !this.viewModel) this.initialAutoCaptureAttempted = false;
		if (!provider && !this.viewModel) this.showEmptyState();
		this.updateCaptureActions();
		if (this.expanded) this.maybeAutoCapture();
	}

	/**
	 * Requests and displays a live snapshot from the configured provider.
	 *
	 * @remarks Concurrent requests are coalesced. Provider errors, invalid
	 * snapshots, and an unavailable provider are displayed in the inspector and
	 * do not reject the returned promise.
	 */
	async captureSnapshot(): Promise<void> {
		if (this.destroyed || this.capturing) return;
		if (!this.captureSnapshotCallback) {
			this.reportCaptureIssue('Waiting for a FrameGraph capture source.');
			return;
		}
		const revision = ++this.operationRevision;
		this.importing = false;
		this.capturing = true;
		this.statusMessage = undefined;
		this.statusTone = 'neutral';
		if (!this.viewModel) this.workbench.showEmptyState('capturing', 'Capturing the next rendered frame…');
		this.updateCaptureActions();
		try {
			const snapshot = await this.captureSnapshotCallback();
			if (this.destroyed || revision !== this.operationRevision) return;
			if (!snapshot) {
				this.reportCaptureIssue('No snapshot was produced. Capture again when rendering is active.');
				return;
			}
			const decoded = decodeFrameGraphSnapshot(snapshot);
			if (!decoded.ok) {
				this.reportCaptureIssue(`Failed to capture FrameGraph: ${formatIssues(decoded.issues)}`);
				return;
			}
			this.applySnapshot(decoded.snapshot, { kind: 'live', label: 'Live Capture' });
		}
		catch (error) {
			if (!this.destroyed && revision === this.operationRevision) {
				this.reportCaptureIssue(`Failed to capture FrameGraph: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		finally {
			if (revision === this.operationRevision) this.capturing = false;
			if (!this.destroyed && revision === this.operationRevision) this.updateCaptureActions();
		}
	}

	/**
	 * Validates and synchronously displays a programmatic Snapshot 1.0 value.
	 *
	 * @throws {@link FrameGraphSnapshotValidationError} if `snapshot` is invalid.
	 */
	setSnapshot(snapshot: FrameGraphSnapshot): void {
		if (this.destroyed) return;
		this.operationRevision += 1;
		this.capturing = false;
		this.importing = false;
		const decoded = decodeFrameGraphSnapshot(snapshot);
		if (!decoded.ok) throw new FrameGraphSnapshotValidationError(decoded.issues);
		this.applySnapshot(decoded.snapshot, { kind: 'programmatic', label: 'Programmatic' });
	}

	/** Returns the currently displayed canonical snapshot, if any. */
	getSnapshot(): FrameGraphSnapshot | undefined {
		return this.protocolSnapshot;
	}

	/**
	 * Reads, migrates, validates, and displays a snapshot JSON file.
	 *
	 * @remarks Files above `maxImportBytes`, read failures, invalid JSON, and
	 * validation failures are displayed in the UI and do not reject the promise.
	 */
	async importSnapshot(file: File): Promise<void> {
		if (this.destroyed) return;
		const revision = ++this.operationRevision;
		this.capturing = false;
		this.importing = false;
		if (file.size > this.maxImportBytes) {
			this.reportCaptureIssue(`Import exceeds the ${formatImportLimit(this.maxImportBytes)} limit.`);
			return;
		}
		this.importing = true;
		this.statusMessage = undefined;
		this.statusTone = 'neutral';
		this.updateCaptureActions();
		try {
			const text = await file.text();
			if (this.destroyed || revision !== this.operationRevision) return;
			const decoded = parseFrameGraphSnapshot(text);
			if (!decoded.ok) {
				this.reportCaptureIssue(`Failed to import snapshot: ${formatIssues(decoded.issues)}`);
				return;
			}
			this.applySnapshot(decoded.snapshot, {
				kind: 'file',
				label: file.name || 'Imported JSON',
			});
			const sourceFormat = decoded.snapshot.capture.migration?.sourceFormat;
			if (sourceFormat) {
				const sourceLabel = sourceFormat === 'legacy-v0' ? 'Legacy V0' : 'Legacy Candidate V1';
				this.statusMessage = decoded.migrated
					? `Imported ${sourceLabel} and migrated it to ZenFG Snapshot V1.`
					: `Imported Snapshot V1 with ${sourceLabel} migration provenance.`;
				this.statusTone = 'neutral';
			}
		}
		catch (error) {
			if (!this.destroyed && revision === this.operationRevision) {
				this.reportCaptureIssue(`Failed to import snapshot: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		finally {
			if (revision === this.operationRevision) this.importing = false;
			if (!this.destroyed && revision === this.operationRevision) this.updateCaptureActions();
		}
	}

	/** Downloads the displayed snapshot as pretty-printed canonical JSON. */
	downloadSnapshot(): void {
		if (this.destroyed || !this.protocolSnapshot) return;
		const json = stringifyFrameGraphSnapshot(this.protocolSnapshot, { pretty: true });
		const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `frame-graph-${this.protocolSnapshot.capture.frameIndex}.fgsnapshot.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Copies the displayed snapshot as pretty-printed canonical JSON.
	 *
	 * @remarks Clipboard failures are shown in the UI and do not reject the
	 * returned promise. A legacy `document.execCommand` fallback is used when the
	 * async Clipboard API is unavailable.
	 */
	async copySnapshotJson(): Promise<void> {
		if (this.destroyed || this.copying || !this.protocolSnapshot) return;
		const snapshot = this.protocolSnapshot;
		const revision = this.operationRevision;
		this.copying = true;
		this.copied = false;
		this.statusMessage = undefined;
		this.statusTone = 'neutral';
		this.updateCaptureActions();
		try {
			await writeTextToClipboard(stringifyFrameGraphSnapshot(snapshot, { pretty: true }));
			if (this.destroyed || revision !== this.operationRevision) return;
			this.copied = true;
			if (this.copyFeedbackTimeout !== undefined) window.clearTimeout(this.copyFeedbackTimeout);
			this.copyFeedbackTimeout = window.setTimeout(() => {
				this.copied = false;
				this.copyFeedbackTimeout = undefined;
				this.updateCaptureActions();
			}, 1200);
		}
		catch (error) {
			if (!this.destroyed && revision === this.operationRevision) {
				this.statusMessage = `Failed to copy snapshot: ${error instanceof Error ? error.message : String(error)}`;
			}
			console.warn('Failed to copy FrameGraph Snapshot.', error);
		}
		finally {
			this.copying = false;
			if (!this.destroyed) this.updateCaptureActions();
		}
	}

	private applySnapshot(snapshot: FrameGraphSnapshot, source: FrameGraphDebugSnapshotSource): void {
		const viewModel = createDebugViewModel(snapshot, source);
		this.copied = false;
		if (this.copyFeedbackTimeout !== undefined) {
			window.clearTimeout(this.copyFeedbackTimeout);
			this.copyFeedbackTimeout = undefined;
		}
		this.protocolSnapshot = snapshot;
		this.viewModel = viewModel;
		this.graphView.fitOnNextRender = true;
		this.hovered = undefined;
		this.initialAutoCaptureAttempted = true;
		this.statusMessage = undefined;
		this.statusTone = 'neutral';
		if (!this.selected || !selectionExists(viewModel, this.selected)) {
			this.selected = viewModel.nodes[0]
				? { kind: 'node', id: viewModel.nodes[0].id }
				: undefined;
		}
		this.workbench.setSnapshot(viewModel, this.selected);
		this.updateCaptureActions();
		this.updateGraphModeButtonState();
	}

	/**
	 * Idempotently cancels pending UI results, releases graph resources, and
	 * removes the inspector shell. Do not reuse the controller afterward.
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.operationRevision += 1;
		if (this.copyFeedbackTimeout !== undefined) window.clearTimeout(this.copyFeedbackTimeout);
		destroyGraph(this.graphView);
		this.shell.destroy();
	}

	private updateCaptureActions(): void {
		this.workbench.setSnapshotActionState({
			providerAvailable: Boolean(this.captureSnapshotCallback),
			hasCapture: Boolean(this.viewModel),
			capturing: this.capturing,
			importing: this.importing,
			copying: this.copying,
			copied: this.copied,
			message: this.viewModel ? this.statusMessage : undefined,
			messageTone: this.statusTone,
		});
	}

	private handleExpandedChange(expanded: boolean): void {
		if (!expanded) return;
		this.workbench.resizeGraph(true);
		this.maybeAutoCapture();
	}

	private maybeAutoCapture(): void {
		if (
			this.destroyed
			|| this.viewModel
			|| this.initialAutoCaptureAttempted
			|| this.capturing
			|| !this.captureSnapshotCallback
		) return;
		this.initialAutoCaptureAttempted = true;
		void this.captureSnapshot();
	}
	private handleSelect(selection: Selection): void {
		this.selected = selection;
		this.workbench.setSelection(selection);
	}

	private handleHover(selection: Selection | undefined): void {
		if (!this.viewModel || sameSelection(this.hovered, selection)) return;
		this.hovered = selection;
		this.workbench.setHovered(selection);
	}

	private setGraphMode(mode: GraphViewState['graphMode']): void {
		if (this.graphView.graphMode === mode) return;
		this.graphView.graphMode = mode;
		this.graphView.fitOnNextRender = true;
		this.updateGraphModeButtonState();
		this.workbench.refreshGraphStructure();
	}

	private updateGraphModeButtonState(): void {
		const passesActive = this.graphView.graphMode === 'passes';
		const hasGroups = (this.viewModel?.debugGroups.length ?? 0) > 0;
		this.passesGraphModeButton.classList.toggle('active', passesActive);
		this.resourcesGraphModeButton.classList.toggle('active', !passesActive);
		this.passesGraphModeButton.setAttribute('aria-pressed', passesActive ? 'true' : 'false');
		this.resourcesGraphModeButton.setAttribute('aria-pressed', passesActive ? 'false' : 'true');
		this.groupsButton.disabled = !passesActive || !hasGroups;
		this.groupsButton.classList.toggle('active', passesActive && hasGroups && this.graphView.groupsEnabled);
		this.groupsButton.setAttribute('aria-pressed', passesActive && hasGroups && this.graphView.groupsEnabled ? 'true' : 'false');
		const hasExpanded = this.viewModel?.debugGroups.some((group) => this.graphView.expandedGroupPaths.has(group.pathKey)) ?? false;
		this.collapseGroupsButton.disabled = !passesActive || !hasGroups || !this.graphView.groupsEnabled || !hasExpanded;
	}

	private toggleGroups(): void {
		if (this.graphView.graphMode !== 'passes' || !this.viewModel?.debugGroups.length) return;
		this.graphView.groupsEnabled = !this.graphView.groupsEnabled;
		this.graphView.fitOnNextRender = true;
		this.updateGraphModeButtonState();
		this.workbench.refreshGraphStructure();
	}

	private toggleGroup(pathKey: string): void {
		if (this.graphView.expandedGroupPaths.has(pathKey)) this.graphView.expandedGroupPaths.delete(pathKey);
		else this.graphView.expandedGroupPaths.add(pathKey);
		this.graphView.anchorElementIdOnNextRender = graphGroupElementId(pathKey);
		this.updateGraphModeButtonState();
		this.workbench.refreshGraphStructure();
	}

	private collapseAllGroups(): void {
		if (this.graphView.expandedGroupPaths.size === 0) return;
		this.graphView.expandedGroupPaths.clear();
		this.graphView.fitOnNextRender = true;
		this.updateGraphModeButtonState();
		this.workbench.refreshGraphStructure();
	}

	private showEmptyState(): void {
		const providerAvailable = Boolean(this.captureSnapshotCallback);
		this.workbench.showEmptyState(
			providerAvailable ? 'empty' : 'waiting',
			providerAvailable
				? 'No capture yet. Expand the panel or use Capture to request the next frame.'
				: 'Waiting for a FrameGraph capture source.',
		);
	}

	private reportCaptureIssue(message: string): void {
		this.statusMessage = message;
		this.statusTone = 'error';
		if (!this.viewModel) this.workbench.showEmptyState('error', message);
		this.updateCaptureActions();
	}
}

/**
 * Creates an inspector, appends its root element to `host`, and returns its
 * lifecycle controller.
 *
 * @throws If inspector construction fails; see {@link FrameGraphInspector}.
 */
export function mountFrameGraphInspector(host: HTMLElement, options?: FrameGraphInspectorOptions): FrameGraphInspector {
	const inspector = new FrameGraphInspector(options);
	host.appendChild(inspector.dom);
	return inspector;
}

function createGraphIconButton(icon: 'relayout' | 'fit', title: string, onClick: () => void): HTMLButtonElement {
	const button = createToolbarButton('', title, onClick);
	button.classList.add('zenfg-inspector-icon-button');
	button.appendChild(createPanelIcon(icon));
	return button;
}

async function writeTextToClipboard(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const textArea = document.createElement('textarea');
	textArea.value = text;
	textArea.setAttribute('readonly', 'true');
	textArea.style.position = 'fixed';
	textArea.style.left = '-9999px';
	textArea.style.top = '0';
	document.body.appendChild(textArea);
	textArea.select();
	try {
		if (!document.execCommand('copy')) throw new Error('document.execCommand("copy") returned false.');
	}
	finally {
		textArea.remove();
	}
}

function normalizeMaxImportBytes(value: number | undefined): number {
	return normalizeLimit(value, DEFAULT_MAX_IMPORT_BYTES, 'maxImportBytes');
}

function normalizeLimit(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function formatImportLimit(bytes: number): string {
	return bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0
		? `${bytes / (1024 * 1024)} MiB`
		: `${bytes} bytes`;
}

function formatIssues(issues: readonly { readonly path: string; readonly message: string }[]): string {
	return issues.slice(0, 3).map((issue) => `${issue.path || '/'}: ${issue.message}`).join('; ');
}
