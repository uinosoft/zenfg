import type { FrameGraphDebugNode, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { createPanelIcon } from './panelIcons.ts';
import { formatEstimatedBytes, formatEstimateCoverage, formatTimingCoverage, type WorkbenchCallbacks } from './panelWorkbenchHelpers.ts';
import { appendTimingCells, createTimingIdentity, nodeTimingDuration, PassTimingSourceState, renderTimingHeader, timingDomain, type PassTimingSource } from './panelPassTiming.ts';

type TimingMode = PassTimingSource;
type Fact = readonly [label: string, value: string, detail?: string];
const NODE_KINDS = ['render', 'compute', 'copy', 'clear-buffer', 'command', 'external-submission'] as const;
const KIND_LABELS = { render: 'Render', compute: 'Compute', copy: 'Copy', 'clear-buffer': 'Clear', command: 'Command', 'external-submission': 'External' };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = `zenfg-inspector-overview-${name}`;
  if (text !== undefined) result.textContent = text;
  return result;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function unavailableTiming(reason: string, eligible: number): string {
  if (eligible === 0) return 'Not applicable';
  return reason === 'not-requested' || reason === 'not-collected' ? 'Not collected' : 'Unavailable';
}

function facts(rows: readonly Fact[]): HTMLDListElement {
  const list = element('dl', 'facts');
  for (const [label, value, detail] of rows) {
    const row = document.createElement('div');
    const description = document.createElement('dd');
    if (detail) description.append(element('span', 'fact-value', value), document.createTextNode(' '), element('span', 'fact-detail', detail));
    else description.textContent = value;
    description.title = detail ? `${value} · ${detail}` : value;
    const term = document.createElement('dt');
    term.textContent = label;
    row.append(term, description);
    list.append(row);
  }
  return list;
}

/** A snapshot summary; the workbench owns selection, navigation and lazy rendering. */
export class OverviewView {
  readonly root = document.createElement('div');
  private readonly captureDetails = this.createDisclosure('Capture information', 'zenfg-inspector-capture-details');
  private readonly snapshotDetails = this.createDisclosure('Additional snapshot details', 'zenfg-inspector-snapshot-details');
  private readonly timingContent = element('div', 'timing-content');
  private readonly gpuButton = this.createTimingButton('gpu');
  private readonly cpuButton = this.createTimingButton('cpu');
  private snapshot: FrameGraphDebugViewModel | undefined;
  private get timingMode(): TimingMode { return this.timingSource.source; }

  constructor(private readonly callbacks: WorkbenchCallbacks, private readonly timingSource = new PassTimingSourceState()) {
    this.root.className = 'zenfg-inspector-capture-summary';
  }

  setSnapshot(snapshot: FrameGraphDebugViewModel): void {
    const active = this.root.ownerDocument.activeElement as HTMLElement | null;
    const focusKey = active && this.root.contains(active) ? active.dataset.overviewFocus : undefined;
    this.snapshot = snapshot;
    this.timingSource.initialize(snapshot);
    const context = element('div', 'context');
    const identity = element('div', 'identity');
    const runtime = snapshot.protocol.producer.runtime;
    identity.append(element('strong', 'frame', `Frame ${snapshot.frameIndex}`));
    const runtimeLabel = [runtime?.graphicsApi, runtime?.backend].filter(Boolean).join(' · ');
    if (runtimeLabel) identity.append(element('span', 'runtime', runtimeLabel));
    const source = element('span', 'source', snapshot.source.label);
    source.title = snapshot.source.label;
    identity.append(source);
    context.append(identity, this.createDiagnostics(snapshot));

    const kpis = element('div', 'kpis');
    const metrics = snapshot.metrics;
    const gpuAvailable = snapshot.profiling.status === 'available';
    const cpuAvailable = snapshot.cpuProfiling.status === 'available';
    const allocationAvailable = snapshot.protocol.memory.allocationReport.status === 'available';
    const gpuNote = gpuAvailable && metrics.timedNodeCount < metrics.timingEligibleNodeCount ? 'Pass timing partial' : '';
    const cpuNote = cpuAvailable && metrics.cpuTimedNodeCount < snapshot.nodes.length ? 'Pass timing partial' : '';
    const memory = allocationAvailable ? formatEstimateCoverage(metrics.physicalEstimatedBytes, metrics.estimatedCoverage.physical) : 'Unavailable';
    const kindSummary = NODE_KINDS.flatMap(kind => {
      const count = snapshot.nodes.filter(node => node.kind === kind).length;
      return count ? [`${count} ${KIND_LABELS[kind].toLowerCase()}`] : [];
    }).join(' · ');
    const passesKpi = this.createKpi('passes', 'Retained passes', String(snapshot.nodes.length), kindSummary || 'No retained passes', undefined,
      'Passes kept by compilation. Resource declaration vertices are not passes.');
    if (snapshot.culledNodes.length) {
      passesKpi.querySelector('.zenfg-inspector-overview-note')!.append(document.createTextNode(' · '),
        this.link(`${snapshot.culledNodes.length} Culled`, () => this.callbacks.onNavigate?.('passes', 'culled'), false, 'culled'));
    }
    kpis.append(
      this.createKpi('gpu', 'GPU span', gpuAvailable ? (snapshot.profiling.gpuFrameDurationMicros / 1000).toFixed(3) : unavailableTiming(snapshot.profiling.reason, metrics.timingEligibleNodeCount), gpuNote, gpuAvailable ? 'ms' : undefined,
        'Span from the first measured render/compute pass to the last, including intervals between passes.'),
      this.createKpi('cpu', 'CPU execute', cpuAvailable ? (snapshot.cpuProfiling.executionDurationMicros / 1000).toFixed(3) : unavailableTiming(snapshot.cpuProfiling.reason, snapshot.nodes.length), cpuNote, cpuAvailable ? 'ms' : undefined,
        'Synchronous execution elapsed time, including preparation and submission. Excludes recording, compilation and GPU completion.'),
      this.createKpi('memory', 'Physical allocation estimate', memory.split(' · ')[0]!, allocationAvailable && metrics.physicalEstimatedBytes === undefined
        ? `${metrics.estimatedCoverage.physical.known}/${metrics.estimatedCoverage.physical.total} sizes known` : '',
        undefined, 'Estimated physical transient allocations, counting each shared allocation once; excludes imported and surface resources.'),
      passesKpi,
    );
    const summary = element('section', 'summary');
    summary.setAttribute('aria-label', 'Frame overview');
    summary.append(context, kpis);

    const columns = element('div', 'columns');
    const timingPanel = element('section', 'panel');
    timingPanel.classList.add('zenfg-inspector-overview-timing-panel');
    const heading = element('header', 'heading');
    const timingSwitch = element('div', 'timing-switch');
    timingSwitch.classList.add('zenfg-inspector-timing-switch');
    timingSwitch.setAttribute('role', 'group');
    timingSwitch.setAttribute('aria-label', 'Pass timing source');
    timingSwitch.append(this.gpuButton, this.cpuButton);
    heading.append(element('h2', 'title', 'Pass timings'), timingSwitch,
      this.link('View all passes', () => this.callbacks.onNavigate?.('passes', 'all')));
    this.renderTimings();
    timingPanel.append(heading, this.timingContent);
    const side = element('aside', 'side');
    side.append(this.createResources(snapshot));
    columns.append(timingPanel, side);
    this.updateDetails(snapshot);
    this.root.replaceChildren(summary, columns, this.captureDetails, this.snapshotDetails);
    if (focusKey) {
      const target = [...this.root.querySelectorAll<HTMLElement>('[data-overview-focus]')]
        .find(control => control.dataset.overviewFocus === focusKey);
      (target ?? (this.timingMode === 'gpu' ? this.gpuButton : this.cpuButton)).focus({ preventScroll: true });
    }
  }

  private createKpi(metric: string, label: string, value: string, note: string, unit?: string, description?: string): HTMLElement {
    const kpi = element('div', 'kpi');
    kpi.dataset.metric = metric;
    const number = element('strong', 'value');
    // Byte formatters supply the value and unit together; separate them visually.
    const byteParts = value.match(/^([\d.]+) (B|KiB|MiB)$/);
    number.append(document.createTextNode(byteParts?.[1] ?? value));
    const valueUnit = unit ?? byteParts?.[2];
    if (valueUnit) number.append(document.createTextNode(' '), element('span', 'unit', valueUnit));
    if (['Unknown', 'Unavailable', 'Not collected', 'Not applicable'].includes(value)) number.dataset.state = 'unknown';
    if (description) kpi.title = description;
    kpi.append(element('span', 'label', label), number);
    if (note) kpi.append(element('p', 'note', note));
    return kpi;
  }

  private createDiagnostics(snapshot: FrameGraphDebugViewModel): HTMLElement {
    const container = element('div', 'diagnostics');
    const counts = { error: 0, warning: 0, info: 0 };
    for (const diagnostic of snapshot.protocol.diagnostics) counts[diagnostic.severity]++;
    container.dataset.tone = counts.error ? 'error' : counts.warning ? 'warning' : 'neutral';
    const parts = [counts.error ? countLabel(counts.error, 'error') : '', counts.warning ? countLabel(counts.warning, 'warning') : '', counts.info ? `${counts.info} info` : ''].filter(Boolean);
    if (counts.error || counts.warning) container.append(createPanelIcon('error'));
    container.append(element('span', 'diagnostic-counts', parts.length ? `${parts.join(' · ')} recorded` : 'No recorded diagnostics'),
      this.link('View diagnostics', () => this.callbacks.onNavigate?.('diagnostics'), false));
    return container;
  }

  private createTimingButton(mode: TimingMode): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = mode.toUpperCase();
    button.dataset.source = mode;
    button.dataset.overviewFocus = `timing:${mode}`;
    button.addEventListener('click', () => {
      this.timingSource.choose(mode);
      this.renderTimings();
    });
    return button;
  }

  private renderTimings(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    this.gpuButton.setAttribute('aria-pressed', String(this.timingMode === 'gpu'));
    this.cpuButton.setAttribute('aria-pressed', String(this.timingMode === 'cpu'));
    const gpu = this.timingMode === 'gpu';
    const duration = (node: FrameGraphDebugNode): number | undefined => nodeTimingDuration(node, this.timingMode);
    const measured = snapshot.nodes.filter(node => (!gpu || node.kind === 'render' || node.kind === 'compute') && duration(node) !== undefined);
    const eligible = gpu ? snapshot.metrics.timingEligibleNodeCount : snapshot.nodes.length;
    const domain = timingDomain(snapshot.nodes, this.timingMode);
    const total = domain.total;
    const sorted = [...measured].sort((a, b) => duration(b)! - duration(a)! || a.order - b.order || a.id.localeCompare(b.id));
    const ranked = sorted.slice(0, 5);
    const modeLabel = this.timingMode.toUpperCase();
    const timing = gpu ? snapshot.protocol.timings.gpu : snapshot.cpuProfiling;
    const coverage = element('p', 'coverage', measured.length
      ? `${modeLabel} pass sum ${(total / 1000).toFixed(3)} ms · ${measured.length < eligible ? 'Partial · ' : ''}${measured.length}/${eligible} timed`
      : `${modeLabel} pass timing: ${timing.status === 'unavailable' ? unavailableTiming(timing.reason, eligible) : eligible === 0 ? 'Not applicable' : 'Not collected'} · ${eligible === 0 ? 'no eligible passes' : `0/${eligible} measured`}`);
    if (timing.status === 'unavailable') coverage.title = timing.reason;
    const table = element('table', 'timings');
    table.setAttribute('aria-label', `${modeLabel} pass timing ranking`);
    renderTimingHeader(table, this.timingMode, domain, { order: false, sort: 'descending' });
    table.querySelector('[data-timing-column="plot"]')?.classList.add('zenfg-inspector-overview-timing-axis');
    table.querySelector('.zenfg-inspector-timing-axis')?.classList.add('zenfg-inspector-overview-axis');
    const body = element('tbody', 'timing-rows');
    for (const node of ranked) {
      const row = document.createElement('tr');
      row.dataset.nodeId = node.id;
      const nameCell = document.createElement('td');
      nameCell.dataset.timingColumn = 'name';
      const identity = createTimingIdentity(node, {
        onSelect: () => this.callbacks.onReveal?.({ kind: 'node', id: node.id }, 'passes'), focusKey: `node:${node.id}`,
        nameClass: 'zenfg-inspector-overview-pass', prefixClass: 'zenfg-inspector-overview-pass-prefix',
        suffixClass: 'zenfg-inspector-overview-pass-suffix', kindClass: 'zenfg-inspector-overview-kind',
      });
      identity.classList.add('zenfg-inspector-overview-pass-identity'); nameCell.append(identity); row.append(nameCell);
      appendTimingCells(row, node, this.timingMode, domain, { plotClass: 'zenfg-inspector-overview-plot', barClass: 'zenfg-inspector-overview-bar', durationClass: 'zenfg-inspector-overview-duration', shareClass: 'zenfg-inspector-overview-percentage' });
      body.append(row);
    }
    if (!ranked.length) {
      const row = document.createElement('tr');
      const empty = element('td', 'timing-empty', eligible === 0 ? `No eligible ${modeLabel} passes.` : `No per-pass ${modeLabel} measurements for this capture.`);
      if (timing.status === 'unavailable') empty.title = timing.reason;
      empty.colSpan = 4; row.append(empty); body.append(row);
    }
    table.append(body);
    this.timingContent.replaceChildren(coverage, table);
    if (ranked.length && sorted.length > ranked.length) {
      const topTotal = ranked.reduce((sum, node) => sum + duration(node)!, 0);
      const remaining = sorted.slice(ranked.length);
      const otherTotal = remaining.reduce((sum, node) => sum + duration(node)!, 0);
      const summary = element('div', 'timing-summary');
      const totals = element('div', 'timing-totals');
      for (const [part, label, value] of [
        ['top', `Top ${ranked.length}`, topTotal],
        ['other', `Other ${remaining.length}`, otherTotal],
      ] as const) {
        const item = document.createElement('span');
        item.dataset.part = part;
        const number = document.createElement('strong');
        number.textContent = `${(value / 1000).toFixed(3)} ms · ${total > 0 ? `${(value / total * 100).toFixed(1)}%` : '—'}`;
        item.append(document.createTextNode(`${label} `), number);
        totals.append(item);
      }
      summary.append(totals);
      if (total > 0) {
        const composition = element('div', 'timing-composition');
        composition.setAttribute('role', 'img');
        composition.setAttribute('aria-label', `Top ${ranked.length}: ${(topTotal / total * 100).toFixed(1)}% of measured pass sum; other ${remaining.length} measured passes: ${(otherTotal / total * 100).toFixed(1)}%`);
        composition.style.setProperty('--top-share', `${topTotal / total * 100}%`);
        composition.append(document.createElement('span'), document.createElement('span'));
        summary.append(composition);
      }
      this.timingContent.append(summary);
    }
    if (ranked.length) {
      const scope = element('p', 'note', 'Share of measured pass sum; not total frame time.');
      scope.classList.add('zenfg-inspector-overview-scope-note');
      this.timingContent.append(scope);
    }
    const externalCount = snapshot.nodes.filter(node => node.kind === 'external-submission').length;
    if (gpu && externalCount > 0) {
      const hint = element('p', 'external');
      hint.append(createPanelIcon('external'), document.createTextNode(`${countLabel(externalCount, 'external submission')} ${externalCount === 1 ? 'is' : 'are'} outside per-pass GPU timing`));
      this.timingContent.append(hint);
    }
  }

  private createResources(snapshot: FrameGraphDebugViewModel): HTMLElement {
    const panel = element('section', 'panel');
    panel.classList.add('zenfg-inspector-overview-resources');
    const heading = element('header', 'heading');
    heading.append(element('h2', 'title', 'Resources & memory'));
    const allocationAvailable = snapshot.protocol.memory.allocationReport.status === 'available';
    const body = element('div', 'resource-body');
    const allocations = element('section', 'allocations');
    const textures = snapshot.resources.filter(resource => resource.kind === 'texture').length;
    const buffers = snapshot.resources.filter(resource => resource.kind === 'buffer').length;
    allocations.append(facts([
      ['Logical resources', String(snapshot.resources.length), `${countLabel(textures, 'texture')} · ${countLabel(buffers, 'buffer')}`],
      ...(allocationAvailable ? [
        ['Physical allocations', String(snapshot.physicalAllocations.length)],
        ['Alias savings estimate', formatEstimatedBytes(snapshot.metrics.aliasReuseBytes), snapshot.metrics.aliasReuseBytes === undefined ? `${snapshot.metrics.estimatedCoverage.alias.known}/${snapshot.metrics.estimatedCoverage.alias.total} shared allocation sizes known` : undefined],
      ] as const : []),
    ]));
    if (!allocationAvailable) allocations.append(this.createReportState('Allocation report unavailable', snapshot.protocol.memory.allocationReport.reason));
    const poolSection = element('section', 'pool');
    poolSection.append(element('h3', 'subtitle', 'Resource pool'));
    const pool = snapshot.resourcePool;
    if (pool.status === 'available') {
      poolSection.append(facts([
        ['Cumulative reuse', pool.acquireCount > 0 ? `${(pool.reuseCount / pool.acquireCount * 100).toFixed(1)}%` : 'Not applicable · no acquisitions'],
        ['Idle retained estimate', formatEstimatedBytes(pool.estimatedRetainedBytes), countLabel(pool.retainedCount, 'allocation')],
      ]));
    } else poolSection.append(this.createReportState('Pool report unavailable', pool.reason));
    const footer = document.createElement('footer');
    footer.append(this.link('View resources', () => this.callbacks.onNavigate?.('resources')),
      this.link('View memory', () => this.callbacks.onNavigate?.('memory')));
    body.append(allocations, poolSection);
    panel.append(heading, body, footer);
    return panel;
  }

  private createReportState(label: string, reason: string): HTMLElement {
    const state = element('p', 'report-state', label);
    state.title = reason;
    return state;
  }

  private createDisclosure(label: string, className: string): HTMLDetailsElement {
    const details = element('details', 'details');
    details.classList.add(className);
    const summary = document.createElement('summary');
    summary.dataset.overviewFocus = `details:${className}`;
    summary.append(createPanelIcon('chevron-right'), document.createTextNode(label));
    details.append(summary);
    return details;
  }

  private updateDetails(snapshot: FrameGraphDebugViewModel): void {
    const protocol = snapshot.protocol;
    const runtime = protocol.producer.runtime;
    const replaceFacts = (details: HTMLDetailsElement, rows: readonly Fact[]): void => {
      details.querySelector('dl')?.remove();
      details.append(facts(rows));
    };
    replaceFacts(this.captureDetails, [
      ['Source', snapshot.source.label], ['Frame', String(snapshot.frameIndex)],
      ['Captured at', protocol.capture.capturedAt ?? 'Unknown'],
      ['Schema', `${protocol.format} v${protocol.version.major}.${protocol.version.minor}`],
      ['Producer', [protocol.producer.name, protocol.producer.version, protocol.producer.language].filter(Boolean).join(' · ')],
      ['Runtime', [runtime?.implementation, runtime?.graphicsApi, runtime?.backend].filter(Boolean).join(' · ') || 'Unknown'],
      ...(protocol.capture.migration ? [['Migration', `${protocol.capture.migration.sourceFormat} → canonical v${protocol.version.major}.${protocol.version.minor}`] as const] : []),
    ]);
    replaceFacts(this.snapshotDetails, [
      ['Texture views', snapshot.availability.textureViews ? String(snapshot.textureViewById.size) : 'Unknown'],
      ['Groups', snapshot.availability.groups ? String(snapshot.debugGroups.length) : 'Unknown'],
      ['Frame-graph segments', String(snapshot.executionSegments.filter(segment => segment.kind === 'frame-graph').length)],
      ['External boundaries', String(snapshot.executionSegments.filter(segment => segment.kind === 'external-submission').length)],
      ['Recording order', snapshot.availability.recordingOrder ? 'Available' : 'Unknown'],
      ['Access regions', snapshot.availability.accessRegions ? 'Available' : 'Unknown'],
      ['Logical transient estimate', formatEstimateCoverage(snapshot.metrics.transientEstimatedByteSize, snapshot.metrics.estimatedCoverage.transient)],
      ['GPU timing', protocol.timings.gpu.status === 'available' ? formatTimingCoverage(snapshot.metrics.timedNodeCount, snapshot.metrics.timingEligibleNodeCount) : protocol.timings.gpu.reason],
      ['CPU timing', protocol.timings.cpu.status === 'available' ? formatTimingCoverage(snapshot.metrics.cpuTimedNodeCount, snapshot.nodes.length) : protocol.timings.cpu.reason],
      ...(protocol.memory.allocationReport.status === 'unavailable' ? [['Allocation report', protocol.memory.allocationReport.reason] as const] : []),
      ...(protocol.memory.poolReport.status === 'unavailable' ? [['Pool report', protocol.memory.poolReport.reason] as const] : []),
    ]);
  }

  private link(label: string, onClick: () => void, arrow = true, focusKey = label): HTMLButtonElement {
    const button = element('button', 'link');
    button.type = 'button';
    button.dataset.overviewFocus = `navigate:${focusKey}`;
    button.append(document.createTextNode(label));
    if (arrow) button.append(createPanelIcon('chevron-right'));
    button.addEventListener('click', onClick);
    return button;
  }
}
