import type { FrameGraphDebugNode, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { labelNode } from './panelDomHelpers.ts';

export type PassTimingSource = 'gpu' | 'cpu';
export type PassTimingNode = Omit<FrameGraphDebugNode, 'order'>;
export type PassTimingDomain = { readonly total: number; readonly maximum: number; readonly measured: number };

/** A workbench owns one source choice; views keep their own ordering and filters. */
export class PassTimingSourceState {
	private value: PassTimingSource = 'gpu';
	private chosen = false;
	constructor(private readonly onChange?: () => void) {}
	get source(): PassTimingSource { return this.value; }
	initialize(snapshot: FrameGraphDebugViewModel): void {
		if (!this.chosen) this.value = snapshot.metrics.timedNodeCount === 0 && snapshot.metrics.cpuTimedNodeCount > 0 ? 'cpu' : 'gpu';
	}
	choose(source: PassTimingSource): void {
		this.chosen = true;
		if (source === this.value) return;
		this.value = source; this.onChange?.();
	}
}

export function nodeTimingDuration(node: PassTimingNode, source: PassTimingSource): number | undefined {
	return source === 'cpu' ? node.cpuDurationMicros
		: node.kind === 'render' || node.kind === 'compute' ? node.gpuDurationMicros : undefined;
}

export function timingDomain(nodes: readonly PassTimingNode[], source: PassTimingSource): PassTimingDomain {
	let total = 0; let maximum = 0; let measured = 0;
	for (const node of nodes) {
		const duration = nodeTimingDuration(node, source);
		if (duration === undefined) continue;
		total += duration; maximum = Math.max(maximum, duration); measured++;
	}
	if (maximum > 0) {
		const magnitude = 10 ** Math.floor(Math.log10(maximum));
		const normalized = maximum / magnitude;
		const rounded = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
		if (Number.isFinite(rounded) && rounded > 0) maximum = rounded;
	}
	return { total, maximum, measured };
}

function timingElement<K extends keyof HTMLElementTagNameMap>(tag: K, part: string, text?: string): HTMLElementTagNameMap[K] {
	const result = document.createElement(tag); result.className = `zenfg-inspector-timing-${part}`;
	if (text !== undefined) result.textContent = text;
	return result;
}

export function renderTimingHeader(table: HTMLTableElement, source: PassTimingSource, domain: PassTimingDomain,
	options: { readonly order: boolean; readonly culled?: boolean; readonly sort?: 'none' | 'descending' }): void {
	table.classList.add('zenfg-inspector-timing-table');
	table.dataset.order = String(options.order); table.dataset.source = source; table.dataset.maxMicros = String(domain.maximum);
	const head = table.tHead ?? table.createTHead(); head.replaceChildren();
	const row = document.createElement('tr');
	for (const [column, label] of [
		...(options.order ? [['order', 'Order']] : []), ['name', 'Pass'],
		['plot', options.culled ? 'Culled reason' : 'Duration'], ...(!options.culled ? [['time', 'Time (ms)'], ['share', 'Share']] : []),
	]) {
		const cell = document.createElement('th'); cell.scope = 'col'; cell.dataset.timingColumn = column;
		if (column === 'order') cell.setAttribute('aria-label', 'Execution order');
		if (column === 'plot' && options.culled) cell.colSpan = 3;
		if (column === 'time') {
			cell.setAttribute('aria-sort', options.sort ?? 'none');
			cell.setAttribute('aria-label', `${source.toUpperCase()} time in milliseconds${options.sort === 'descending' ? '; sorted descending' : ''}`);
		}
		if (column === 'plot' && domain.maximum > 0 && !options.culled) {
			cell.setAttribute('aria-label', `${source.toUpperCase()} duration in milliseconds`);
			const axis = timingElement('div', 'axis');
			for (const [index, micros] of [0, domain.maximum / 2, domain.maximum].entries()) {
				const value = (micros / 1000).toLocaleString('en-US', { maximumSignificantDigits: 3, useGrouping: false });
				axis.append(timingElement('span', 'tick', `${value}${index === 2 ? ' ms' : ''}`));
			}
			cell.append(axis);
		} else cell.textContent = label!;
		row.append(cell);
	}
	head.append(row);
}

const KIND_LABELS: Record<PassTimingNode['kind'], string> = {
	render: 'Render', compute: 'Compute', copy: 'Copy', 'clear-buffer': 'Clear', command: 'Command', 'external-submission': 'External',
};

export function createTimingIdentity(node: PassTimingNode, options: {
	readonly onSelect: () => void; readonly focusKey?: string;
	readonly nameClass?: string; readonly prefixClass?: string; readonly suffixClass?: string; readonly kindClass?: string;
}): HTMLDivElement {
	const identity = timingElement('div', 'identity'); const label = labelNode(node);
	const name = timingElement('button', 'name'); name.type = 'button'; name.title = `${label} · ${node.id}`;
	name.classList.add('zenfg-inspector-relation-button');
	name.setAttribute('aria-label', label);
	if (options.focusKey) { name.dataset.passFocus = options.focusKey; name.dataset.overviewFocus = options.focusKey; }
	if (options.nameClass) name.classList.add(options.nameClass);
	const characters = [...label]; const suffixLength = characters.length > 24 ? 12 : 0;
	const prefix = timingElement('span', 'name-prefix', suffixLength ? characters.slice(0, -suffixLength).join('') : label);
	if (options.prefixClass) prefix.classList.add(options.prefixClass);
	name.append(prefix);
	if (suffixLength) {
		const suffix = timingElement('span', 'name-suffix', characters.slice(-suffixLength).join(''));
		if (options.suffixClass) suffix.classList.add(options.suffixClass);
		name.append(suffix);
	}
	name.addEventListener('click', options.onSelect);
	const kind = timingElement('span', 'kind', KIND_LABELS[node.kind]); kind.dataset.kind = node.kind;
	if (options.kindClass) kind.classList.add(options.kindClass);
	const attributes = timingElement('div', 'attributes'); attributes.append(kind, createPassAccesses(node));
	identity.append(name, attributes); return identity;
}

/** Counts declared access records, including repeated accesses to a resource. */
export function createPassAccesses(node: PassTimingNode): HTMLDivElement {
	const accesses = timingElement('div', 'accesses');
	accesses.setAttribute('aria-label', `${node.reads.length} reads; ${node.writes.length} writes; declared access records`);
	for (const [kind, count] of [['read', node.reads.length], ['write', node.writes.length]] as const) {
		const item = timingElement('span', 'access'); item.dataset.access = kind; item.dataset.zero = String(count === 0);
		item.append(timingElement('span', 'access-label', kind === 'read' ? 'Read' : 'Write'), timingElement('strong', 'access-count', String(count)));
		accesses.append(item);
	}
	return accesses;
}

export function appendTimingCells(row: HTMLTableRowElement, node: PassTimingNode, source: PassTimingSource, domain: PassTimingDomain,
	options: { readonly plotClass?: string; readonly barClass?: string; readonly durationClass?: string; readonly shareClass?: string } = {},
): { readonly plot: HTMLTableCellElement; readonly time?: HTMLTableCellElement; readonly share?: HTMLTableCellElement } {
	const duration = nodeTimingDuration(node, source);
	if (duration === undefined) {
		const state = timingElement('td', 'state'); state.colSpan = 3; state.dataset.timing = source;
		const value = source === 'cpu' ? 'Not collected' : node.kind === 'external-submission' ? 'Opaque'
			: node.kind === 'render' || node.kind === 'compute' ? 'Not collected' : 'Not applicable';
		state.append(timingElement('span', 'state-label', value)); state.setAttribute('aria-label', `${source.toUpperCase()}: ${value}`);
		row.append(state); return { plot: state };
	}
	const plot = timingElement('td', 'plot'); plot.dataset.timingColumn = 'plot';
	const bar = timingElement('span', 'bar'); bar.setAttribute('aria-hidden', 'true');
	const fill = document.createElement('span'); fill.style.width = `${domain.maximum > 0 ? duration / domain.maximum * 100 : 0}%`;
	bar.append(fill); plot.append(bar);
	const time = timingElement('td', 'duration'); time.dataset.timingColumn = 'time'; time.dataset.timing = source;
	const number = timingElement('span', 'number', (duration / 1000).toFixed(3)); number.classList.add('zenfg-inspector-pass-duration');
	time.append(number, document.createTextNode(' ms'));
	const percentage = domain.total > 0 ? `${(duration / domain.total * 100).toFixed(1)}%` : '—';
	time.setAttribute('aria-label', `${source.toUpperCase()}: ${(duration / 1000).toFixed(3)} ms; ${percentage} of capture measured pass sum`);
	const share = timingElement('td', 'percentage'); share.dataset.timingColumn = 'share';
	const shareNumber = timingElement('span', 'share-number', percentage); shareNumber.classList.add('zenfg-inspector-pass-share'); share.append(shareNumber);
	if (options.plotClass) plot.classList.add(options.plotClass);
	if (options.barClass) bar.classList.add(options.barClass);
	if (options.durationClass) time.classList.add(options.durationClass);
	if (options.shareClass) share.classList.add(options.shareClass);
	row.append(plot, time, share); return { plot, time, share };
}
