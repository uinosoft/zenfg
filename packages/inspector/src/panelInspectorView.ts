import type {
	FrameGraphDebugAccess,
	FrameGraphDebugRoot,
	FrameGraphDebugResourceRef,
	FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';
import { labelNode, labelResource } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import { RawDetailView } from './panelRawView.ts';
import { resolveNodeSelection, resolveSelectedCanonicalDetail } from './panelSelection.ts';
import type { InspectorTab, Selection, WorkbenchTab } from './panelTypes.ts';
import {
	createRelationButton,
	formatEstimatedBytes,
	formatResourceDescriptor,
	formatTimingCoverage,
	formatMeasuredGpuWork,
	enableTabKeyboard,
	writeClipboardText,
	groupPath,
	resourceLabel,
	type WorkbenchCallbacks,
} from './panelWorkbenchHelpers.ts';

type DetailRelation = readonly [label: string, selection: Selection, description?: string];

function formatAccessFacts(access: FrameGraphDebugAccess): string {
	return [
		access.mode, access.access,
		...(access.mode === 'write' ? [access.contents, access.producesValue ? 'produces a value' : 'does not produce a value'] : []),
		...(access.bufferRange ? [`bytes ${access.bufferRange.offset}–${access.bufferRange.size === undefined ? 'end' : access.bufferRange.offset + access.bufferRange.size}`] : []),
		...(access.textureRegion ? [formatTextureRegion(access.textureRegion)] : []),
		...(access.textureViewId ? [`view ${access.textureViewId}`] : []),
	].join(' · ');
}

function formatTextureRegion(region: NonNullable<FrameGraphDebugAccess['textureRegion']>): string {
	const end = (start: number | undefined, count: number | undefined) => start === undefined ? 'unknown' : count === undefined ? `${start}–end` : `${start}–${start + count - 1}`;
	return `mip ${end(region.baseMipLevel, region.mipLevelCount)} · ${region.baseDepthSlice === undefined
		? `layers ${end(region.baseArrayLayer, region.arrayLayerCount)}`
		: `depth ${end(region.baseDepthSlice, region.depthSliceCount)}`} · aspect ${region.aspect}`;
}

function formatRootRange(root: FrameGraphDebugRoot): string {
	if (!root.range) return 'Range unavailable';
	if (root.range.kind === 'buffer') return `bytes ${root.range.offset}–${root.range.offset + root.range.size}`;
	return root.range.regions.map(formatTextureRegion).join('; ');
}

export class InspectorView {
	readonly root = document.createElement('aside');
	private readonly title = document.createElement('strong');
	private readonly tabList = document.createElement('div');
	private readonly content = document.createElement('div');
	private readonly tabs = new Map<InspectorTab, HTMLButtonElement>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private activeTab: InspectorTab = 'summary';
	private open = false;
	private hoveredLink: HTMLButtonElement | undefined;

	constructor(
		private readonly callbacks: WorkbenchCallbacks,
		private readonly onOpenChange: (open: boolean) => void,
		idPrefix: string,
	) {
		this.root.className = 'zenfg-inspector-inspector';
		this.root.setAttribute('aria-label', 'Selection inspector');
		const header = document.createElement('header');
		this.title.textContent = 'Inspector';
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'zenfg-inspector-inspector-close';
		close.appendChild(createPanelIcon('close'));
		close.title = 'Close inspector';
		close.setAttribute('aria-label', 'Close inspector');
		close.addEventListener('click', () => this.setOpen(false));
		header.append(this.title, close);

		this.tabList.className = 'zenfg-inspector-inspector-tabs';
		this.tabList.setAttribute('role', 'tablist');
		this.tabList.setAttribute('aria-label', 'Inspector views');
		for (const [tab, label] of [['summary', 'Summary'], ['relations', 'Relations'], ['raw', 'Raw']] as const) {
			const button = document.createElement('button');
			button.type = 'button';
			button.id = `${idPrefix}-inspector-${tab}-tab`;
			button.textContent = label;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', `${idPrefix}-inspector-panel`);
			button.addEventListener('click', () => {
				this.activeTab = tab;
				this.render();
			});
			this.tabs.set(tab, button);
			this.tabList.appendChild(button);
		}
		enableTabKeyboard(this.tabList);
		this.content.id = `${idPrefix}-inspector-panel`;
		this.content.className = 'zenfg-inspector-inspector-content';
		this.content.setAttribute('role', 'tabpanel');
		this.root.append(header, this.tabList, this.content);
		this.updateOpenState();
		this.render();
	}

	setSnapshot(snapshot: FrameGraphDebugViewModel): void {
		this.snapshot = snapshot;
		this.render();
	}

	setSelection(selected: Selection | undefined, reveal = true): void {
		if (selected?.kind === 'resource'
			&& (this.selected?.kind !== 'resource' || this.selected.id !== selected.id)) this.activeTab = 'summary';
		this.selected = selected;
		if (!selected) this.setOpen(false);
		else if (reveal && !this.open) {
			this.setOpen(true);
			return;
		}
		this.render();
	}

	setOpen(open: boolean): void {
		if (this.open === open) return;
		if (!open) this.clearLinkHover();
		this.open = open;
		this.updateOpenState();
		if (open) this.render();
		this.onOpenChange(open);
	}

	get isOpen(): boolean {
		return this.open;
	}

	private updateOpenState(): void {
		this.root.hidden = !this.open;
		this.root.classList.toggle('open', this.open);
	}

	private render(): void {
		const restoreFocus = this.content.contains(document.activeElement);
		this.clearLinkHover();
		for (const [tab, button] of this.tabs) {
			const active = tab === this.activeTab;
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', active ? 'true' : 'false');
			button.tabIndex = active ? 0 : -1;
			if (active) this.content.setAttribute('aria-labelledby', button.id);
		}
		const snapshot = this.snapshot;
		const selected = this.selected;
		this.content.replaceChildren();
		if (!snapshot || !selected) {
			this.title.textContent = 'Inspector';
			const empty = document.createElement('p');
			empty.className = 'zenfg-inspector-muted';
			empty.textContent = 'Select a pass, group, resource, allocation, root, culled node, or segment.';
			this.content.appendChild(empty);
			return;
		}
		this.title.textContent = this.selectionTitle(snapshot, selected);
		if (!this.open) return;
		if (this.activeTab === 'raw') {
			const detail = resolveSelectedCanonicalDetail(snapshot, selected);
			if (detail) this.content.appendChild(new RawDetailView(detail, Boolean(snapshot.protocol.capture.migration)).root);
			else this.content.textContent = 'Canonical object unavailable in this capture.';
		} else if (this.activeTab === 'relations') {
			this.content.appendChild(this.createRelations(snapshot, selected));
		} else {
			this.content.append(this.createLocationActions(snapshot, selected), this.createSummary(snapshot, selected));
			const identity = this.selectionId(snapshot, selected);
			if (identity) this.content.appendChild(this.summary([['ID', this.copyId(identity)]]));
			const diagnostics = this.createDiagnostics(snapshot, selected);
			if (diagnostics) this.content.appendChild(diagnostics);
			if (selected.kind === 'node' || selected.kind === 'culled') {
				const node = snapshot.nodeById.get(selected.id) ?? snapshot.culledById.get(selected.id)?.node;
				if (node) {
					const accesses = document.createElement('details');
					const heading = document.createElement('summary');
					heading.textContent = `Access facts · ${node.reads.length + node.writes.length}`;
					accesses.append(heading, this.accessRelations('Reads', node.reads), this.accessRelations('Writes', node.writes));
					this.content.appendChild(accesses);
				}
			}
		}
		// Selecting a relation replaces its button. Keep keyboard focus in the pane.
		if (restoreFocus) this.tabs.get(this.activeTab)?.focus();
	}

	private selectionTitle(snapshot: FrameGraphDebugViewModel, selection: Selection): string {
		switch (selection.kind) {
			case 'node': {
				const node = snapshot.nodeById.get(selection.id);
				return node ? labelNode(node) : selection.id;
			}
			case 'group': return snapshot.groupByPathKey.get(selection.pathKey)?.label ?? 'Group';
			case 'resource': {
				const resource = snapshot.resourceById.get(selection.id);
				return resource ? labelResource(resource) : selection.id;
			}
			case 'allocation': return /^allocation[:#-]/i.test(selection.id) ? selection.id : `Allocation ${selection.id}`;
			case 'root': return 'Output root';
			case 'culled': return `${snapshot.culledById.get(selection.id)?.node.label ?? selection.id} (culled)`;
			case 'segment': return `Segment #${selection.index}`;
		}
	}

	private createSummary(snapshot: FrameGraphDebugViewModel, selection: Selection): HTMLElement {
		switch (selection.kind) {
			case 'node': {
				const node = snapshot.nodeById.get(selection.id);
				if (!node) return this.summary([]);
				const segment = snapshot.segmentByNodeId.get(node.id);
				const roots = snapshot.roots.filter((root) => root.nodeId === node.id || root.resolution?.producerNodeIds.includes(node.id));
				return this.summary([
					['Compile state', 'Retained · compiler included this pass; execution success is not implied'],
					['Retention', roots.length ? roots.map((root) => root.reason).join(', ') : 'No direct output root recorded; inspect dependencies in Relations'],
					['Kind', node.kind],
					['Execution slot', String(node.order)],
					['Group', groupPath(snapshot, node.debugGroupId)],
					['Segment', segment ? `#${segment.index} ${segment.kind}` : '-'],
					['GPU', node.kind === 'external-submission' ? 'Opaque · external work is not measured'
						: node.kind !== 'render' && node.kind !== 'compute' ? 'Not applicable · this pass kind is not timing eligible'
						: node.gpuDurationMicros === undefined ? `Not collected${snapshot.profiling.status === 'unavailable' ? ` · ${snapshot.profiling.reason}` : ''}`
						: `${(node.gpuDurationMicros / 1000).toFixed(3)} ms · captured`],
					['Accesses', `${node.reads.length} reads · ${node.writes.length} writes`],
					['Side effect', node.sideEffect ? 'yes' : 'no'],
				]);
			}
			case 'group': {
				const group = snapshot.groupByPathKey.get(selection.pathKey);
				if (!group) return this.summary([]);
				return this.summary([
					['Path', group.path.join(' / ')],
					['Retained', String(group.summary.retainedNodeCount)],
					['Culled', String(group.summary.culledNodeCount)],
					['GPU coverage', formatTimingCoverage(group.summary.timedNodeCount, group.summary.timingEligibleNodeCount)],
					['Measured pass sum', formatMeasuredGpuWork(group.summary.gpuWorkDurationMicros, group.summary.timedNodeCount, group.summary.timingEligibleNodeCount)],
					['Opaque passes', `${group.summary.externalSubmissionCount} · excluded from measured sum`],
					['Allocations', snapshot.protocol.memory.allocationReport.status === 'available' ? String(group.summary.physicalAllocationCount) : 'Unknown · allocation report unavailable'],
					['Segments', String(group.summary.executionSegmentCount)],
				]);
			}
			case 'resource': {
				const resource = snapshot.resourceById.get(selection.id);
				if (!resource) return this.summary([]);
				return this.summary([
					['Kind / origin', `${resource.kind} · ${resource.origin}`],
					['Group', groupPath(snapshot, resource.debugGroupId)],
					['Descriptor', formatResourceDescriptor(resource)],
					['Resource estimate', `${formatEstimatedBytes(resource.estimatedByteSize)} · logical descriptor estimate`],
					['Lifetime', resource.lifetime ? `execution slots ${resource.lifetime.firstUse}–${resource.lifetime.lastUse} (inclusive)` : 'Unavailable'],
					['Allocation', resource.physicalResourceId !== undefined
						? this.createDetailLink(resource.physicalResourceId, { kind: 'allocation', id: resource.physicalResourceId })
						: resource.origin !== 'transient' ? 'Not applicable · externally owned resource'
						: snapshot.protocol.memory.allocationReport.status === 'unavailable' ? 'Unavailable · allocation report not captured'
						: 'Unallocated'],
					['Initial contents', resource.initialContents ?? 'Unknown'],
					['Usage', resource.usageFlags.join(', ') || '-'],
				]);
			}
			case 'allocation': {
				const allocation = snapshot.allocationById.get(selection.id);
				if (!allocation) return this.summary([]);
				return this.summary([
					['Kind', allocation.kind],
					['Compatibility class', String(allocation.compatibilityClassId)],
					['Physical estimate', `${formatEstimatedBytes(allocation.estimatedByteSize)} · allocation capacity estimate`],
					['Logical resources', String(allocation.resourceIds.length)],
					['Alias', allocation.resourceIds.length > 1 ? `yes · ×${allocation.resourceIds.length}` : 'single'],
				]);
			}
			case 'root': {
				const root = snapshot.roots.find((root) => root.key === selection.key);
				return this.summary(root ? [
					['Reason', root.reason],
					['Node', root.nodeId === undefined ? 'Not applicable' : this.nodeLink(snapshot, root.nodeId)],
					['Resource', root.resource ? this.viewResourceButton(snapshot, root.resource.id) : '-'],
					...(root.reason === 'side-effect' ? [] : [
						['Range', root.range ? formatRootRange(root) : 'Unavailable in Legacy capture'],
						['Initial contents', root.resolution ? String(root.resolution.usesInitialContents) : 'Unavailable in Legacy capture'],
						['Producers', root.resolution ? root.resolution.producerNodeIds.join(', ') || 'None' : 'Unavailable in Legacy capture'],
					] as [string, string][]),
				] : []);
			}
			case 'culled': {
				const culled = snapshot.culledById.get(selection.id);
				return this.summary(culled ? [
					['Compile state', 'Culled · excluded by the compiler'],
					['Node', labelNode(culled.node)],
					['Kind', culled.node.kind],
					['Group', groupPath(snapshot, culled.node.debugGroupId)],
					['Reason', culled.reason],
					['Execution / segment / GPU', 'Not applicable · culled passes do not execute'],
					['Accesses', `${culled.node.reads.length} reads · ${culled.node.writes.length} writes`],
				] : []);
			}
			case 'segment': {
				const segment = snapshot.segmentByIndex.get(selection.index);
				return this.summary(segment ? [
					['Kind', segment.kind === 'frame-graph' ? 'FrameGraph command segment' : 'Opaque interval'],
					['Nodes', String(segment.nodeIds.length)],
					['Meaning', segment.kind === 'external-submission'
						? 'Boundary around external work; not an actual third-party submission count.'
						: 'Contiguous FrameGraph-encoded command work.'],
				] : []);
			}
		}
	}

	private createRelations(snapshot: FrameGraphDebugViewModel, selection: Selection): HTMLElement {
		const host = document.createElement('div');
		host.className = 'zenfg-inspector-inspector-relations';
		host.appendChild(this.createLocationActions(snapshot, selection));
		switch (selection.kind) {
			case 'node': {
				const node = snapshot.nodeById.get(selection.id);
				if (node) {
					host.append(
						this.accessRelations('Reads', node.reads),
						this.accessRelations('Writes', node.writes),
					);
					const segment = snapshot.segmentByNodeId.get(node.id);
					if (segment) host.appendChild(this.relationGroup('Segment', [
						[`#${segment.index} ${segment.kind}`, { kind: 'segment', index: segment.index }],
					]));
					for (const kind of ['value', 'ordering'] as const) {
						const relations: DetailRelation[] = [];
						for (const edge of snapshot.edges) {
							if (edge.kind !== kind || (edge.fromNodeId !== node.id && edge.toNodeId !== node.id)) continue;
							const upstream = edge.toNodeId === node.id;
							const otherId = upstream ? edge.fromNodeId : edge.toNodeId;
							const other = resolveNodeSelection(snapshot, otherId);
							if (other) relations.push([this.accessNodeLabel(snapshot, otherId), other,
								`${upstream ? 'Upstream' : 'Downstream'} · ${resourceLabel(snapshot, edge.resource.id)} · ${kind} dependency`]);
						}
						if (relations.length) host.appendChild(this.relationGroup(kind === 'value' ? 'Value dependencies' : 'Ordering dependencies', relations));
					}
				}
				break;
			}
			case 'group': {
				const group = snapshot.groupByPathKey.get(selection.pathKey);
				if (group) {
					host.append(
						this.resourceRelations('Inputs', group.summary.inputResources),
						this.resourceRelations('Outputs', group.summary.outputResources),
						this.relationGroup('Output roots', group.summary.outputRoots.map((root) => [
							`${root.resource ? labelResource(root.resource) : '-'} · ${root.reason} · ${formatRootRange(root)}`,
							{ kind: 'root', key: root.key },
						])),
					);
				}
				break;
			}
			case 'resource': {
				const resource = snapshot.resourceById.get(selection.id);
				const accesses = snapshot.accessesByResourceId.get(selection.id) ?? [];
				const passRelations: DetailRelation[] = [];
				for (const access of accesses) {
					const nodeSelection = this.accessNodeSelection(snapshot, access.nodeId);
					if (nodeSelection) passRelations.push([
						this.accessNodeLabel(snapshot, access.nodeId),
						nodeSelection,
						formatAccessFacts(access),
					]);
				}
				host.appendChild(this.relationGroup('Pass accesses', passRelations));
				const roots = snapshot.roots.filter((root) => root.resource?.id === selection.id);
				if (roots.length) host.appendChild(this.relationGroup('Output roots', roots.map((root) => [
					`${root.reason} · ${formatRootRange(root)}`, { kind: 'root', key: root.key },
				])));
				if (resource?.physicalResourceId !== undefined) host.appendChild(this.relationGroup('Allocation', [
					[resource.physicalResourceId, { kind: 'allocation', id: resource.physicalResourceId }],
				]));
				break;
			}
			case 'allocation': {
				const allocation = snapshot.allocationById.get(selection.id);
				if (allocation) host.appendChild(this.relationGroup('Logical resources', allocation.resourceIds.map((id) => [
					resourceLabel(snapshot, id), { kind: 'resource', id },
				])));
				break;
			}
			case 'root': {
				const root = snapshot.roots.find((root) => root.key === selection.key);
				const relations: Array<readonly [string, Selection]> = [];
				if (root?.nodeId !== undefined && snapshot.nodeById.has(root.nodeId)) relations.push([
					this.accessNodeLabel(snapshot, root.nodeId), { kind: 'node', id: root.nodeId },
				]);
				if (root?.resource) host.appendChild(this.relationGroup('Resource', [[labelResource(root.resource), { kind: 'resource', id: root.resource.id }]]));
				if (root?.resource && root.resolution?.usesInitialContents) relations.push([`Initial contents · ${labelResource(root.resource)}`, { kind: 'resource', id: root.resource.id }]);
				for (const id of root?.resolution?.producerNodeIds ?? []) relations.push([this.accessNodeLabel(snapshot, id), { kind: 'node', id }]);
				host.appendChild(this.relationGroup('Output sources', relations));
				break;
			}
			case 'culled': {
				const culled = snapshot.culledById.get(selection.id);
				if (culled) host.append(
					this.accessRelations('Reads', culled.node.reads),
					this.accessRelations('Writes', culled.node.writes),
				);
				break;
			}
			case 'segment': {
				const segment = snapshot.segmentByIndex.get(selection.index);
				if (segment) host.appendChild(this.relationGroup('Passes', segment.nodeIds.flatMap((id) => {
					const node = snapshot.nodeById.get(id);
					return node ? [[labelNode(node), { kind: 'node', id }] as const] : [];
				})));
				break;
			}
		}
		if (host.childElementCount === 1) {
			const empty = document.createElement('p');
			empty.className = 'zenfg-inspector-muted';
			empty.textContent = 'No related objects.';
			host.appendChild(empty);
		}
		return host;
	}

	private accessRelations(title: string, accesses: readonly FrameGraphDebugAccess[]): HTMLElement {
		return this.relationGroup(title, accesses.map((access) => [
			labelResource(access.resource),
			{ kind: 'resource', id: access.resource.id },
			formatAccessFacts(access),
		]));
	}

	private resourceRelations(title: string, resources: readonly FrameGraphDebugResourceRef[]): HTMLElement {
		return this.relationGroup(title, resources.map((resource) => [
			labelResource(resource), { kind: 'resource', id: resource.id },
		]));
	}

	private relationGroup(title: string, relations: readonly DetailRelation[]): HTMLElement {
		const section = document.createElement('section');
		const heading = document.createElement('h3');
		heading.textContent = `${title} ${relations.length}`;
		section.appendChild(heading);
		for (const [label, selection, description] of relations) {
			const link = this.createDetailLink(label, selection);
			const entry = document.createElement('div');
			entry.className = 'zenfg-inspector-relation-entry';
			const links = document.createElement('div');
			links.className = 'zenfg-inspector-relation-links';
			links.appendChild(link);
			if (this.callbacks.onReveal) links.appendChild(this.revealButton(selection, this.primaryPage(selection)));
			entry.appendChild(links);
			if (description !== undefined) {
				const metadata = document.createElement('span');
				metadata.className = 'zenfg-inspector-muted';
				metadata.textContent = description;
				entry.appendChild(metadata);
			}
			section.appendChild(entry);
		}
		if (relations.length === 0) {
			const empty = document.createElement('span');
			empty.className = 'zenfg-inspector-muted';
			empty.textContent = 'None';
			section.appendChild(empty);
		}
		return section;
	}

	private selectRelated(selection: Selection): void {
		this.clearLinkHover();
		this.callbacks.onSelect(selection);
	}

	private viewResourceButton(snapshot: FrameGraphDebugViewModel, resourceId: string): HTMLButtonElement {
		return this.createDetailLink(`View resource · ${resourceLabel(snapshot, resourceId)}`,
			{ kind: 'resource', id: resourceId });
	}

	private createDetailLink(label: string, selection: Selection): HTMLButtonElement {
		const link = createRelationButton(label, selection, (target) => this.selectRelated(target));
		link.addEventListener('mouseenter', () => {
			this.hoveredLink = link;
			this.callbacks.onHover(selection);
		});
		link.addEventListener('mouseleave', () => {
			if (this.hoveredLink === link) this.clearLinkHover();
		});
		return link;
	}

	private clearLinkHover(): void {
		if (!this.hoveredLink) return;
		this.hoveredLink = undefined;
		this.callbacks.onHover(undefined);
	}

	private summary(rows: readonly (readonly [string, string | HTMLElement])[]): HTMLElement {
		const summary = document.createElement('dl');
		summary.className = 'zenfg-inspector-inspector-summary';
		for (const [label, value] of rows) {
			const term = document.createElement('dt');
			term.textContent = label;
			const description = document.createElement('dd');
			if (typeof value === 'string') {
				description.textContent = value;
				description.title = value;
			} else {
				description.appendChild(value);
			}
			summary.append(term, description);
		}
		return summary;
	}

	private accessNodeLabel(snapshot: FrameGraphDebugViewModel, nodeId: string): string {
		const node = snapshot.nodeById.get(nodeId);
		if (node) return labelNode(node);
		const culled = snapshot.culledById.get(nodeId);
		return culled ? `${labelNode(culled.node)} (culled)` : nodeId;
	}

	private accessNodeSelection(snapshot: FrameGraphDebugViewModel, nodeId: string): Selection | undefined {
		return resolveNodeSelection(snapshot, nodeId);
	}

	private nodeLink(snapshot: FrameGraphDebugViewModel, id: string): string | HTMLButtonElement {
		const selected = resolveNodeSelection(snapshot, id);
		return selected ? this.createDetailLink(this.accessNodeLabel(snapshot, id), selected) : id;
	}

	private primaryPage(selection: Selection): WorkbenchTab {
		switch (selection.kind) {
			case 'node': case 'culled': case 'group': return 'passes';
			case 'resource': return 'resources';
			case 'allocation': return 'memory';
			case 'root': case 'segment': return 'diagnostics';
		}
	}

	private revealButton(selection: Selection, page: WorkbenchTab): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'zenfg-inspector-inline-action';
		button.textContent = `Locate in ${page[0].toUpperCase()}${page.slice(1)}`;
		button.addEventListener('click', () => {
			this.clearLinkHover();
			this.callbacks.onReveal?.(selection, page);
		});
		return button;
	}

	private createLocationActions(snapshot: FrameGraphDebugViewModel, selection: Selection): HTMLElement {
		const actions = document.createElement('div');
		actions.className = 'zenfg-inspector-detail-actions';
		if (!this.callbacks.onReveal) return actions;
		actions.appendChild(this.revealButton(selection, this.primaryPage(selection)));
		if (selection.kind === 'node' || selection.kind === 'group' || selection.kind === 'resource' || selection.kind === 'root') {
			actions.appendChild(this.revealButton(selection, 'graph'));
		}
		if (selection.kind === 'resource' && snapshot.resourceById.get(selection.id)?.origin === 'transient') actions.appendChild(this.revealButton(selection, 'memory'));
		if (selection.kind === 'culled') {
			const note = document.createElement('span');
			note.className = 'zenfg-inspector-muted';
			note.textContent = 'Culled passes are absent from Graph. Locate them in Passes.';
			actions.appendChild(note);
		}
		return actions;
	}

	private selectionId(snapshot: FrameGraphDebugViewModel, selection: Selection): string | undefined {
		if ('id' in selection) return selection.id;
		if (selection.kind === 'group') return snapshot.groupByPathKey.get(selection.pathKey)?.id;
		if (selection.kind === 'segment') return snapshot.segmentByIndex.get(selection.index)?.id;
		return undefined;
	}

	private copyId(id: string): HTMLElement {
		const host = document.createElement('span');
		host.className = 'zenfg-inspector-copy-id';
		const code = document.createElement('code');
		code.textContent = id;
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = 'Copy ID';
		button.setAttribute('aria-label', 'Copy full object ID');
		button.addEventListener('click', () => {
			void writeClipboardText(id).then(() => { button.textContent = 'Copied'; }, () => { button.textContent = 'Copy failed'; });
		});
		host.append(code, button);
		return host;
	}

	private createDiagnostics(snapshot: FrameGraphDebugViewModel, selection: Selection): HTMLElement | undefined {
		let diagnostics: FrameGraphDebugViewModel['protocol']['diagnostics'] = [];
		if (selection.kind === 'node' || selection.kind === 'culled') diagnostics = snapshot.diagnosticsByNodeId.get(selection.id) ?? [];
		else if (selection.kind === 'resource') diagnostics = snapshot.diagnosticsByResourceId.get(selection.id) ?? [];
		else if (selection.kind === 'allocation') {
			const resourceIds = new Set(snapshot.allocationById.get(selection.id)?.resourceIds);
			diagnostics = snapshot.protocol.diagnostics.filter((diagnostic) => diagnostic.resourceId !== undefined && resourceIds.has(diagnostic.resourceId));
		} else if (selection.kind === 'group') {
			const groupId = snapshot.groupByPathKey.get(selection.pathKey)?.id;
			const groups = new Set(snapshot.debugGroups.filter((group) => groupId !== undefined && group.ancestorIds.includes(groupId)).map((group) => group.id));
			diagnostics = snapshot.protocol.diagnostics.filter((diagnostic) => {
				const nodeGroup = diagnostic.nodeId ? snapshot.canonicalNodeById.get(diagnostic.nodeId)?.groupId : undefined;
				const resourceGroup = diagnostic.resourceId ? snapshot.resourceById.get(diagnostic.resourceId)?.debugGroupId : undefined;
				return (nodeGroup !== undefined && groups.has(nodeGroup)) || (resourceGroup !== undefined && groups.has(resourceGroup));
			});
		}
		if (!diagnostics.length) return undefined;
		const section = document.createElement('section');
		section.className = 'zenfg-inspector-detail-diagnostics';
		const heading = document.createElement('h3');
		heading.textContent = `Related diagnostics ${diagnostics.length}`;
		section.appendChild(heading);
		for (const diagnostic of diagnostics) {
			const entry = document.createElement('article');
			entry.dataset.severity = diagnostic.severity;
			const label = document.createElement('strong');
			label.textContent = `${diagnostic.severity} · ${diagnostic.code}`;
			const message = document.createElement('p');
			message.textContent = diagnostic.message;
			entry.append(label, message);
			if (diagnostic.nodeId) {
				const node = resolveNodeSelection(snapshot, diagnostic.nodeId);
				if (node) entry.appendChild(this.createDetailLink(this.accessNodeLabel(snapshot, diagnostic.nodeId), node));
			}
			if (diagnostic.resourceId) entry.appendChild(this.viewResourceButton(snapshot, diagnostic.resourceId));
			section.appendChild(entry);
		}
		return section;
	}
}
