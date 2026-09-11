import { renderExampleText } from './exampleIntro.ts';
import { createIcon, setIconButton } from './icons.ts';
import { exampleTagLabels } from './exampleTags.ts';
import { createExampleStatus, type ExampleStatus } from './exampleStatus.ts';
import type { createFrameRateMonitor } from './frameRateMonitor.ts';
import type { FrameGraphInspector } from '@zenfg/inspector';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import { findPublicExample, publicExamples } from './catalog/catalog.ts';
import { createExampleDirectory } from './exampleDirectory.ts';
import { setTheme, getTheme, subscribeTheme } from './theme.ts';
import { tokyoNightStorm, tokyoNightLight } from '@zenfg/inspector/theme';
import { parsePlaygroundRoute, routeSearch } from './routing.ts';
import { createSourceView } from './sourceView.ts';
import { disposeHighlighter, highlightSource } from './syntaxHighlighter.ts';
import type { PlaygroundExampleDefinition, PlaygroundPanel, PlaygroundRuntime } from './types.ts';

const playground = requireElement<HTMLElement>('[data-playground]');
// The development apps use separate ports; deployed apps share a parent directory.
if (import.meta.env.DEV) {
	const home = new URL('/', window.location.href);
	home.port = '5173';
	for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-home-link]')) link.href = home.href;
}
const effectCanvas = requireElement<HTMLCanvasElement>('[data-effect-canvas]');
const effectStatus = requireElement<HTMLElement>('[data-effect-status]');
// Overlay keyboard interaction must not trigger example shortcuts (for example Space).
effectStatus.addEventListener('keydown', event => event.stopPropagation());
const detailToggle = requireElement<HTMLElement>('.runtime-status__toggle');
detailToggle.prepend(createIcon(document, 'chevron'));
effectStatus.addEventListener('toggle', () => {
	detailToggle.lastChild!.textContent = effectStatus.hasAttribute('open') ? 'Hide details' : 'Details';
});
const effectStatusText = requireElement<HTMLElement>('[data-effect-status-text]');
const exampleDirectoryHost = requireElement<HTMLElement>('[data-example-directory]');
const exampleTags = requireElement<HTMLElement>('[data-example-tags]');
const exampleDescription = requireElement<HTMLElement>('[data-example-description]');
const exampleError = requireElement<HTMLElement>('[data-example-error]');
const controlsHost = requireElement<HTMLElement>('[data-controls-host]');
const controlsPanel = requireElement<HTMLElement>('[data-controls-panel]');
const metricsHost = requireElement<HTMLElement>('[data-metrics-host]');
const workbench = requireElement<HTMLElement>('[data-workbench]');
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
const example: PlaygroundExampleDefinition | undefined = findPublicExample(initialRoute.exampleId);
let runtime: PlaygroundRuntime | undefined;
let inspector: FrameGraphInspector | undefined;
const inspectorThemes = { dark: tokyoNightStorm, light: tokyoNightLight };
const unsubscribeTheme = subscribeTheme(mode => inspector?.setTheme(inspectorThemes[mode]));
let inspectorPromise: Promise<void> | undefined;
let codePromise: Promise<void> | undefined;
let sourceView: ReturnType<typeof createSourceView> | undefined;
let disposed = false;
let frameRateMonitor: ReturnType<typeof createFrameRateMonitor> | undefined;
const mountAbort = new AbortController();
const runtimeStatus = createExampleStatus({
	root: playground, status: effectStatus, label: effectStatusText,
	signal: requireElement<HTMLElement>('.effect-status__signal'),
	feedback: requireElement<HTMLElement>('[data-example-feedback]'),
	preview: requireElement<HTMLElement>('[data-status-preview]'),
	onFrameRate: value => frameRateMonitor?.update(value),
	onFrameSample: value => frameRateMonitor?.record(value),
	readyState: example?.readyState ?? 'ready', loadingNote: example?.loadingNote,
});

const statusTimer = window.setInterval(() => runtimeStatus.tick(performance.now()), 250);
const onVisibilityChange = () => runtimeStatus.suspend(document.hidden);
const onPageHide = () => runtimeStatus.suspend(true);
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('pagehide', onPageHide);
onVisibilityChange();

const exampleDirectory = createExampleDirectory({
	host: exampleDirectoryHost, examples: publicExamples, selectedId: example?.id, panel: currentPanel,
});
const directoryToggle = requireElement<HTMLButtonElement>('[data-directory-toggle]');
const directory = requireElement<HTMLElement>('#example-directory');
const narrowViewport = window.matchMedia('(max-width: 800px)');
function setDirectoryOpen(open: boolean): void {
	if (!open && directory.contains(document.activeElement)) directoryToggle.focus();
	directory.hidden = !open;
	playground.dataset.directoryOpen = String(open);
	directoryToggle.setAttribute('aria-expanded', String(open));
	setIconButton(directoryToggle, open ? 'panelClose' : 'panelOpen', open ? 'Close example directory' : 'Open example directory');
}
setDirectoryOpen(!narrowViewport.matches);
const onViewportChange = (): void => setDirectoryOpen(!narrowViewport.matches);
narrowViewport.addEventListener('change', onViewportChange);
directoryToggle.addEventListener('click', () => setDirectoryOpen(directory.hidden === true));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-mode]')) {
	setIconButton(button, button.dataset.themeMode === 'light' ? 'sun' : 'moon', button.dataset.themeMode === 'light' ? 'Light' : 'Dark');
	button.addEventListener('click', () => setTheme(button.dataset.themeMode === 'light' ? 'light' : 'dark'));
}
const maximizeButton = requireElement<HTMLButtonElement>('[data-maximize]');
setIconButton(maximizeButton, 'maximize', 'Expand tools');
setIconButton(copySource, 'copy', 'Copy');
let maximized = false;
let restoreScroll = 0;
let restoreFocus: HTMLElement | null = null;
function setMaximized(value: boolean): void {
	if (maximized === value) return;
	if (value) {
		restoreScroll = window.scrollY;
		restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}
	maximized = value;
	workbench.dataset.maximized = String(value);
	workbench.setAttribute('role', value ? 'dialog' : 'region');
	if (value) workbench.setAttribute('aria-modal', 'true');
	else workbench.removeAttribute('aria-modal');
	setIconButton(maximizeButton, value ? 'minimize' : 'maximize', value ? 'Restore tools' : 'Expand tools');
	maximizeButton.setAttribute('aria-label', value ? 'Restore tools' : 'Expand tools');
	maximizeButton.setAttribute('aria-pressed', String(value));
	for (const region of document.querySelectorAll<HTMLElement>('[data-background-region]')) region.inert = value;
	if (value) maximizeButton.focus({ preventScroll: true });
	else {
		restoreFocus?.focus({ preventScroll: true });
		window.scrollTo({ top: restoreScroll, behavior: 'instant' });
	}
}
maximizeButton.addEventListener('click', () => setMaximized(!maximized));

if (example) {
	for (const id of example.tags) {
		const tag = document.createElement('li');
		tag.dataset.tag = id;
		tag.textContent = exampleTagLabels[id];
		exampleTags.append(tag);
	}
	renderExampleText(exampleDescription, example.description ?? '');
	const references = requireElement<HTMLElement>('[data-example-references]');
	references.hidden = !example.references?.length;
	renderExampleText(references, (example.references ?? []).flatMap((reference, index) => [
		(index ? ' · ' : '') + reference.relation + ' ', { text: reference.label, href: reference.href },
	]));
	exampleDescription.hidden = !example.description;
	document.title = example.title + ' · ZenFG Examples';
	requireElement<HTMLElement>('[data-example-title]').textContent = example.title;
	const hasSidebar = !!example.hasControls || example.readyState === 'live';
	controlsPanel.hidden = !hasSidebar;
	metricsHost.hidden = example.readyState !== 'live';
	controlsHost.hidden = !example.hasControls;
} else {
	exampleError.hidden = false;
	effectStatus.hidden = true;
	controlsHost.hidden = true;
	workbench.hidden = true;
	requireElement<HTMLElement>('[data-demo-card]').hidden = true;
	for (const button of panelButtons) button.disabled = true;
}
for (const button of panelButtons) {
	button.addEventListener('click', () => setPanel(parseButtonPanel(button.dataset.panelButton)));
	button.addEventListener('keydown', (event) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const index = event.key === 'Home' ? 0 : event.key === 'End' ? panelButtons.length - 1
			: (panelButtons.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + panelButtons.length) % panelButtons.length;
		const next = panelButtons[index]!;
		setPanel(parseButtonPanel(next.dataset.panelButton));
		next.focus();
	});
}
document.addEventListener('keydown', (event) => {
	if (event.defaultPrevented || !maximized) return;
	if (event.key === 'Escape') { event.preventDefault(); setMaximized(false); }
	if (event.key === 'Tab') {
		const focusable = [...workbench.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]')]
			.filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
		const first = focusable[0];
		const last = focusable.at(-1);
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
	}
});

// Constrain the host, leaving Tweakpane's own folding and intrinsic height intact.
const demoStage = requireElement<HTMLElement>('.demo-stage');
function syncControlsHeight(): void {
	if (disposed || controlsPanel.hidden) return;
	const height = demoStage.getBoundingClientRect().height;
	if (height > 0) controlsPanel.style.setProperty('--canvas-height', `${height}px`);
}
const controlsResizeObserver = example && !controlsPanel.hidden ? new ResizeObserver(syncControlsHeight) : undefined;
controlsResizeObserver?.observe(demoStage, { box: 'border-box' });
syncControlsHeight();

let runtimePromise: Promise<PlaygroundRuntime | undefined> = Promise.resolve(undefined);
if (example) {
	runtimePromise = mountExample(example);
}
setPanel(currentPanel, false);

installAppPageLifecycle(window, {
	onDiscard: () => {
		disposed = true;
		window.clearInterval(statusTimer);
		controlsResizeObserver?.disconnect();
		document.removeEventListener('visibilitychange', onVisibilityChange);
		window.removeEventListener('pagehide', onPageHide);
		mountAbort.abort();
		exampleDirectory.destroy();
		narrowViewport.removeEventListener('change', onViewportChange);
		sourceView?.destroy();
		unsubscribeTheme();
		inspector?.destroy();
		runtime?.dispose();
		frameRateMonitor?.dispose();
		controlsHost.replaceChildren();
		void disposeHighlighter();
	},
	onRestore: () => { onVisibilityChange(); syncControlsHeight(); },
	reloadOnRestore: import.meta.hot ? () => {
		window.location.reload();
	} : undefined,
});

async function mountExample(definition: PlaygroundExampleDefinition): Promise<PlaygroundRuntime | undefined> {
	setEffectStatus('loading', 'Initializing WebGPU…');
	let reportedError = false;
	try {
		if (definition.readyState === 'live') {
			const { createFrameRateMonitor } = await import('./frameRateMonitor.ts');
			if (disposed) return undefined;
			frameRateMonitor = createFrameRateMonitor(metricsHost);
		}
		const mounted = await definition.mount({
			signal: mountAbort.signal,
			onFrame: () => { if (!disposed) runtimeStatus.frame(performance.now()); },
			onPaused: (paused) => { if (!disposed) runtimeStatus.pause(paused); },
			onLoading: (message) => { if (!disposed) setEffectStatus('loading', message); },
			canvas: effectCanvas,
			controlsHost,
			onReady: message => {
				setEffectStatus('ready');
				if (!disposed && definition.readyState === 'ready') {
					runtimeStatus.output(message);
				}
			},
			onWarning: message => { if (!disposed) runtimeStatus.warn(message); },
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
	if (!example) return;
	currentPanel = panel;
	playground.dataset.panel = panel;
	codeWorkspace.hidden = panel !== 'code';
	inspectorWorkspace.hidden = panel !== 'inspector';

	for (const button of panelButtons) {
		const selected = button.dataset.panelButton === panel;
		button.setAttribute('aria-selected', String(selected));
		button.tabIndex = selected ? 0 : -1;
	}

	if (panel === 'code') {
		void ensureCodeWorkspace();
	}
	else if (panel === 'inspector') {
		void ensureInspectorWorkspace();
	}

	exampleDirectory.setPanel(panel);
	if (syncUrl) {
		const url = `${window.location.pathname}${routeSearch({
			exampleId: example.id,
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
	if (disposed) return;
	if (!mounted) {
		inspectorLoading.textContent = 'Live capture is unavailable because WebGPU could not start. The source remains available in Code.';
		return;
	}

	inspectorLoading.textContent = 'Loading FrameGraph Inspector…';
	try {
		const { mountFrameGraphInspector } = await import('@zenfg/inspector');
		if (disposed) return;
		inspector = mountFrameGraphInspector(inspectorHost, {
			theme: inspectorThemes[getTheme()],
			branding: false,
			captureSnapshot: () => mounted.captureSnapshot(),
		});
		inspectorLoading.hidden = true;
	}
	catch (error) {
		inspectorLoading.textContent = `Could not load the Inspector: ${toError(error).message}`;
	}
}

function setEffectStatus(state: ExampleStatus, message?: string): void {
	if (disposed) return;
	runtimeStatus.update(state, message);
}

function parseButtonPanel(value: string | undefined): PlaygroundPanel {
	return value === 'code' ? 'code' : 'inspector';
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
