import type { FrameGraphInspector } from '@zenfg/inspector';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import { findPublicExample, publicExamples } from './catalog/catalog.ts';
import { parsePlaygroundRoute, routeSearch, toggledPanel } from './routing.ts';
import { disposeHighlighter, highlightTypeScript } from './syntaxHighlighter.ts';
import type { PlaygroundExampleDefinition, PlaygroundPanel, PlaygroundRuntime, PlaygroundSourceFile } from './types.ts';

const playground = requireElement<HTMLElement>('[data-playground]');
const effectCanvas = requireElement<HTMLCanvasElement>('[data-effect-canvas]');
const effectStatus = requireElement<HTMLElement>('[data-effect-status]');
const effectStatusText = requireElement<HTMLElement>('[data-effect-status-text]');
const exampleSelect = requireElement<HTMLSelectElement>('[data-example-select]');
const exampleSummary = requireElement<HTMLElement>('[data-example-summary]');
const exampleHint = requireElement<HTMLElement>('[data-example-hint]');
const playgroundFooter = requireElement<HTMLElement>('.playground-footer');
const exampleError = requireElement<HTMLElement>('[data-example-error]');
const overlay = requireElement<HTMLElement>('[data-tool-overlay]');
const overlayEyebrow = requireElement<HTMLElement>('[data-overlay-eyebrow]');
const overlayTitle = requireElement<HTMLElement>('[data-overlay-title]');
const overlayClose = requireElement<HTMLButtonElement>('[data-overlay-close]');
const codeWorkspace = requireElement<HTMLElement>('[data-code-workspace]');
const inspectorWorkspace = requireElement<HTMLElement>('[data-inspector-workspace]');
const sourceFiles = requireElement<HTMLElement>('[data-source-files]');
const sourcePath = requireElement<HTMLElement>('[data-source-path]');
const sourceContent = requireElement<HTMLElement>('[data-source-content]');
const copySource = requireElement<HTMLButtonElement>('[data-copy-source]');
const inspectorLoading = requireElement<HTMLElement>('[data-inspector-loading]');
const inspectorHost = requireElement<HTMLElement>('[data-inspector-host]');
const panelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel-button]'));

const initialRoute = parsePlaygroundRoute(window.location.search);
let currentPanel: PlaygroundPanel = initialRoute.panel;
let example: PlaygroundExampleDefinition | undefined = findPublicExample(initialRoute.exampleId);
let runtime: PlaygroundRuntime | undefined;
let inspector: FrameGraphInspector | undefined;
let inspectorPromise: Promise<void> | undefined;
let codePromise: Promise<void> | undefined;
let currentSource: string | undefined;
let sourceRevision = 0;
let disposed = false;

const exampleGroups = new Map<string, HTMLOptGroupElement>();
for (const catalogExample of publicExamples) {
	let group = exampleGroups.get(catalogExample.group);
	if (!group) {
		group = document.createElement('optgroup');
		group.label = catalogExample.group;
		exampleGroups.set(catalogExample.group, group);
		exampleSelect.appendChild(group);
	}
	const option = document.createElement('option');
	option.value = catalogExample.id;
	option.textContent = catalogExample.title;
	group.appendChild(option);
}

if (example) {
	exampleSelect.value = example.id;
	exampleSummary.textContent = example.summary;
	exampleHint.textContent = example.footerHint;
	document.title = `${example.title} · ZenFG Playground`;
}
else {
	const unavailableOption = document.createElement('option');
	unavailableOption.value = initialRoute.exampleId;
	unavailableOption.textContent = `Unavailable · ${initialRoute.exampleId}`;
	unavailableOption.disabled = true;
	exampleSelect.prepend(unavailableOption);
	exampleSelect.value = initialRoute.exampleId;
	exampleError.hidden = false;
	effectStatus.hidden = true;
	playgroundFooter.hidden = true;
	currentPanel = 'none';
	for (const button of panelButtons) button.disabled = button.dataset.panelButton !== 'none';
}

exampleSelect.addEventListener('change', () => {
	window.location.assign(routeSearch({ exampleId: exampleSelect.value, panel: currentPanel }));
});

for (const button of panelButtons) {
	button.addEventListener('click', () => {
		const requested = parseButtonPanel(button.dataset.panelButton);
		setPanel(toggledPanel(currentPanel, requested));
	});
}

overlayClose.addEventListener('click', () => {
	closePanel();
});

document.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape' || currentPanel === 'none') return;
	event.preventDefault();
	closePanel();
});

copySource.addEventListener('click', () => {
	if (!currentSource) return;
	void copyText(currentSource).then(() => {
		copySource.textContent = 'Copied';
		window.setTimeout(() => {
			copySource.textContent = 'Copy';
		}, 1200);
	});
});

let runtimePromise: Promise<PlaygroundRuntime | undefined> = Promise.resolve(undefined);
if (example) {
	runtimePromise = mountExample(example);
}
setPanel(currentPanel, false);

installAppPageLifecycle(window, {
	onDiscard: () => {
		disposed = true;
		inspector?.destroy();
		runtime?.dispose();
		void disposeHighlighter();
	},
	reloadOnRestore: import.meta.hot ? () => {
		window.location.reload();
	} : undefined,
});

async function mountExample(definition: PlaygroundExampleDefinition): Promise<PlaygroundRuntime | undefined> {
	setEffectStatus('loading', 'Initializing WebGPU…');
	let reportedError = false;
	try {
		const mounted = await definition.mount({
			canvas: effectCanvas,
			onReady: (message) => {
				setEffectStatus('ready', message ?? definition.readyMessage);
			},
			onError: (error) => {
				reportedError = true;
				setEffectStatus('error', error.message);
			},
		});
		if (disposed) {
			mounted?.dispose();
			return undefined;
		}
		runtime = mounted;
		if (!mounted && !reportedError) setEffectStatus('error', 'This example could not start WebGPU.');
		return mounted;
	}
	catch (error) {
		setEffectStatus('error', toError(error).message);
		return undefined;
	}
}

function setPanel(panel: PlaygroundPanel, syncUrl = true): void {
	if (!example && panel !== 'none') panel = 'none';
	currentPanel = panel;
	playground.dataset.panel = panel;
	overlay.hidden = panel === 'none';
	codeWorkspace.hidden = panel !== 'code';
	inspectorWorkspace.hidden = panel !== 'inspector';

	for (const button of panelButtons) {
		button.setAttribute('aria-pressed', String(button.dataset.panelButton === panel));
	}

	if (panel === 'code') {
		overlayEyebrow.textContent = 'Exact source';
		overlayTitle.textContent = 'Code';
		void ensureCodeWorkspace();
	}
	else if (panel === 'inspector') {
		overlayEyebrow.textContent = 'Live capture';
		overlayTitle.textContent = 'FrameGraph Inspector';
		void ensureInspectorWorkspace();
	}

	if (syncUrl) {
		const url = `${window.location.pathname}${routeSearch({
			exampleId: example?.id ?? initialRoute.exampleId,
			panel,
		})}${window.location.hash}`;
		window.history.replaceState(null, '', url);
	}
}

function ensureCodeWorkspace(): Promise<void> {
	if (!example) return Promise.resolve();
	codePromise ??= initializeCodeWorkspace(example);
	return codePromise;
}

async function initializeCodeWorkspace(definition: PlaygroundExampleDefinition): Promise<void> {
	sourceFiles.replaceChildren();
	for (const [index, file] of definition.sourceFiles.entries()) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = file.label;
		button.dataset.sourceId = file.id;
		button.dataset.sourceRole = file.role;
		button.addEventListener('click', () => {
			void selectSource(file, button);
		});
		sourceFiles.appendChild(button);
		if (index === 0) await selectSource(file, button);
	}
}

async function selectSource(file: PlaygroundSourceFile, button: HTMLButtonElement): Promise<void> {
	const revision = ++sourceRevision;
	for (const candidate of sourceFiles.querySelectorAll<HTMLButtonElement>('button')) {
		candidate.classList.toggle('active', candidate === button);
		candidate.setAttribute('aria-pressed', String(candidate === button));
	}
	sourcePath.textContent = file.path;
	copySource.disabled = true;
	sourceContent.innerHTML = '<p class="panel-message">Loading source and syntax highlighter…</p>';
	try {
		const source = await file.loadSource();
		const html = await highlightTypeScript(source);
		if (revision !== sourceRevision) return;
		currentSource = source;
		sourceContent.innerHTML = html;
		copySource.disabled = false;
	}
	catch (error) {
		if (revision !== sourceRevision) return;
		currentSource = undefined;
		sourceContent.textContent = `Could not load source: ${toError(error).message}`;
	}
}

function ensureInspectorWorkspace(): Promise<void> {
	inspectorPromise ??= initializeInspectorWorkspace();
	return inspectorPromise;
}

async function initializeInspectorWorkspace(): Promise<void> {
	inspectorLoading.hidden = false;
	inspectorLoading.textContent = 'Waiting for the live example…';
	const mounted = await runtimePromise;
	if (!mounted) {
		inspectorLoading.textContent = 'Live capture is unavailable because WebGPU could not start. The source remains available in Code.';
		return;
	}

	inspectorLoading.textContent = 'Loading FrameGraph Inspector…';
	try {
		const { mountFrameGraphInspector } = await import('@zenfg/inspector');
		if (disposed) return;
		inspector = mountFrameGraphInspector(inspectorHost, {
			branding: false,
			captureSnapshot: () => mounted.captureSnapshot(),
		});
		inspectorLoading.hidden = true;
	}
	catch (error) {
		inspectorLoading.textContent = `Could not load the Inspector: ${toError(error).message}`;
	}
}

function setEffectStatus(state: 'loading' | 'ready' | 'error', message: string): void {
	effectStatus.hidden = false;
	effectStatus.dataset.state = state;
	effectStatusText.textContent = message;
	playground.dataset.effectState = state;
}

function panelButtonFor(panel: PlaygroundPanel): HTMLButtonElement | undefined {
	return panelButtons.find((button) => button.dataset.panelButton === panel);
}

function closePanel(): void {
	const closingPanel = currentPanel;
	setPanel('none');
	panelButtonFor(closingPanel)?.focus();
}

function parseButtonPanel(value: string | undefined): PlaygroundPanel {
	return value === 'code' || value === 'inspector' ? value : 'none';
}

async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const textArea = document.createElement('textarea');
	textArea.value = text;
	textArea.readOnly = true;
	textArea.style.position = 'fixed';
	textArea.style.left = '-9999px';
	document.body.appendChild(textArea);
	textArea.select();
	document.execCommand('copy');
	textArea.remove();
}

function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) throw new Error(`Playground element is missing: ${selector}`);
	return element;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
