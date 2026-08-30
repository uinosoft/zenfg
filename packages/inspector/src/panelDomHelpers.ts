import type {
    FrameGraphDebugNode,
    FrameGraphDebugViewModel,
} from './debugCaptureModel.ts';

export function createSection(title: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'zenfg-inspector-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    section.appendChild(heading);
    return section;
}

export function createTable(headers: readonly string[]): HTMLTableElement {
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const header of headers) {
        const cell = document.createElement('th');
        cell.textContent = header;
        headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    table.append(head, document.createElement('tbody'));
    return table;
}

export function createStat(label: string, value: string): HTMLElement {
    const item = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = label;
    const count = document.createElement('strong');
    count.textContent = value;
    item.append(name, count);
    return item;
}

export type FrameGraphDebugCellOptions = {
	readonly column?: 'code' | 'kind' | 'numeric';
	readonly kind?: string;
};

export function createCell(text: string, options?: FrameGraphDebugCellOptions): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (options?.column) cell.dataset.column = options.column;
    if (options?.kind) cell.dataset.kind = options.kind;
    return cell;
}

export function createButtonCell(text: string, onClick: () => void): HTMLTableCellElement {
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    cell.appendChild(button);
    return cell;
}

export function createToolbarButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', onClick);
    return button;
}

export function createListButton(text: string, selected: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (selected) {
        button.className = 'selected';
    }
    button.addEventListener('click', onClick);
    return button;
}

export function createMutedText(text: string): HTMLElement {
    const element = document.createElement('p');
    element.className = 'zenfg-inspector-muted';
    element.textContent = text;
    return element;
}

export function createMutedActionText(prefix: string, actionText: string, suffix: string, onAction: () => void): HTMLElement {
    const element = document.createElement('p');
    element.className = 'zenfg-inspector-muted';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zenfg-inspector-inline-action';
    button.textContent = actionText;
    button.addEventListener('click', onAction);
    element.append(document.createTextNode(prefix), button, document.createTextNode(suffix));
    return element;
}

export function formatProfilingStatus(snapshot: FrameGraphDebugViewModel): string {
    const profiling = snapshot.profiling;
    if (!profiling) {
        return 'off';
    }
    if (profiling.status === 'available') {
        return `frame ${profiling.frameIndex}`;
    }
    return profiling.reason;
}

export function formatGpuDuration(node: FrameGraphDebugNode): string {
    if (node.gpuDurationMicros === undefined) {
        return '-';
    }
    return (node.gpuDurationMicros / 1000).toFixed(3);
}

export function formatGpuFrameDuration(snapshot: FrameGraphDebugViewModel): string {
    if (snapshot.profiling.status !== 'available') {
        return '-';
    }
    return (snapshot.profiling.gpuFrameDurationMicros / 1000).toFixed(3);
}

export function formatPoolHitRate(snapshot: FrameGraphDebugViewModel): string {
    const pool = snapshot.resourcePool;
    if (!pool || pool.status !== 'available' || pool.acquireCount === 0) {
        return '-';
    }
    return `${((pool.reuseCount / pool.acquireCount) * 100).toFixed(0)}%`;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function labelNode(node: Pick<FrameGraphDebugNode, 'id' | 'label'>): string {
    return node.label ?? `node-${node.id}`;
}

export function labelResource(resource: { readonly id: string; readonly kind: string; readonly label?: string }): string {
    return resource.label ?? `${resource.kind}-${resource.id}`;
}
