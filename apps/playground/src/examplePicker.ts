export type ExamplePickerEntry = {
	readonly id: string;
	readonly title: string;
	readonly group: string;
};

export type ExamplePickerController = {
	readonly close: () => void;
	readonly destroy: () => void;
};

export function createExamplePicker(options: {
	readonly host: HTMLElement;
	readonly examples: readonly ExamplePickerEntry[];
	readonly selectedId?: string;
	readonly unavailableLabel?: string;
	readonly onSelect: (id: string) => void;
}): ExamplePickerController {
	const { host } = options;
	const document = host.ownerDocument;
	const trigger = document.createElement('button');
	const value = document.createElement('span');
	const chevron = document.createElement('span');
	const listbox = document.createElement('div');
	const listboxId = `example-picker-listbox-${nextPickerId++}`;
	const optionElements: HTMLButtonElement[] = [];
	let open = false;
	let destroyed = false;
	let typeahead = '';
	let lastTypeaheadTime = 0;

	host.classList.add('example-picker');
	host.replaceChildren();
	trigger.type = 'button';
	trigger.className = 'example-picker__trigger';
	trigger.setAttribute('role', 'combobox');
	trigger.setAttribute('aria-label', 'Select example');
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-controls', listboxId);
	trigger.setAttribute('aria-expanded', 'false');
	value.className = 'example-picker__value';
	value.textContent = options.examples.find((entry) => entry.id === options.selectedId)?.title
		?? options.unavailableLabel
		?? 'Select an example';
	chevron.className = 'example-picker__chevron';
	chevron.setAttribute('aria-hidden', 'true');
	trigger.append(value, chevron);

	listbox.id = listboxId;
	listbox.className = 'example-picker__listbox';
	listbox.setAttribute('role', 'listbox');
	listbox.setAttribute('aria-label', 'Examples');
	listbox.hidden = true;

	const groups = new Map<string, { readonly element: HTMLElement; readonly options: HTMLElement }>();
	for (const entry of options.examples) {
		let group = groups.get(entry.group);
		if (!group) {
			const groupElement = document.createElement('section');
			const groupLabel = document.createElement('div');
			const groupOptions = document.createElement('div');
			const groupId = `${listboxId}-group-${groups.size + 1}`;
			groupElement.className = 'example-picker__group';
			groupElement.setAttribute('role', 'group');
			groupElement.setAttribute('aria-labelledby', groupId);
			groupLabel.id = groupId;
			groupLabel.className = 'example-picker__group-label';
			groupLabel.textContent = entry.group;
			groupOptions.className = 'example-picker__group-options';
			groupElement.append(groupLabel, groupOptions);
			listbox.appendChild(groupElement);
			group = { element: groupElement, options: groupOptions };
			groups.set(entry.group, group);
		}

		const option = document.createElement('button');
		option.type = 'button';
		option.className = 'example-picker__option';
		option.dataset.exampleId = entry.id;
		option.setAttribute('role', 'option');
		option.setAttribute('aria-selected', String(entry.id === options.selectedId));
		option.tabIndex = entry.id === options.selectedId ? 0 : -1;
		option.textContent = entry.title;
		option.addEventListener('click', handleOptionClick);
		option.addEventListener('keydown', handleOptionKeyDown);
		group.options.appendChild(option);
		optionElements.push(option);
	}

	host.append(trigger, listbox);
	trigger.addEventListener('click', handleTriggerClick);
	trigger.addEventListener('keydown', handleTriggerKeyDown);
	document.addEventListener('pointerdown', handleDocumentPointerDown);
	document.addEventListener('keydown', handleDocumentKeyDown);

	function setOpen(nextOpen: boolean, focus: 'selected' | 'first' | 'last' | 'none' = 'none'): void {
		if (destroyed || open === nextOpen) {
			if (nextOpen) focusOption(focus);
			return;
		}
		open = nextOpen;
		host.dataset.open = String(open);
		trigger.setAttribute('aria-expanded', String(open));
		listbox.hidden = !open;
		if (open) focusOption(focus);
	}

	function focusOption(target: 'selected' | 'first' | 'last' | 'none'): void {
		if (target === 'none' || optionElements.length === 0) return;
		const selectedIndex = optionElements.findIndex((candidate) => (
			candidate.getAttribute('aria-selected') === 'true'
		));
		const index = target === 'first'
			? 0
			: target === 'last'
				? optionElements.length - 1
				: Math.max(0, selectedIndex);
		focusOptionAt(index);
	}

	function focusOptionAt(index: number): void {
		const boundedIndex = Math.min(optionElements.length - 1, Math.max(0, index));
		for (const [candidateIndex, candidate] of optionElements.entries()) {
			candidate.tabIndex = candidateIndex === boundedIndex ? 0 : -1;
		}
		optionElements[boundedIndex]?.focus();
	}

	function selectOption(option: HTMLButtonElement): void {
		const id = option.dataset.exampleId;
		if (!id) return;
		setOpen(false);
		trigger.focus();
		if (id !== options.selectedId) options.onSelect(id);
	}

	function handleTriggerClick(): void {
		setOpen(!open, 'selected');
	}

	function handleTriggerKeyDown(event: KeyboardEvent): void {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				setOpen(true, 'selected');
				break;
			case 'ArrowUp':
				event.preventDefault();
				setOpen(true, 'last');
				break;
			case 'Home':
				event.preventDefault();
				setOpen(true, 'first');
				break;
			case 'End':
				event.preventDefault();
				setOpen(true, 'last');
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				setOpen(!open, 'selected');
				break;
			default:
				handleTypeahead(event);
		}
	}

	function handleOptionClick(event: MouseEvent): void {
		selectOption(event.currentTarget as HTMLButtonElement);
	}

	function handleOptionKeyDown(event: KeyboardEvent): void {
		const currentIndex = optionElements.indexOf(event.currentTarget as HTMLButtonElement);
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				focusOptionAt(currentIndex + 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusOptionAt(currentIndex - 1);
				break;
			case 'Home':
				event.preventDefault();
				focusOptionAt(0);
				break;
			case 'End':
				event.preventDefault();
				focusOptionAt(optionElements.length - 1);
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				selectOption(event.currentTarget as HTMLButtonElement);
				break;
			case 'Tab':
				setOpen(false);
				break;
			default:
				handleTypeahead(event);
		}
	}

	function handleTypeahead(event: KeyboardEvent): void {
		if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
		event.preventDefault();
		const now = event.timeStamp;
		typeahead = now - lastTypeaheadTime > 600
			? event.key.toLocaleLowerCase()
			: `${typeahead}${event.key.toLocaleLowerCase()}`;
		lastTypeaheadTime = now;
		const matchIndex = optionElements.findIndex((option) => (
			option.textContent?.trim().toLocaleLowerCase().startsWith(typeahead)
		));
		if (matchIndex < 0) return;
		setOpen(true);
		focusOptionAt(matchIndex);
	}

	function handleDocumentPointerDown(event: PointerEvent): void {
		if (!open || !event.target || host.contains(event.target as Node)) return;
		setOpen(false);
	}

	function handleDocumentKeyDown(event: KeyboardEvent): void {
		if (!open || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopImmediatePropagation();
		setOpen(false);
		trigger.focus();
	}

	return {
		close: () => setOpen(false),
		destroy() {
			if (destroyed) return;
			destroyed = true;
			trigger.removeEventListener('click', handleTriggerClick);
			trigger.removeEventListener('keydown', handleTriggerKeyDown);
			for (const option of optionElements) {
				option.removeEventListener('click', handleOptionClick);
				option.removeEventListener('keydown', handleOptionKeyDown);
			}
			document.removeEventListener('pointerdown', handleDocumentPointerDown);
			document.removeEventListener('keydown', handleDocumentKeyDown);
			host.replaceChildren();
			host.classList.remove('example-picker');
			delete host.dataset.open;
		},
	};
}

let nextPickerId = 1;
