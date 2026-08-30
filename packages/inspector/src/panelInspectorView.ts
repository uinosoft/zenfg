import type {
	FrameGraphDebugAccess,
	FrameGraphDebugResourceRef,
	FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';
import { labelNode, labelResource } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import { resolveSelectedDetail } from './panelSelection.ts';
import type { InspectorTab, Selection } from './panelTypes.ts';
import {
	createRelationButton,
	formatEstimatedBytes,
	formatResourceDescriptor,
	groupPath,
	resourceLabel,
	type WorkbenchCallbacks,
} from './panelWorkbenchHelpers.ts';

export class InspectorView {
	readonly root = document.createElement('aside');
	private readonly title = document.createElement('strong');
	private readonly tabList = document.createElement('div');
	private readonly content = document.createElement('div');
	private readonly tabs = new Map<InspectorTab, HTMLButtonElement>();
	private snapshot: FrameGraphDebugViewModel | undefined;
	private selected: Selection | undefined;
	private activeTab: InspectorTab = 'summary';
	private open = true;

	constructor(
		private readonly callbacks: WorkbenchCallbacks,
		private readonly onOpenChange: (open: boolean) => void,
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
			button.id = `zenfg-inspector-inspector-${tab}-tab`;
			button.textContent = label;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', 'zenfg-inspector-inspector-panel');
			button.addEventListener('click', () => {
				this.activeTab = tab;
				this.render();
			});
			this.tabs.set(tab, button);
			this.tabList.appendChild(button);
		}
		this.content.id = 'zenfg-inspector-inspector-panel';
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
		this.selected = selected;
		if (selected && reveal) this.setOpen(true);
		this.render();
	}

	setOpen(open: boolean): void {
		if (this.open === open) return;
		this.open = open;
		this.updateOpenState();
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
		for (const [tab, button] of this.tabs) {
			const active = tab === this.activeTab;
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', active ? 'true' : 'false');
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
		if (this.activeTab === 'raw') {
			const raw = document.createElement('pre');
			raw.className = 'zenfg-inspector-raw-detail';
			raw.textContent = JSON.stringify(resolveSelectedDetail(snapshot, selected), null, 2);
			this.content.appendChild(raw);
		} else if (this.activeTab === 'relations') {
			this.content.appendChild(this.createRelations(snapshot, selected));
		} else {
			this.content.appendChild(this.createSummary(snapshot, selected));
		}
	}

	private selectionTitle(snapshot: FrameGraphDebugViewModel, selection: Selection): string {
		switch (selection.kind) {
			case 'node': {
				const node = snapshot.nodeById.get(selection.id);
				return node ? labelNode(node) : `Pass #${selection.id}`;
			}
			case 'group': return snapshot.groupByPathKey.get(selection.pathKey)?.label ?? 'Group';
			case 'resource': {
				const resource = snapshot.resourceById.get(selection.id);
				return resource ? labelResource(resource) : `Resource #${selection.id}`;
			}
			case 'allocation': return `Allocation #${selection.id}`;
			case 'root': return `Retention root #${selection.index}`;
			case 'culled': return `Culled node #${selection.index}`;
			case 'segment': return `Segment #${selection.index}`;
		}
	}

	private createSummary(snapshot: FrameGraphDebugViewModel, selection: Selection): HTMLElement {
		switch (selection.kind) {
			case 'node': {
				const node = snapshot.nodeById.get(selection.id);
				if (!node) return this.summary([]);
				const segment = snapshot.segmentByNodeId.get(node.id);
				return this.summary([
					['Kind', node.kind],
					['Order', String(node.order)],
					['Group', groupPath(snapshot, node.debugGroupId)],
					['Segment', segment ? `#${segment.index} ${segment.kind}` : '-'],
					['GPU', node.kind === 'external-submission' ? 'Opaque' : node.gpuDurationMicros === undefined ? 'Not timed' : `${(node.gpuDurationMicros / 1000).toFixed(3)} ms`],
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
					['GPU coverage', `${group.summary.timedNodeCount}/${group.summary.timingEligibleNodeCount}`],
					['GPU work', `${(group.summary.gpuWorkDurationMicros / 1000).toFixed(3)} ms`],
					['Allocations', String(group.summary.physicalAllocationCount)],
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
					['Estimated', formatEstimatedBytes(resource.estimatedByteSize)],
					['Lifetime', resource.lifetime ? `${resource.lifetime.firstUse}–${resource.lifetime.lastUse}` : '-'],
					['Allocation', resource.physicalResourceId === undefined ? '-' : `#${resource.physicalResourceId}`],
					['Usage', resource.usageFlags.join(', ') || '-'],
				]);
			}
			case 'allocation': {
				const allocation = snapshot.allocationById.get(selection.id);
				if (!allocation) return this.summary([]);
				return this.summary([
					['Kind', allocation.kind],
					['Compatibility class', String(allocation.compatibilityClassId)],
					['Estimated', formatEstimatedBytes(allocation.estimatedByteSize)],
					['Logical resources', String(allocation.resourceIds.length)],
					['Alias', allocation.resourceIds.length > 1 ? `yes · ×${allocation.resourceIds.length}` : 'single'],
				]);
			}
			case 'root': {
				const root = snapshot.roots[selection.index];
				return this.summary(root ? [
					['Reason', root.reason],
					['Node', root.nodeId === undefined ? '-' : `#${root.nodeId}`],
					['Resource', root.resource ? labelResource(root.resource) : '-'],
				] : []);
			}
			case 'culled': {
				const culled = snapshot.culledNodes[selection.index];
				return this.summary(culled ? [
					['Node', labelNode(culled.node)],
					['Kind', culled.node.kind],
					['Group', groupPath(snapshot, culled.node.debugGroupId)],
					['Reason', culled.reason],
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
				}
				break;
			}
			case 'group': {
				const group = snapshot.groupByPathKey.get(selection.pathKey);
				if (group) {
					host.append(
						this.resourceRelations('Inputs', group.summary.inputResources),
						this.resourceRelations('Outputs', group.summary.outputResources),
					);
				}
				break;
			}
			case 'resource': {
				const resource = snapshot.resourceById.get(selection.id);
				const accesses = snapshot.accessesByResourceId.get(selection.id) ?? [];
				const passRelations: Array<readonly [string, Selection]> = [];
				for (const access of accesses) {
					const nodeSelection = this.accessNodeSelection(snapshot, access.nodeId);
					if (nodeSelection) passRelations.push([
						`${access.mode} · ${this.accessNodeLabel(snapshot, access.nodeId)} · ${access.access}`,
						nodeSelection,
					]);
				}
				host.appendChild(this.relationGroup('Pass accesses', passRelations));
				if (resource?.physicalResourceId !== undefined) host.appendChild(this.relationGroup('Allocation', [
					[`#${resource.physicalResourceId}`, { kind: 'allocation', id: resource.physicalResourceId }],
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
				const root = snapshot.roots[selection.index];
				const relations: Array<readonly [string, Selection]> = [];
				if (root?.nodeId !== undefined && snapshot.nodeById.has(root.nodeId)) relations.push([
					this.accessNodeLabel(snapshot, root.nodeId), { kind: 'node', id: root.nodeId },
				]);
				if (root?.resource) relations.push([labelResource(root.resource), { kind: 'resource', id: root.resource.id }]);
				host.appendChild(this.relationGroup('Retained object', relations));
				break;
			}
			case 'culled': {
				const culled = snapshot.culledNodes[selection.index];
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
		if (host.childElementCount === 0) {
			const empty = document.createElement('p');
			empty.className = 'zenfg-inspector-muted';
			empty.textContent = 'No related objects.';
			host.appendChild(empty);
		}
		return host;
	}

	private accessRelations(title: string, accesses: readonly FrameGraphDebugAccess[]): HTMLElement {
		return this.relationGroup(title, accesses.map((access) => [
			`${labelResource(access.resource)} · ${access.access}${access.mode === 'write' ? ` · ${access.contents}` : ''}`,
			{ kind: 'resource', id: access.resource.id },
		]));
	}

	private resourceRelations(title: string, resources: readonly FrameGraphDebugResourceRef[]): HTMLElement {
		return this.relationGroup(title, resources.map((resource) => [
			labelResource(resource), { kind: 'resource', id: resource.id },
		]));
	}

	private relationGroup(title: string, relations: readonly (readonly [string, Selection])[]): HTMLElement {
		const section = document.createElement('section');
		const heading = document.createElement('h3');
		heading.textContent = `${title} ${relations.length}`;
		section.appendChild(heading);
		for (const [label, selection] of relations) {
			section.appendChild(createRelationButton(label, selection, this.callbacks.onSelect));
		}
		if (relations.length === 0) {
			const empty = document.createElement('span');
			empty.className = 'zenfg-inspector-muted';
			empty.textContent = 'None';
			section.appendChild(empty);
		}
		return section;
	}

	private summary(rows: readonly (readonly [string, string])[]): HTMLElement {
		const summary = document.createElement('dl');
		summary.className = 'zenfg-inspector-inspector-summary';
		for (const [label, value] of rows) {
			const term = document.createElement('dt');
			term.textContent = label;
			const description = document.createElement('dd');
			description.textContent = value;
			description.title = value;
			summary.append(term, description);
		}
		return summary;
	}

	private accessNodeLabel(snapshot: FrameGraphDebugViewModel, nodeId: string): string {
		const node = snapshot.nodeById.get(nodeId);
		if (node) return labelNode(node);
		const culled = snapshot.culledNodes.find((candidate) => candidate.node.id === nodeId);
		return culled ? `${labelNode(culled.node)} (culled)` : `node-${nodeId}`;
	}

	private accessNodeSelection(snapshot: FrameGraphDebugViewModel, nodeId: string): Selection | undefined {
		if (snapshot.nodeById.has(nodeId)) return { kind: 'node', id: nodeId };
		const index = snapshot.culledNodes.findIndex((candidate) => candidate.node.id === nodeId);
		return index < 0 ? undefined : { kind: 'culled', index };
	}
}
