import type { PlaygroundExampleDefinition, PlaygroundSourceFile } from './types.ts';

type SourceDefinition = Pick<PlaygroundExampleDefinition, 'id' | 'entrySourceId' | 'sourceFiles'>;

export function orderedSourceFiles(definition: SourceDefinition): readonly PlaygroundSourceFile[] {
	const entries = definition.sourceFiles.filter(file => file.id === definition.entrySourceId);
	if (entries.length !== 1) throw new Error(`Example ${definition.id} must declare exactly one matching source entry.`);
	if (new Set(definition.sourceFiles.map(file => file.id)).size !== definition.sourceFiles.length) {
		throw new Error(`Example ${definition.id} has duplicate source IDs.`);
	}
	return [entries[0]!, ...definition.sourceFiles.filter(file => file.id !== definition.entrySourceId)];
}

export function createSourceView(options: {
	readonly definition: SourceDefinition;
	readonly files: HTMLElement;
	readonly path: HTMLElement;
	readonly content: HTMLElement;
	readonly copy: HTMLButtonElement;
	readonly highlight: (source: string, language: PlaygroundSourceFile['language']) => Promise<string>;
	readonly copyText: (source: string) => Promise<void>;
}): { readonly ready: Promise<void>; readonly destroy: () => void } {
	const { definition, files, path, content, copy } = options;
	const document = files.ownerDocument;
	const ordered = orderedSourceFiles(definition);
	let revision = 0;
	let currentSource: string | undefined;
	let destroyed = false;
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	const buttons = new Map<string, HTMLButtonElement>();
	files.replaceChildren();
	copy.disabled = true;

	async function select(file: PlaygroundSourceFile): Promise<void> {
		const selectedRevision = ++revision;
		currentSource = undefined;
		clearTimeout(copiedTimer);
		copy.textContent = 'Copy';
		copy.disabled = true;
		for (const [id, button] of buttons) {
			button.classList.toggle('active', id === file.id);
			button.setAttribute('aria-pressed', String(id === file.id));
		}
		path.textContent = file.path;
		path.title = file.path;
		content.textContent = 'Loading source and syntax highlighter…';
		content.scrollTop = content.scrollLeft = 0;
		try {
			const source = await file.loadSource();
			if (destroyed || revision !== selectedRevision) return;
			const html = await options.highlight(source, file.language);
			if (destroyed || revision !== selectedRevision) return;
			currentSource = source;
			content.innerHTML = html;
			content.scrollTop = content.scrollLeft = 0;
			copy.disabled = false;
		} catch (error) {
			if (destroyed || revision !== selectedRevision) return;
			content.textContent = `Could not load source: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	for (const file of ordered) {
		const button = document.createElement('button');
		button.type = 'button';
		button.title = file.path;
		button.dataset.sourceId = file.id;
		button.dataset.sourceRole = file.role;
		const label = document.createElement('span');
		label.className = 'source-files__label';
		label.textContent = file.label;
		button.append(label);
		if (file.id === definition.entrySourceId) {
			const badge = document.createElement('span');
			badge.className = 'source-files__entry';
			badge.textContent = 'Entry';
			button.append(badge);
		}
		button.addEventListener('click', () => { void select(file); });
		buttons.set(file.id, button);
		files.append(button);
	}
	const onCopy = async (): Promise<void> => {
		if (currentSource === undefined) return;
		const copiedRevision = revision;
		try {
			await options.copyText(currentSource);
			if (destroyed || copiedRevision !== revision) return;
			copy.textContent = 'Copied';
		} catch {
			if (destroyed || copiedRevision !== revision) return;
			copy.textContent = 'Retry copy';
		}
		copiedTimer = setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
	};
	copy.addEventListener('click', onCopy);
	return {
		ready: select(ordered[0]!),
		destroy() {
			destroyed = true;
			revision++;
			clearTimeout(copiedTimer);
			copy.removeEventListener('click', onCopy);
			files.replaceChildren();
		},
	};
}
