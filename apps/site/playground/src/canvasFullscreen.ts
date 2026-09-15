import { setIconButton } from './icons.ts';

/** Changes presentation in place; the canvas and parameter pane keep their identity. */
export function createCanvasFullscreen(options: {
	root: HTMLElement;
	card: HTMLElement;
	button: HTMLButtonElement;
	parameters: HTMLElement;
	canvas: HTMLCanvasElement;
	onEnter: () => void;
	onChange: (syncUrl: boolean) => void;
}) {
	const { root, card, button } = options;
	const document = root.ownerDocument;
	const window = document.defaultView!;
	let full = false;
	let scroll = { left: 0, top: 0 };
	let focus: HTMLElement | null = null;
	let parameterScroll = 0;
	const background = new Map<HTMLElement, boolean>();

	function setFull(value: boolean, notify = true): void {
		if (full === value) return;
		if (value) {
			options.onEnter();
			scroll = { left: window.scrollX, top: window.scrollY };
			parameterScroll = options.parameters.scrollTop;
			focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			// Inert siblings along the ancestor chain, never an ancestor of the live canvas.
			for (let node: HTMLElement | null = card; node && node !== document.body; node = node.parentElement) {
				for (const sibling of node.parentElement?.children ?? []) {
					if (sibling === node || !(sibling instanceof HTMLElement)) continue;
					background.set(sibling, sibling.inert);
					sibling.inert = true;
				}
			}
		}
		full = value;
		root.dataset.full = String(full);
		card.setAttribute('role', full ? 'dialog' : 'region');
		if (full) card.setAttribute('aria-modal', 'true');
		else card.removeAttribute('aria-modal');
		setIconButton(button, full ? 'minimize' : 'maximize', full ? 'Exit fullscreen' : 'Expand canvas');
		button.setAttribute('aria-pressed', String(full));
		// Recompute normal pane constraints before restoring its scroll offset.
		options.onChange(notify);
		if (full) button.focus({ preventScroll: true });
		else {
			for (const [element, inert] of background) element.inert = inert;
			background.clear();
			options.parameters.scrollTop = parameterScroll;
			const target = focus?.isConnected && focus !== document.body ? focus : button;
			target.focus({ preventScroll: true });
			window.scrollTo({ ...scroll, behavior: 'instant' });
		}
	}

	const onCanvasPointer = () => {
		// Drag handlers may prevent the browser's default focus transfer.
		if (full) options.canvas.focus({ preventScroll: true });
	};
	const onClick = () => setFull(!full);
	const onButtonKey = (event: KeyboardEvent) => {
		// Space on this button must not also pause the example.
		if (event.key !== 'Tab') event.stopPropagation();
	};
	const onKey = (event: KeyboardEvent) => {
		if (!full) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			setFull(false);
		} else if (event.key === 'Tab') {
			const items = [...card.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex], summary')]
				.filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0 && !item.closest('[inert]'));
			const first = items[0] ?? button;
			const last = items.at(-1) ?? button;
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		}
	};
	setIconButton(button, 'maximize', 'Expand canvas');
	options.canvas.addEventListener('pointerdown', onCanvasPointer, true);
	button.addEventListener('click', onClick);
	button.addEventListener('keydown', onButtonKey);
	document.addEventListener('keydown', onKey, true);
	return {
		isFull: () => full,
		setFull,
		destroy(): void {
			options.canvas.removeEventListener('pointerdown', onCanvasPointer, true);
			button.removeEventListener('click', onClick);
			button.removeEventListener('keydown', onButtonKey);
			document.removeEventListener('keydown', onKey, true);
			for (const [element, inert] of background) element.inert = inert;
			background.clear();
		},
	};
}
