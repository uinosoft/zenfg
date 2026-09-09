import { applyVisualTheme, visualThemes, type ThemeMode } from '../../../shared/theme/index.ts';
import { graphMarkup, sceneMarkup, describeNode } from './graph.ts';
import { installAppPageLifecycle } from '../../../shared/pageLifecycle.ts';

const root = document.querySelector<HTMLElement>('#visual-lab')!;
applyVisualTheme(root, 'dark');
const themeIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M10 4a6 6 0 0 1 0 12Z" fill="currentColor"/></svg>';
const mark = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 7h18L5 21h18"/><path d="M5 14h18" opacity=".4"/></svg>';
root.innerHTML = `
<a class="skip-link" href="#main-content">Skip to content</a>
<header class="lab-header">
  <a class="brand" href="#main-content">${mark}<strong>ZenFG</strong><span class="brand-divider">/</span><span>Examples</span></a>
  <div class="header-actions"><span class="lab-badge">VISUAL LAB <span>01</span></span><div class="theme-switch" role="group" aria-label="Color theme"><button data-theme-choice="dark" aria-pressed="true">${themeIcon}Dark</button><button data-theme-choice="light" aria-pressed="false">Light</button></div></div>
</header>
<div class="lab-layout">
<aside class="sidebar" aria-label="Example navigation">
  <button class="directory-toggle" aria-expanded="false" aria-controls="directory">Browse examples <span>⌄</span></button>
  <nav id="directory" aria-label="Visual sample directory">
    <div class="nav-caption">SAMPLE DIRECTORY <span>16</span></div>
    <details open><summary>Showcases <span>08</span></summary><div class="nav-items">
      <a href="#example" aria-current="page"><span class="nav-glyph">▧</span>Reference Renderer<span class="active-dot"></span></a>
      <span class="nav-reference"><span class="nav-glyph">◈</span>Interactive Background</span>
      <span class="nav-reference"><span class="nav-glyph">⌁</span>Slime Mold</span>
      <span class="nav-reference"><span class="nav-glyph">⠿</span>Particles4All</span>
      <span class="nav-reference"><span class="nav-glyph">△</span>Three.js Interop</span>
      <span class="nav-reference"><span class="nav-glyph">◇</span>Babylon.js Interop</span>
      <span class="nav-reference"><span class="nav-glyph">◇</span>Babylon Lite Interop</span>
      <span class="nav-reference"><span class="nav-glyph">◉</span>Monocular Light</span>
    </div></details>
    <details><summary>WebGPU basics <span>08</span></summary><div class="nav-items">${[
	['minimal-frame', 'Minimal Frame'], ['transient-to-present', 'Transient to Present'], ['imported-resource', 'Imported Resource'], ['persistent-state', 'Persistent State'], ['external-submission', 'External Submission'], ['snapshot-export', 'Snapshot Export'], ['gpu-timing', 'GPU Timing'], ['compute-output', 'Compute Output'],
].map(([, title]) => `<span class="nav-reference">${title}</span>`).join('')}</div></details>
    <div class="nav-caption foundations-caption">DESIGN FOUNDATIONS</div><div class="nav-items"><a href="#foundations"><span class="nav-glyph">◐</span>Palette & surfaces</a><a href="#components"><span class="nav-glyph">⊞</span>Components & states</a></div>
    <div class="sidebar-note"><span class="tiny-rule"></span><strong>One system. Two moods.</strong><p>Storm & Light<br>Shared structure, thoughtful contrast.</p></div>
  </nav>
</aside>
<main id="main-content" tabindex="-1">
  <section id="example" class="example-section">
    <div class="breadcrumb">Examples <span>/</span> Showcases <span>/</span> <span>Reference Renderer</span></div>
    <div class="section-heading"><h1>Reference Renderer<span class="sample-label">Visual sample</span></h1><a class="button secondary view-graph" href="#workbench">View FrameGraph <span>↓</span></a></div>
    <div class="example-description"><p class="lead">GPU culling and indirect drawing.</p><div class="example-meta"><span><i class="status-dot"></i>WebGPU</span><span>3 primitive batches</span></div></div>
    <div class="demo-card"><div class="demo-stage">${sceneMarkup()}<div class="scene-topline"><span><i class="status-dot"></i>SCENE PREVIEW</span><span>Fixed illustration</span></div><div class="scene-bottomline"><span>01 / Reference scene</span><span>WebGPU runtime is not active</span></div></div><div class="parameters"><div class="panel-caption">Parameters <span>LOCAL SAMPLE</span></div><div id="parameter-pane"></div><p class="parameter-note">Explore the controls. Values are local to this visual sample.</p><output id="parameter-summary" aria-live="polite">2,048 instances · Culling on</output></div></div>
  </section>
  <section id="workbench" class="workbench" aria-label="Example tools">
    <div class="workbench-bar"><div role="tablist" aria-label="Example tools"><button id="inspector-tab" role="tab" aria-selected="true" aria-controls="inspector-panel" data-tab="inspector">${mark}Inspector</button><button id="code-tab" role="tab" aria-selected="false" aria-controls="code-panel" tabindex="-1" data-tab="code"><span class="code-icon" aria-hidden="true">‹/›</span>Code</button></div><span class="workbench-caption">A WINDOW INTO THE FRAME</span></div>
    <div id="inspector-panel" role="tabpanel" aria-labelledby="inspector-tab"><div class="graph-toolbar"><span><strong>FrameGraph</strong><span class="subtle">Illustrative pipeline</span></span><span class="graph-count">4 nodes <span>·</span> 3 dependencies</span></div><div class="graph-scroll">${graphMarkup()}</div><div class="graph-footer"><div class="legend">${['compute', 'render', 'declaration', 'output'].map(kind => `<span><i style="--legend-color:var(--zenfg-${kind})"></i>${kind[0].toUpperCase() + kind.slice(1)}</span>`).join('')}</div><span>Tab to focus · Enter to select</span></div><div class="selection-bar" aria-live="polite"><span class="selection-icon">▧</span><strong id="selected-name">Draw geometry</strong><span id="selected-detail">Render pass</span><span class="selected-badge">Selected</span></div><p class="graph-note">Compute finds visible instances; Render consumes the result. This sample graph illustrates the connection.</p></div>
    <div id="code-panel" role="tabpanel" aria-labelledby="code-tab" hidden><div class="graph-toolbar code-toolbar"><span><strong>minimal-frame.ts</strong><span class="subtle">Original ZenFG recipe · separate code sample</span></span><button id="copy-code" class="button compact" disabled>Copy source</button></div><div id="source-code" class="source-code" tabindex="0" aria-label="Minimal frame TypeScript source"><p>Loading source highlighting…</p></div><p id="code-status" class="code-status" role="status"></p></div>
  </section>
  <section id="foundations" class="foundations"><div class="section-heading foundation-heading"><div><div class="eyebrow">THE VISUAL LANGUAGE</div><h2>Quiet surfaces. Clear signals.</h2></div><span id="palette-name" class="palette-name">01 / STORM</span></div><p class="foundation-intro">The same hierarchy, from an example page to the smallest graph label.<br><span lang="zh-CN">统一层次，清晰表达。让内容和图结构成为焦点。</span></p><div id="palette" class="palette"></div><div class="surface-strip"><div class="surface-example canvas-surface"><span>01</span><strong>Workspace</strong><small>Room for the content</small></div><div class="surface-example sidebar-surface"><span>02</span><strong>Navigation</strong><small>A quieter supporting layer</small></div><div class="surface-example panel-surface"><span>03</span><strong>Raised surface</strong><small>Tools within reach</small></div></div></section>
  <section id="components" class="component-section"><div class="section-heading"><div><div class="eyebrow">DETAILS THAT CONNECT</div><h2>Components & states</h2></div><span class="subtle">Built for reading and doing</span></div><div class="component-grid"><article class="component-card"><h3>Actions</h3><p>Intent, emphasis, and keyboard focus.</p><div class="button-samples"><button class="button primary" data-feedback="Primary action selected">Primary action <span>↗</span></button><button class="button secondary" data-feedback="Secondary action selected">Secondary</button><button class="button" disabled>Unavailable</button></div><div class="state-samples"><span class="state-chip">Default</span><span class="state-chip hover-sample">Hover</span><span class="state-chip focus-sample">Focus</span><span class="state-chip selected-sample">Selected</span></div><output id="action-feedback" aria-live="polite">Tab through the controls to see focus.</output></article><article class="component-card"><h3>Inputs</h3><p>Readable values, with a clear active boundary.</p><label class="field-label" for="sample-name">Snapshot name</label><input id="sample-name" value="reference-frame-042" autocomplete="off"><label class="checkbox-label"><input id="sample-resources" type="checkbox" checked> Show resource declarations</label><label class="field-label" for="disabled-input">Unavailable setting</label><input id="disabled-input" value="Requires a live capture" disabled></article><article class="component-card"><h3>Status & feedback</h3><p>Color supports the message. It never replaces it.</p><div class="status-row success"><span>✓</span><strong>Ready</strong><span>All passes resolved</span></div><div class="status-row warning"><span>△</span><strong>Notice</strong><span>Timing unavailable</span></div><div class="status-row danger"><span>!</span><strong>Error</strong><span>Resource missing</span></div></article><article class="component-card"><h3>Graph semantics</h3><p>Stable meanings across both themes.</p><div class="semantic-samples">${['render', 'compute', 'copy', 'clear', 'command', 'external', 'texture', 'buffer', 'declaration', 'output'].map(kind => `<span class="semantic-chip" style="--semantic-color:var(--zenfg-${kind})">${kind[0].toUpperCase() + kind.slice(1)}</span>`).join('')}</div></article></div></section>
  <footer class="lab-footer"><span>${mark}<strong>ZenFG</strong><span>Visual foundations / 01</span></span><span>Storm & Light <span class="footer-dot">·</span> A work in clarity</span></footer>
</main></div>`;

let mode: ThemeMode = 'dark';
function setTheme(next: ThemeMode): void {
	mode = next;
	applyVisualTheme(root, mode);
	for (const button of root.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === mode));
	root.querySelector('#palette-name')!.textContent = mode === 'dark' ? '01 / STORM' : '02 / LIGHT';
	const palette = visualThemes[mode];
	// This standalone page owns its viewport chrome. The shared helper remains
	// container-only so future embedded inspectors never change their host page.
	document.documentElement.style.colorScheme = mode;
	document.documentElement.style.setProperty('--lab-scroll-thumb', palette.group);
	document.documentElement.style.setProperty('--lab-scroll-hover', palette.accent);
	document.documentElement.style.setProperty('--lab-scroll-track', palette.sidebar);
	root.querySelector('#palette')!.innerHTML = (['canvas', 'sidebar', 'panel', 'accent', 'purple', 'cyan'] as const).map(key => `<div class="swatch"><div style="background:${palette[key]}"></div><strong>${key}</strong><code>${palette[key]}</code></div>`).join('');
}
for (const button of root.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) button.addEventListener('click', () => setTheme(button.dataset.themeChoice as ThemeMode));
setTheme('dark');

const directoryToggle = root.querySelector<HTMLButtonElement>('.directory-toggle')!;
directoryToggle.addEventListener('click', () => directoryToggle.setAttribute('aria-expanded', String(directoryToggle.getAttribute('aria-expanded') !== 'true')));
for (const link of root.querySelectorAll<HTMLAnchorElement>('#directory a[href^="#"]')) link.addEventListener('click', () => directoryToggle.setAttribute('aria-expanded', 'false'));

function setTab(name: string): void {
	for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
		const active = tab.dataset.tab === name;
		tab.setAttribute('aria-selected', String(active));
		tab.tabIndex = active ? 0 : -1;
		root.querySelector<HTMLElement>(`#${tab.dataset.tab}-panel`)!.hidden = !active;
	}
}
root.querySelector('.view-graph')!.addEventListener('click', () => setTab('inspector'));
for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
	tab.addEventListener('click', () => setTab(tab.dataset.tab!));
	tab.addEventListener('keydown', (event) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const name = event.key === 'Home' ? 'inspector' : event.key === 'End' ? 'code' : tab.dataset.tab === 'code' ? 'inspector' : 'code';
		setTab(name);
		root.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)!.focus();
	});
}
for (const node of root.querySelectorAll<SVGGElement>('[data-node]')) {
	const select = (): void => {
		for (const sibling of root.querySelectorAll('[data-node]')) sibling.setAttribute('aria-pressed', String(sibling === node));
		const selected = describeNode(node.dataset.node!);
		root.querySelector('#selected-name')!.textContent = selected.name;
		root.querySelector('#selected-detail')!.textContent = selected.detail;
	};
	node.addEventListener('click', select);
	node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
}
for (const button of root.querySelectorAll<HTMLButtonElement>('[data-feedback]')) button.addEventListener('click', () => { root.querySelector('#action-feedback')!.textContent = button.dataset.feedback!; });

// Real controls and highlighter load independently; a failure leaves the sample usable.
let disposed = false;
let disposeParameters: (() => void) | undefined;
void import('./parameters.ts').then(({ mountParameters }) => { if (!disposed) disposeParameters = mountParameters(root); }).catch(() => { if (!disposed) root.querySelector('#parameter-pane')!.textContent = 'Parameter controls could not load. Reload to retry.'; });
void import('./source.ts').then(({ mountSource }) => { if (!disposed) return mountSource(root); }).catch(() => { if (!disposed) root.querySelector('#source-code')!.textContent = 'Source could not load. Reload to retry.'; });

const cleanup = (): void => { disposed = true; disposeParameters?.(); };
const removeLifecycle = installAppPageLifecycle(window, { onDiscard: cleanup });
if (import.meta.hot) import.meta.hot.dispose(() => { removeLifecycle(); cleanup(); root.replaceChildren(); });
