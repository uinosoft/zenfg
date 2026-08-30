import { ensureInspectorShellStyles } from './shellStyles.ts';

export type InspectorShellAction = {
    readonly id?: string;
    readonly label: string;
    readonly title?: string;
    readonly disabled?: boolean;
    readonly active?: boolean;
    readonly onClick: () => void;
};

export type InspectorShellOptions = {
    readonly id?: string;
    readonly title: string;
    readonly onExpandedChange?: (expanded: boolean) => void;
};

type InspectorShellActionView = {
    readonly dom: HTMLButtonElement;
    descriptor: InspectorShellAction;
};

export const INSPECTOR_SHELL_EXPANDED_EVENT = 'zenfg-inspector-shell-expanded';
export const INSPECTOR_SHELL_DESTROYED_EVENT = 'zenfg-inspector-shell-destroyed';

export class InspectorShell {
    readonly dom: HTMLElement;
    readonly body: HTMLElement;
    readonly headerStatus: HTMLElement;

    private readonly actions: HTMLElement;
    private readonly toggleButton: HTMLButtonElement;
    private readonly actionViews = new Map<string, InspectorShellActionView>();
    private readonly onExpandedChange: ((expanded: boolean) => void) | undefined;
    private isExpanded = false;
    private destroyed = false;

    constructor(options: InspectorShellOptions) {
        ensureInspectorShellStyles();
        this.onExpandedChange = options.onExpandedChange;

        this.dom = document.createElement('section');
        this.dom.className = 'zenfg-inspector-shell';
        this.dom.id = options.id ?? createPanelId();

        const header = document.createElement('header');
        header.className = 'zenfg-inspector-shell-header';
        header.addEventListener('click', () => this.setExpanded(!this.isExpanded));

        this.toggleButton = document.createElement('button');
        this.toggleButton.type = 'button';
        this.toggleButton.className = 'zenfg-inspector-shell-toggle';
        this.toggleButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setExpanded(!this.isExpanded);
        });

        const title = document.createElement('div');
        title.className = 'zenfg-inspector-shell-title';
        title.id = `${this.dom.id}-title`;
        title.textContent = options.title;
        this.dom.setAttribute('aria-labelledby', title.id);

        this.headerStatus = document.createElement('span');
        this.headerStatus.className = 'zenfg-inspector-shell-header-status';
        this.headerStatus.hidden = true;

        this.actions = document.createElement('div');
        this.actions.className = 'zenfg-inspector-shell-actions';
        this.actions.addEventListener('click', (event) => event.stopPropagation());

        this.body = document.createElement('div');
        this.body.className = 'zenfg-inspector-shell-body';
        this.body.id = `${this.dom.id}-body`;
        this.toggleButton.setAttribute('aria-controls', this.body.id);

        header.append(this.toggleButton, title, this.headerStatus, this.actions);
        this.dom.append(header, this.body);
        this.updateExpandedState();
    }

    get expanded(): boolean {
        return this.isExpanded;
    }

    setExpanded(expanded: boolean): void {
        if (this.destroyed || this.isExpanded === expanded) return;
        this.isExpanded = expanded;
        this.updateExpandedState();
        if (expanded) {
            this.dom.dispatchEvent(createBubblingEvent(this.dom, INSPECTOR_SHELL_EXPANDED_EVENT));
        }
        this.onExpandedChange?.(expanded);
    }

    setActions(actions: readonly InspectorShellAction[]): void {
        if (this.destroyed) return;
        const descriptors = createKeyedActions(actions);
        const activeKeys = new Set(descriptors.map(({ key }) => key));
        for (const [key, view] of this.actionViews) {
            if (!activeKeys.has(key)) {
                view.dom.remove();
                this.actionViews.delete(key);
            }
        }
        for (const { key, action } of descriptors) {
            let view = this.actionViews.get(key);
            if (!view) {
                const dom = document.createElement('button');
                dom.type = 'button';
                dom.className = 'zenfg-inspector-shell-action';
                view = { dom, descriptor: action };
                dom.addEventListener('click', () => view!.descriptor.onClick());
                this.actionViews.set(key, view);
            }
            view.descriptor = action;
            view.dom.textContent = action.label;
            view.dom.title = action.title ?? action.label;
            view.dom.setAttribute('aria-label', action.title ?? action.label);
            view.dom.disabled = action.disabled ?? false;
            view.dom.classList.toggle('active', action.active ?? false);
        }
        placeInOrder(this.actions, descriptors.map(({ key }) => this.actionViews.get(key)!.dom));
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.dom.dispatchEvent(createBubblingEvent(this.dom, INSPECTOR_SHELL_DESTROYED_EVENT));
        this.actionViews.clear();
        this.dom.remove();
    }

    private updateExpandedState(): void {
        this.toggleButton.textContent = this.isExpanded ? '\u25be' : '\u25b8';
        this.toggleButton.setAttribute('aria-label', this.isExpanded ? 'Collapse debug panel' : 'Expand debug panel');
        this.toggleButton.setAttribute('aria-expanded', `${this.isExpanded}`);
        this.toggleButton.classList.toggle('active', this.isExpanded);
        this.toggleButton.title = this.isExpanded ? 'Collapse the debug panel.' : 'Expand the debug panel.';
        this.dom.classList.toggle('expanded', this.isExpanded);
        this.dom.classList.toggle('collapsed', !this.isExpanded);
        this.body.hidden = !this.isExpanded;
    }
}

function createKeyedActions(actions: readonly InspectorShellAction[]): Array<{ key: string; action: InspectorShellAction }> {
    const occurrences = new Map<string, number>();
    return actions.map((action) => {
        const base = action.id ? `id:${action.id}` : `label:${action.label}`;
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        return { key: occurrence === 0 ? base : `${base}:${occurrence}`, action };
    });
}

function placeInOrder(container: HTMLElement, elements: readonly HTMLElement[]): void {
    let nextNode = container.firstChild;
    for (const element of elements) {
        if (element === nextNode) {
            nextNode = nextNode.nextSibling;
        } else {
            container.insertBefore(element, nextNode);
        }
    }
}

function createBubblingEvent(target: HTMLElement, type: string): Event {
    const EventConstructor = target.ownerDocument.defaultView?.Event ?? Event;
    return new EventConstructor(type, { bubbles: true });
}

let nextPanelId = 0;
function createPanelId(): string {
    nextPanelId += 1;
    return `zenfg-inspector-shell-${nextPanelId}`;
}
