import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createToolbarButton } from './panelDomHelpers.ts';
import { createPanelIcon, setPanelButtonContent } from './panelIcons.ts';
import type { Selection } from './panelTypes.ts';

type GraphControlActions = {
	onDeclarations(): void;
	onGroups(): void;
	onCollapseAll(): void;
	onFocusRelations(): void;
	onToggleSelectedGroup(): void;
	onZoomBy(factor: number): void;
	onResetZoom(): void;
	onFitSelection(): void;
	onFitGraph(): void;
};

type GraphControlState = {
	readonly snapshot: FrameGraphDebugViewModel | undefined;
	readonly selected: Selection | undefined;
	readonly showResourceDeclarations: boolean;
	readonly groupsEnabled: boolean;
	readonly expandedGroupPaths: ReadonlySet<string>;
	readonly focusRelations: boolean;
	readonly representationAvailable: boolean;
	readonly viewportAvailable: boolean;
};

/** Internal DOM controls, separate from the renderer's canvas and viewport. */
export class GraphControls {
	readonly toolbar = document.createElement('div');
	readonly viewportControls = document.createElement('div');
	private readonly displayButton = document.createElement('button');
	private readonly displayPopover = document.createElement('div');
	private readonly declarationsButton: HTMLButtonElement;
	private readonly groupsButton: HTMLButtonElement;
	private readonly collapseGroupsButton: HTMLButtonElement;
	private readonly focusButton: HTMLButtonElement;
	private readonly groupButton: HTMLButtonElement;
	private readonly zoomOutButton: HTMLButtonElement;
	private readonly zoomInButton: HTMLButtonElement;
	private readonly resetZoomButton: HTMLButtonElement;
	private readonly fitSelectionButton: HTMLButtonElement;
	private readonly fitGraphButton: HTMLButtonElement;
	private readonly zoomValue = document.createElement('output');
	private readonly ownerDocument: Document;
	private readonly handleOutsideClick = (event: MouseEvent): void => {
		if (!this.displayPopover.hidden && !this.containsDisplayTarget(event.target)) this.setDisplayOpen(false);
	};
	private readonly handleOutsideFocus = (event: FocusEvent): void => {
		if (!this.displayPopover.hidden && !this.containsDisplayTarget(event.target)) this.setDisplayOpen(false);
	};
	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || this.displayPopover.hidden || !this.containsDisplayTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		this.setDisplayOpen(false, true);
	};

	constructor(actions: GraphControlActions, idPrefix: string) {
		this.ownerDocument = this.toolbar.ownerDocument;
		this.toolbar.className = 'zenfg-inspector-graph-toolbar';
		this.toolbar.setAttribute('role', 'toolbar');
		this.toolbar.setAttribute('aria-label', 'Frame graph view controls');
		const actionControls = document.createElement('div');
		actionControls.className = 'zenfg-inspector-graph-action-controls';
		this.focusButton = createToolbarButton('Focus relations', 'Focus direct dependencies of the selected pass or group', actions.onFocusRelations);
		this.focusButton.className = 'zenfg-inspector-graph-focus-action';
		setPanelButtonContent(this.focusButton, 'relations', 'Focus relations');
		this.focusButton.setAttribute('aria-pressed', 'false');
		this.groupButton = createToolbarButton('Expand group', 'Expand selected diagnostic group', actions.onToggleSelectedGroup);
		this.groupButton.className = 'zenfg-inspector-graph-group-action';
		setPanelButtonContent(this.groupButton, 'chevron-right', 'Expand group');
		this.groupButton.hidden = true;
		this.displayButton.type = 'button';
		setPanelButtonContent(this.displayButton, 'display', 'Display');
		this.displayButton.append(createPanelIcon('chevron-down'));
		this.displayButton.title = 'Graph display options';
		this.displayButton.setAttribute('aria-haspopup', 'dialog');
		this.displayButton.setAttribute('aria-expanded', 'false');
		this.displayButton.setAttribute('aria-controls', `${idPrefix}-graph-display`);
		this.displayButton.addEventListener('click', () => this.setDisplayOpen(this.displayPopover.hidden !== false));
		this.displayPopover.id = `${idPrefix}-graph-display`;
		this.displayPopover.className = 'zenfg-inspector-graph-display-popover';
		this.displayPopover.setAttribute('role', 'dialog');
		this.displayPopover.setAttribute('aria-label', 'Graph display options');
		this.displayPopover.hidden = true;
		const heading = document.createElement('strong');
		heading.textContent = 'Display';
		this.declarationsButton = createToolbarButton('Declarations', 'Show resource declaration nodes', actions.onDeclarations);
		this.groupsButton = createToolbarButton('Groups', 'Toggle diagnostic group projection', actions.onGroups);
		for (const button of [this.declarationsButton, this.groupsButton]) {
			const check = createPanelIcon('check');
			check.classList.add('zenfg-inspector-graph-display-check');
			button.append(check);
		}
		this.collapseGroupsButton = createToolbarButton('Collapse All', 'Collapse every diagnostic group', () => {
			actions.onCollapseAll();
			this.setDisplayOpen(false, true);
		});
		this.displayPopover.append(heading, this.declarationsButton, this.groupsButton, this.collapseGroupsButton);
		actionControls.append(this.focusButton, this.groupButton, this.displayButton, this.displayPopover);
		this.toolbar.append(actionControls);

		this.viewportControls.className = 'zenfg-inspector-graph-zoom-controls';
		this.viewportControls.setAttribute('role', 'toolbar');
		this.viewportControls.setAttribute('aria-label', 'Graph viewport controls');
		this.zoomOutButton = createToolbarButton('', 'Zoom out', () => actions.onZoomBy(1 / 1.2));
		this.zoomOutButton.append(createPanelIcon('minus'));
		this.zoomInButton = createToolbarButton('', 'Zoom in', () => actions.onZoomBy(1.2));
		this.zoomInButton.append(createPanelIcon('plus'));
		this.zoomValue.className = 'zenfg-inspector-graph-zoom-value';
		this.zoomValue.setAttribute('aria-label', 'Graph zoom');
		this.zoomValue.textContent = '100%';
		this.resetZoomButton = createToolbarButton('100%', 'Reset graph zoom to 100%', actions.onResetZoom);
		this.fitSelectionButton = createToolbarButton('', 'Fit selection to view', actions.onFitSelection);
		this.fitSelectionButton.append(createPanelIcon('fit-selection'));
		this.fitGraphButton = createToolbarButton('', 'Fit graph to view', actions.onFitGraph);
		this.fitGraphButton.append(createPanelIcon('fit'));
		const separator = document.createElement('span');
		separator.className = 'zenfg-inspector-graph-control-separator';
		separator.setAttribute('aria-hidden', 'true');
		this.viewportControls.append(this.zoomOutButton, this.zoomValue, this.zoomInButton, separator, this.resetZoomButton, this.fitSelectionButton, this.fitGraphButton);
		this.ownerDocument.addEventListener('click', this.handleOutsideClick);
		this.ownerDocument.addEventListener('focusin', this.handleOutsideFocus);
		this.ownerDocument.addEventListener('keydown', this.handleKeyDown, true);
	}

	update(state: GraphControlState): void {
		const hasCapture = Boolean(state.snapshot);
		this.declarationsButton.disabled = !hasCapture;
		this.declarationsButton.classList.toggle('active', state.showResourceDeclarations);
		this.declarationsButton.setAttribute('aria-pressed', String(state.showResourceDeclarations));
		const hasGroups = Boolean(state.snapshot?.debugGroups.length);
		this.groupsButton.hidden = !hasGroups;
		this.collapseGroupsButton.hidden = !hasGroups;
		this.groupsButton.disabled = !hasGroups;
		this.groupsButton.classList.toggle('active', hasGroups && state.groupsEnabled);
		this.groupsButton.setAttribute('aria-pressed', String(hasGroups && state.groupsEnabled));
		const hasExpanded = state.snapshot?.debugGroups.some((group) => state.expandedGroupPaths.has(group.pathKey)) ?? false;
		this.collapseGroupsButton.disabled = !hasGroups || !state.groupsEnabled || !hasExpanded;
		const focusable = state.representationAvailable && (state.selected?.kind === 'node' || state.selected?.kind === 'group');
		this.focusButton.disabled = !focusable;
		this.focusButton.classList.toggle('active', focusable && state.focusRelations);
		this.focusButton.setAttribute('aria-pressed', String(focusable && state.focusRelations));
		this.focusButton.title = focusable ? 'Focus direct dependencies of the selected pass or group' : 'Select a visible pass or group to focus its direct dependencies';
		const selectedGroup = state.selected?.kind === 'group' ? state.snapshot?.groupByPathKey.get(state.selected.pathKey) : undefined;
		this.groupButton.hidden = !selectedGroup || !state.groupsEnabled || !state.representationAvailable;
		const expanded = Boolean(selectedGroup && state.expandedGroupPaths.has(selectedGroup.pathKey));
		setPanelButtonContent(this.groupButton, expanded ? 'chevron-down' : 'chevron-right', expanded ? 'Collapse group' : 'Expand group');
		this.groupButton.title = expanded ? 'Collapse selected diagnostic group' : 'Expand selected diagnostic group';
		this.groupButton.setAttribute('aria-expanded', String(expanded));
		this.displayButton.disabled = !hasCapture;
		this.zoomOutButton.disabled = !state.viewportAvailable;
		this.zoomInButton.disabled = !state.viewportAvailable;
		this.resetZoomButton.disabled = !state.viewportAvailable;
		this.fitGraphButton.disabled = !state.viewportAvailable;
		this.fitSelectionButton.disabled = !state.representationAvailable;
		if (!state.viewportAvailable) this.zoomValue.textContent = '—';
		if (!hasCapture) this.setDisplayOpen(false);
	}

	setZoom(zoom: number): void {
		this.zoomValue.textContent = Number.isFinite(zoom) ? `${Math.round(zoom * 100)}%` : '—';
	}

	destroy(): void {
		this.ownerDocument.removeEventListener('click', this.handleOutsideClick);
		this.ownerDocument.removeEventListener('focusin', this.handleOutsideFocus);
		this.ownerDocument.removeEventListener('keydown', this.handleKeyDown, true);
	}

	private containsDisplayTarget(target: EventTarget | null): boolean {
		return Boolean(target && typeof (target as Node).nodeType === 'number'
			&& (this.displayButton.contains(target as Node) || this.displayPopover.contains(target as Node)));
	}

	private setDisplayOpen(open: boolean, restoreFocus = false): void {
		this.displayPopover.hidden = !open;
		this.displayButton.setAttribute('aria-expanded', String(open));
		if (open) this.declarationsButton.focus();
		else if (restoreFocus) this.displayButton.focus();
	}
}
