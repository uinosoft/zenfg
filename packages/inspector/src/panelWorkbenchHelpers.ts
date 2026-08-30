import type {
	FrameGraphDebugResource,
	FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';
import { createCell, formatBytes, labelResource } from './panelDomHelpers.ts';
import type { Selection } from './panelTypes.ts';

export type WorkbenchCallbacks = {
	readonly onSelect: (selection: Selection) => void;
	readonly onHover: (selection: Selection | undefined) => void;
	readonly onGroupToggle: (pathKey: string) => void;
	readonly isGroupExpanded: (pathKey: string) => boolean;
};
export type WorkbenchTableColumn = {
	readonly label: string;
	readonly column?: 'code' | 'kind' | 'numeric';
};


export function selectionKey(selection: Selection): string {
	switch (selection.kind) {
		case 'node': return `node:${selection.id}`;
		case 'group': return `group:${selection.pathKey}`;
		case 'resource': return `resource:${selection.id}`;
		case 'root': return `root:${selection.index}`;
		case 'culled': return `culled:${selection.index}`;
		case 'allocation': return `allocation:${selection.id}`;
		case 'segment': return `segment:${selection.index}`;
	}
}

export function sameSelection(a: Selection | undefined, b: Selection | undefined): boolean {
	return a === undefined || b === undefined ? a === b : selectionKey(a) === selectionKey(b);
}

export function updateSelectedRows(rows: ReadonlyMap<string, readonly HTMLElement[]>, selected: Selection | undefined): void {
	const key = selected ? selectionKey(selected) : undefined;
	for (const [rowKey, elements] of rows) {
		for (const element of elements) {
			const active = rowKey === key;
			element.classList.toggle('selected', active);
			if (element.getAttribute('role') === 'option') {
				element.setAttribute('aria-selected', active ? 'true' : 'false');
			}
		}
	}
}

export function registerSelectable(
	rows: Map<string, HTMLElement[]>,
	element: HTMLElement,
	selection: Selection,
	callbacks: WorkbenchCallbacks,
): void {
	const key = selectionKey(selection);
	const elements = rows.get(key) ?? [];
	elements.push(element);
	rows.set(key, elements);
	element.dataset.selectionKey = key;
	element.addEventListener('mouseenter', () => callbacks.onHover(selection));
	element.addEventListener('mouseleave', () => callbacks.onHover(undefined));
}

export function createViewToolbar(label: string): HTMLDivElement {
	const toolbar = document.createElement('div');
	toolbar.className = 'zenfg-inspector-view-toolbar';
	toolbar.setAttribute('role', 'toolbar');
	toolbar.setAttribute('aria-label', label);
	return toolbar;
}

export function createSearchInput(
	placeholder: string,
	value: string,
	onInput: (value: string) => void,
): HTMLInputElement {
	const input = document.createElement('input');
	input.type = 'search';
	input.placeholder = placeholder;
	input.value = value;
	input.setAttribute('aria-label', placeholder);
	input.addEventListener('input', () => onInput(input.value));
	return input;
}

export function createFilterSelect(
	label: string,
	value: string,
	options: readonly (readonly [value: string, label: string])[],
	onChange: (value: string) => void,
): HTMLSelectElement {
	const select = document.createElement('select');
	select.setAttribute('aria-label', label);
	for (const [optionValue, optionLabel] of options) {
		const option = document.createElement('option');
		option.value = optionValue;
		option.textContent = optionLabel;
		select.appendChild(option);
	}
	select.value = value;
	select.addEventListener('change', () => onChange(select.value));
	return select;
}

export function createTableScroller(headers: readonly WorkbenchTableColumn[]): {
	readonly scroller: HTMLDivElement;
	readonly table: HTMLTableElement;
	readonly body: HTMLTableSectionElement;
} {
	const scroller = document.createElement('div');
	scroller.className = 'zenfg-inspector-table-scroller';
	const table = document.createElement('table');
	table.className = 'zenfg-inspector-workbench-table';
	const head = document.createElement('thead');
	const row = document.createElement('tr');
	for (const header of headers) {
		const cell = document.createElement('th');
		cell.textContent = header.label;
		if (header.column) cell.dataset.column = header.column;
		row.appendChild(cell);
	}
	head.appendChild(row);
	const body = document.createElement('tbody');
	table.append(head, body);
	scroller.appendChild(table);
	return { scroller, table, body };
}

export function createSelectionCell(
	text: string,
	selection: Selection,
	callbacks: WorkbenchCallbacks,
	column?: WorkbenchTableColumn['column'],
): HTMLTableCellElement {
	const cell = document.createElement('td');
	const button = createRelationButton(text, selection, callbacks.onSelect);
	cell.appendChild(button);
	if (column) cell.dataset.column = column;
	return cell;
}

export function createRelationButton(
	text: string,
	selection: Selection,
	onSelect: (selection: Selection) => void,
): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'zenfg-inspector-relation-button';
	button.textContent = text;
	button.addEventListener('click', () => onSelect(selection));
	return button;
}

export function createKindCell(kind: string, label = kind): HTMLTableCellElement {
	const cell = createCell('', { column: 'kind', kind });
	const marker = document.createElement('span');
	marker.className = 'zenfg-inspector-kind-label';
	marker.dataset.kind = kind;
	marker.textContent = label;
	cell.appendChild(marker);
	return cell;
}

export function groupPath(snapshot: FrameGraphDebugViewModel, groupId: string | undefined): string {
	if (groupId === undefined) return '-';
	return snapshot.groupById.get(groupId)?.path.join(' / ') ?? `group-${groupId}`;
}

export function formatEstimatedBytes(bytes: number | undefined): string {
	return bytes === undefined ? 'Unknown' : formatBytes(bytes);
}

export function formatResourceDescriptor(resource: FrameGraphDebugResource): string {
	const descriptor = resource.descriptor;
	if (!descriptor) return 'Unknown';
	if (resource.kind === 'buffer' && 'size' in descriptor && typeof descriptor.size === 'number') {
		return `${formatBytes(descriptor.size)} buffer`;
	}
	if ('format' in descriptor) {
		const size = descriptor.size;
		const extent = `${size.width}×${size.height}×${size.depthOrArrayLayers}`;
		const extras = [
			descriptor.dimension !== '2d' ? descriptor.dimension : undefined,
			descriptor.mipLevelCount > 1 ? `${descriptor.mipLevelCount} mips` : undefined,
			descriptor.sampleCount > 1 ? `${descriptor.sampleCount}× MSAA` : undefined,
			descriptor.viewFormats.length > 0 ? `views ${descriptor.viewFormats.join(', ')}` : undefined,
		].filter(Boolean);
		return `${descriptor.format} · ${extent}${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
	}
	return 'Unknown';
}

export function resourceAccessCounts(snapshot: FrameGraphDebugViewModel, resourceId: string): readonly [number, number] {
	let reads = 0;
	let writes = 0;
	for (const access of snapshot.accessesByResourceId.get(resourceId) ?? []) {
		if (access.mode === 'read') reads++;
		else writes++;
	}
	return [reads, writes];
}

export function createEmptyTableRow(columnCount: number, text: string): HTMLTableRowElement {
	const row = document.createElement('tr');
	const cell = createCell(text);
	cell.colSpan = columnCount;
	cell.className = 'zenfg-inspector-empty-row';
	row.appendChild(cell);
	return row;
}

export function resourceLabel(snapshot: FrameGraphDebugViewModel, resourceId: string): string {
	const resource = snapshot.resourceById.get(resourceId);
	return resource ? labelResource(resource) : `resource-${resourceId}`;
}
