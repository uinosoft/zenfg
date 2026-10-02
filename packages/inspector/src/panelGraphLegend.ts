import { createPanelIcon, setPanelButtonContent } from './panelIcons.ts';

/** A fixed trigger and independently scrolling overlay keep the hit target stable. */
export class GraphLegend {
    readonly root = document.createElement('div');
    private readonly button = document.createElement('button');
    private readonly popover = document.createElement('div');
    private readonly ownerDocument: Document;
    private readonly handleOutsideClick = (event: MouseEvent): void => {
        if (!this.popover.hidden && !this.contains(event.target)) this.close();
    };
    private readonly handleOutsideFocus = (event: FocusEvent): void => {
        if (!this.popover.hidden && !this.contains(event.target)) this.close();
    };
    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || this.popover.hidden || !this.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
    };

    constructor(content: HTMLElement, idPrefix: string) {
        this.ownerDocument = this.root.ownerDocument;
        this.root.className = 'zenfg-inspector-graph-legend-control';
        this.button.type = 'button';
        this.button.className = 'zenfg-inspector-graph-legend-toggle';
        setPanelButtonContent(this.button, 'legend', 'Legend');
        this.button.title = 'Show graph legend';
        this.button.setAttribute('aria-expanded', 'false');
        this.button.setAttribute('aria-controls', `${idPrefix}-graph-legend`);
        this.button.addEventListener('click', () => this.setOpen(this.popover.hidden !== false));
        this.popover.id = `${idPrefix}-graph-legend`;
        this.popover.className = 'zenfg-inspector-graph-legend-popover';
        this.popover.setAttribute('role', 'region');
        this.popover.setAttribute('aria-label', 'Graph legend');
        this.popover.hidden = true;
        const header = document.createElement('div');
        header.className = 'zenfg-inspector-graph-legend-header';
        const heading = document.createElement('strong');
        heading.textContent = 'Legend';
        const close = document.createElement('button');
        close.type = 'button';
        close.title = 'Close legend';
        close.setAttribute('aria-label', 'Close legend');
        close.append(createPanelIcon('close'));
        close.addEventListener('click', () => this.close(true));
        header.append(heading, close);
        content.setAttribute('aria-label', 'Legend entries');
        content.tabIndex = 0;
        this.popover.append(header, content);
        this.root.append(this.button, this.popover);
        this.ownerDocument.addEventListener('click', this.handleOutsideClick);
        this.ownerDocument.addEventListener('focusin', this.handleOutsideFocus);
        this.ownerDocument.addEventListener('keydown', this.handleKeyDown, true);
    }

    close(restoreFocus = false): void {
        this.setOpen(false);
        if (restoreFocus) this.button.focus();
    }

    destroy(): void {
        this.ownerDocument.removeEventListener('click', this.handleOutsideClick);
        this.ownerDocument.removeEventListener('focusin', this.handleOutsideFocus);
        this.ownerDocument.removeEventListener('keydown', this.handleKeyDown, true);
    }

    private setOpen(open: boolean): void {
        this.popover.hidden = !open;
        this.button.setAttribute('aria-expanded', String(open));
        this.button.title = open ? 'Hide graph legend' : 'Show graph legend';
    }

    private contains(target: EventTarget | null): boolean {
        return Boolean(target && typeof (target as Node).nodeType === 'number' && this.root.contains(target as Node));
    }
}
