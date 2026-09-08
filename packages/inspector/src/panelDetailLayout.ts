/** Owns the dock/drawer geometry and modal keyboard boundary for one workbench. */
export class DetailLayout {
	private readonly backdrop = document.createElement('button');
	private readonly divider = document.createElement('div');
	private readonly resizeObserver: ResizeObserver | undefined;
	private readonly abort = new AbortController();
	private open = false;
	private preferredWidth = 340;
	private previousFocus: HTMLElement | undefined;
	private dragging = false;
	private modal = false;

	constructor(
		private readonly workspace: HTMLElement,
		private readonly main: HTMLElement,
		private readonly aside: HTMLElement,
		private readonly chrome: HTMLElement,
		private readonly onClose: () => void,
	) {
		this.backdrop.type = 'button';
		this.backdrop.className = 'zenfg-inspector-detail-backdrop';
		this.backdrop.setAttribute('aria-label', 'Close selection inspector');
		this.backdrop.tabIndex = -1;
		this.backdrop.hidden = true;
		this.backdrop.addEventListener('click', onClose);
		this.divider.className = 'zenfg-inspector-detail-divider';
		this.divider.setAttribute('role', 'separator');
		this.divider.setAttribute('aria-label', 'Resize selection inspector');
		this.divider.setAttribute('aria-orientation', 'vertical');
		this.divider.tabIndex = 0;
		this.divider.hidden = true;
		workspace.insertBefore(this.divider, aside);
		workspace.insertBefore(this.backdrop, aside);
		this.divider.addEventListener('pointerdown', (event) => {
			this.dragging = true;
			this.divider.setPointerCapture(event.pointerId);
			event.preventDefault();
		});
		this.divider.addEventListener('pointermove', (event) => {
			if (!this.dragging) return;
			this.preferredWidth = this.clampWidth(workspace.getBoundingClientRect().right - event.clientX);
			this.applyGeometry();
		});
		this.divider.addEventListener('pointerup', () => { this.dragging = false; });
		this.divider.addEventListener('lostpointercapture', () => { this.dragging = false; });
		this.divider.addEventListener('keydown', (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			event.stopPropagation();
			this.preferredWidth = this.clampWidth(event.key === 'Home' ? 300 : event.key === 'End' ? 480
				: this.preferredWidth + (event.key === 'ArrowLeft' ? 20 : -20));
			this.applyGeometry();
		});
		workspace.parentElement?.addEventListener('keydown', this.handleKey, { signal: this.abort.signal });
		this.resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.applyGeometry());
		this.resizeObserver?.observe(workspace);
	}

	get isDrawer(): boolean { return this.modal; }

	update(open: boolean): void {
		const changed = open !== this.open;
		if (changed && open) this.previousFocus = this.workspace.ownerDocument.activeElement as HTMLElement | undefined;
		this.open = open;
		this.applyGeometry();
		if (changed && !open) this.restoreFocus();
	}

	destroy(): void {
		this.abort.abort();
		this.resizeObserver?.disconnect();
		this.main.inert = false;
		this.chrome.inert = false;
		for (const sibling of this.chrome.parentElement?.children ?? []) if (sibling !== this.workspace) (sibling as HTMLElement).inert = false;
		if (this.open && this.modal) this.restoreFocus();
		this.open = false;
	}

	private restoreFocus(): void {
		const isAvailable = (element: HTMLElement | undefined): element is HTMLElement => {
			if (!element?.isConnected || element === element.ownerDocument.body || element.closest('[hidden], [inert]') || element.matches(':disabled')) return false;
			for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) if (parent.inert) return false;
			return true;
		};
		const target = isAvailable(this.previousFocus) ? this.previousFocus
			: this.chrome.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? undefined;
		if (isAvailable(target)) target.focus({ preventScroll: true });
	}

	private clampWidth(width: number): number {
		const available = this.workspace.getBoundingClientRect().width || 1024;
		return Math.max(300, Math.min(480, available - 648, width));
	}

	private applyGeometry(): void {
		const wasModal = this.modal;
		const available = this.workspace.getBoundingClientRect().width || 1024;
		this.modal = available < 948;
		if (this.modal && !wasModal && this.open && !this.aside.contains(document.activeElement)) this.previousFocus = this.workspace.ownerDocument.activeElement as HTMLElement | undefined;
		const width = this.clampWidth(this.preferredWidth);
		this.workspace.style.setProperty('--fgd-detail-width', `${width}px`);
		this.workspace.classList.toggle('detail-drawer', this.modal);
		this.workspace.classList.toggle('inspector-open', this.open);
		this.divider.hidden = !this.open || this.modal;
		this.divider.setAttribute('aria-valuemin', '300');
		this.divider.setAttribute('aria-valuemax', String(Math.max(300, Math.min(480, available - 648))));
		this.divider.setAttribute('aria-valuenow', String(Math.round(width)));
		this.backdrop.hidden = !this.open || !this.modal;
		this.main.inert = this.open && this.modal;
		this.chrome.inert = this.open && this.modal;
		for (const sibling of this.chrome.parentElement?.children ?? []) if (sibling !== this.workspace) (sibling as HTMLElement).inert = this.open && this.modal;
		if (this.open && this.modal) {
			this.aside.setAttribute('role', 'dialog');
			this.aside.setAttribute('aria-modal', 'true');
			if (!this.aside.contains(document.activeElement)) this.focusable()[0]?.focus();
		} else {
			this.aside.removeAttribute('role');
			this.aside.removeAttribute('aria-modal');
		}
		if (wasModal !== this.modal && this.open) this.workspace.dispatchEvent(new Event('detail-layout-change'));
	}

	private focusable(): HTMLElement[] {
		return Array.from(this.aside.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'))
			.filter((element) => {
				if (element.closest('[hidden]') || element.tabIndex < 0 && element.tagName !== 'SUMMARY') return false;
				for (let parent = element.parentElement; parent && parent !== this.aside; parent = parent.parentElement) {
					if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && !parent.querySelector(':scope > summary')?.contains(element)) return false;
				}
				return true;
			});
	}

	private readonly handleKey = (event: KeyboardEvent): void => {
		if (event.defaultPrevented || !this.open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.onClose();
		} else if (this.modal && event.key === 'Tab') {
			const items = this.focusable();
			if (!items.length) { event.preventDefault(); return; }
			const index = items.indexOf(document.activeElement as HTMLElement);
			if (event.shiftKey && index <= 0 || !event.shiftKey && (index === items.length - 1 || index < 0)) {
				event.preventDefault();
				(event.shiftKey ? items.at(-1) : items[0])?.focus();
			}
		}
	};
}
