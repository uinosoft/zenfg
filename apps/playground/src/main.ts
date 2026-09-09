import type { FrameGraphInspector } from '@zenfg/inspector';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import { findPublicExample, publicExamples } from './catalog/catalog.ts';
import { createExamplePicker } from './examplePicker.ts';
import { parsePlaygroundRoute, routeSearch, toggledPanel } from './routing.ts';
import { createSourceView } from './sourceView.ts';
import { disposeHighlighter, highlightSource } from './syntaxHighlighter.ts';
import type { PlaygroundExampleDefinition, PlaygroundPanel, PlaygroundRuntime } from './types.ts';

const playground = requireElement<HTMLElement>('[data-playground]');
const effectCanvas = requireElement<HTMLCanvasElement>('[data-effect-canvas]');
const effectStatus = requireElement<HTMLElement>('[data-effect-status]');
const effectStatusText = requireElement<HTMLElement>('[data-effect-status-text]');
const examplePickerHost = requireElement<HTMLElement>('[data-example-picker]');
const exampleSummary = requireElement<HTMLElement>('[data-example-summary]');
const exampleHint = requireElement<HTMLElement>('[data-example-hint]');
const playgroundFooter = requireElement<HTMLElement>('.playground-footer');
const exampleError = requireElement<HTMLElement>('[data-example-error]');
const controlsHost = requireElement<HTMLElement>('[data-controls-host]');
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
let sourceView: ReturnType<typeof createSourceView> | undefined;
let disposed = false;
const mountAbort = new AbortController();

const examplePicker = createExamplePicker({
	host: examplePickerHost,
	examples: publicExamples,
	selectedId: example?.id,
	unavailableLabel: example ? undefined : `Unavailable · ${initialRoute.exampleId}`,
	onSelect: (exampleId) => {
		window.location.assign(routeSearch({ exampleId, panel: currentPanel }));
	},
});

if (example) {
	exampleSummary.textContent = example.summary;
	exampleHint.textContent = example.footerHint;
	document.title = `${example.title} · ZenFG Playground`;
	controlsHost.hidden = !example.hasControls;
}
else {
	exampleError.hidden = false;
	effectStatus.hidden = true;
	controlsHost.hidden = true;
	playgroundFooter.hidden = true;
	currentPanel = 'none';
	for (const button of panelButtons) button.disabled = button.dataset.panelButton !== 'none';
}

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
	if (event.defaultPrevented || event.key !== 'Escape' || currentPanel === 'none') return;
	event.preventDefault();
	closePanel();
});

let runtimePromise: Promise<PlaygroundRuntime | undefined> = Promise.resolve(undefined);
if (example) {
	runtimePromise = mountExample(example);
}
setPanel(currentPanel, false);

installAppPageLifecycle(window, {
	onDiscard: () => {
		disposed = true;
		mountAbort.abort();
		examplePicker.destroy();
		sourceView?.destroy();
		inspector?.destroy();
		runtime?.dispose();
		controlsHost.replaceChildren();
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
			signal: mountAbort.signal,
			onLoading: (message) => { if (!disposed) setEffectStatus('loading', message); },
			canvas: effectCanvas,
			controlsHost,
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

function initializeCodeWorkspace(definition: PlaygroundExampleDefinition): Promise<void> {
	sourceView = createSourceView({
		definition, files: sourceFiles, path: sourcePath,
		content: sourceContent, copy: copySource, highlight: highlightSource, copyText,
	});
	return sourceView.ready;
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
	if (state === 'ready') playground.dataset.hasFrame = 'true';
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
