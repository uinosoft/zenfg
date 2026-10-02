import type { FrameGraphDebugNode, FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import { labelNode } from './panelDomHelpers.ts';
import { createPanelIcon } from './panelIcons.ts';
import { formatEstimatedBytes, formatEstimateCoverage, formatTimingCoverage, type WorkbenchCallbacks } from './panelWorkbenchHelpers.ts';

type TimingMode = 'gpu' | 'cpu';
type Fact = readonly [label: string, value: string];
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
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    const description = document.createElement('dd');
    description.textContent = value;
    description.title = value;
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
  private timingMode: TimingMode = 'gpu';
  private timingChosen = false;

  constructor(private readonly callbacks: WorkbenchCallbacks) {
    this.root.className = 'zenfg-inspector-capture-summary';
  }

  setSnapshot(snapshot: FrameGraphDebugViewModel): void {
    this.snapshot = snapshot;
    if (!this.timingChosen) {
      this.timingMode = snapshot.metrics.timedNodeCount === 0 && snapshot.metrics.cpuTimedNodeCount > 0 ? 'cpu' : 'gpu';
    }
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
    const gpuNote = gpuAvailable
      ? `${metrics.timedNodeCount}/${metrics.timingEligibleNodeCount} render + compute measured${metrics.timedNodeCount < metrics.timingEligibleNodeCount ? ' · Partial' : ''}`
      : unavailableTiming(snapshot.profiling.reason, metrics.timingEligibleNodeCount);
    const cpuNote = cpuAvailable ? `${metrics.cpuTimedNodeCount}/${snapshot.nodes.length} passes measured${metrics.cpuTimedNodeCount < snapshot.nodes.length ? ' · Partial' : ''}`
      : unavailableTiming(snapshot.cpuProfiling.reason, snapshot.nodes.length);
    const memory = allocationAvailable ? formatEstimateCoverage(metrics.physicalEstimatedBytes, metrics.estimatedCoverage.physical) : 'Unavailable';
    const kindSummary = NODE_KINDS.flatMap(kind => {
      const count = snapshot.nodes.filter(node => node.kind === kind).length;
      return count ? [`${count} ${KIND_LABELS[kind].toLowerCase()}`] : [];
    }).join(' · ');
    kpis.append(
      this.createKpi('gpu', 'GPU span', gpuAvailable ? (snapshot.profiling.gpuFrameDurationMicros / 1000).toFixed(3) : '—', gpuNote, gpuAvailable ? 'ms' : undefined,
        'Span from the first measured render/compute pass to the last, including intervals between passes.'),
      this.createKpi('cpu', 'CPU execute', cpuAvailable ? (snapshot.cpuProfiling.executionDurationMicros / 1000).toFixed(3) : '—', cpuNote, cpuAvailable ? 'ms' : undefined,
        'Synchronous execution elapsed time, including preparation and submission. Excludes recording, compilation and GPU completion.'),
      this.createKpi('memory', 'Physical allocation estimate', memory.split(' · ')[0]!, allocationAvailable
        ? metrics.physicalEstimatedBytes === undefined ? `${metrics.estimatedCoverage.physical.known}/${metrics.estimatedCoverage.physical.total} sizes known`
          : `${countLabel(snapshot.physicalAllocations.length, 'allocation')} · estimated`
        : 'Allocation report unavailable', undefined, 'Estimated physical transient allocations, counting each shared allocation once; excludes imported and surface resources.'),
      this.createKpi('passes', 'Retained passes', String(snapshot.nodes.length), `${kindSummary || 'No retained passes'} / ${snapshot.culledNodes.length} culled`, undefined,
        'Passes kept by compilation. Resource declaration vertices are not passes.'),
    );
    const summary = element('section', 'summary');
    summary.setAttribute('aria-label', 'Frame overview');
    summary.append(context, kpis);

    const columns = element('div', 'columns');
    const timingPanel = element('section', 'panel');
    const heading = element('header', 'heading');
    const timingSwitch = element('div', 'timing-switch');
    timingSwitch.setAttribute('role', 'group');
    timingSwitch.setAttribute('aria-label', 'Pass timing source');
    timingSwitch.append(this.gpuButton, this.cpuButton);
    heading.append(element('h2', 'title', 'Pass timings'), timingSwitch,
      this.link('View all passes', () => this.callbacks.onNavigate?.('passes', 'all')));
    this.renderTimings();
    timingPanel.append(heading, this.timingContent, this.createWork(snapshot));
    columns.append(timingPanel, this.createResources(snapshot));
    this.updateDetails(snapshot);
    this.root.replaceChildren(summary, columns, this.captureDetails, this.snapshotDetails);
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
    if (value === 'Unknown' || value === 'Unavailable') number.dataset.state = 'unknown';
    if (description) kpi.title = description;
    kpi.append(element('span', 'label', label), number, element('p', 'note', note));
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
    button.addEventListener('click', () => {
      this.timingChosen = true;
      this.timingMode = mode;
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
    const duration = (node: FrameGraphDebugNode): number | undefined => gpu ? node.gpuDurationMicros : node.cpuDurationMicros;
    const measured = snapshot.nodes.filter(node => (!gpu || node.kind === 'render' || node.kind === 'compute') && duration(node) !== undefined);
    const eligible = gpu ? snapshot.metrics.timingEligibleNodeCount : snapshot.nodes.length;
    const total = measured.reduce((sum, node) => sum + duration(node)!, 0);
    const modeLabel = this.timingMode.toUpperCase();
    const timing = gpu ? snapshot.protocol.timings.gpu : snapshot.cpuProfiling;
    const coverage = element('p', 'coverage', measured.length
      ? `Measured ${modeLabel} pass sum ${(total / 1000).toFixed(3)} ms · ${formatTimingCoverage(measured.length, eligible)}`
      : `${modeLabel} pass timing: ${timing.status === 'unavailable' ? unavailableTiming(timing.reason, eligible) : eligible === 0 ? 'Not applicable' : 'Not collected'} · ${eligible === 0 ? 'no eligible passes' : `0/${eligible} measured`}`);
    if (timing.status === 'unavailable') coverage.title = timing.reason;
    const table = element('table', 'timings');
    table.setAttribute('aria-label', `${modeLabel} pass timing ranking`);
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of ['Pass', 'Kind', 'Time', 'Share']) {
      const cell = document.createElement('th');
      cell.scope = 'col'; cell.textContent = label; header.append(cell);
    }
    head.append(header);
    const body = element('tbody', 'timing-rows');
    const ranked = [...measured].sort((a, b) => duration(b)! - duration(a)! || a.order - b.order || a.id.localeCompare(b.id)).slice(0, 5);
    for (const node of ranked) {
      const row = document.createElement('tr');
      row.dataset.nodeId = node.id;
      const nameCell = document.createElement('td');
      const name = element('button', 'pass', labelNode(node));
      name.type = 'button'; name.title = labelNode(node);
      name.addEventListener('click', () => this.callbacks.onReveal?.({ kind: 'node', id: node.id }, 'passes'));
      nameCell.append(name);
      const kindCell = document.createElement('td');
      const kind = element('span', 'kind', KIND_LABELS[node.kind]);
      kind.dataset.kind = node.kind; kindCell.append(kind);
      const timeCell = element('td', 'duration', `${(duration(node)! / 1000).toFixed(3)} ms`);
      const share = document.createElement('td');
      const shareContent = element('div', 'share');
      const bar = element('span', 'bar');
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      const percentage = total > 0 ? duration(node)! / total * 100 : undefined;
      fill.style.width = `${percentage ?? 0}%`; bar.append(fill);
      shareContent.append(bar, element('span', 'percentage', percentage === undefined ? '—' : `${percentage.toFixed(1)}%`));
      share.append(shareContent); row.append(nameCell, kindCell, timeCell, share); body.append(row);
    }
    if (!ranked.length) {
      const row = document.createElement('tr');
      const empty = element('td', 'timing-empty', eligible === 0 ? `No eligible ${modeLabel} passes.` : `No per-pass ${modeLabel} measurements for this capture.`);
      if (timing.status === 'unavailable') empty.title = timing.reason;
      empty.colSpan = 4; row.append(empty); body.append(row);
    }
    table.append(head, body);
    this.timingContent.replaceChildren(coverage, table, element('p', 'note', 'Share of measured pass sum'));
    const externalCount = snapshot.nodes.filter(node => node.kind === 'external-submission').length;
    if (gpu && externalCount > 0) {
      const hint = element('p', 'external');
      hint.append(createPanelIcon('external'), document.createTextNode(`${countLabel(externalCount, 'external submission')} ${externalCount === 1 ? 'is' : 'are'} outside per-pass GPU timing`));
      this.timingContent.append(hint);
    }
  }

  private createWork(snapshot: FrameGraphDebugViewModel): HTMLElement {
    const work = element('section', 'work');
    const heading = element('div', 'heading');
    const kinds = element('div', 'kinds');
    for (const kind of NODE_KINDS) {
      const count = snapshot.nodes.filter(node => node.kind === kind).length;
      if (!count) continue;
      const label = element('span', 'kind-count', `${count} ${KIND_LABELS[kind]}`);
      label.dataset.kind = kind; kinds.append(label);
    }
    kinds.append(this.link(`${snapshot.culledNodes.length} Culled`, () => this.callbacks.onNavigate?.('passes', 'culled'), false));
    heading.append(element('h2', 'title', 'Work composition'), kinds);
    const frameGraphSegments = snapshot.executionSegments.filter(segment => segment.kind === 'frame-graph').length;
    const boundaries = snapshot.executionSegments.length - frameGraphSegments;
    work.append(heading, element('p', 'note', `${countLabel(frameGraphSegments, 'frame-graph segment')} · ${countLabel(boundaries, 'external boundary', 'external boundaries')} · ${snapshot.availability.groups ? countLabel(snapshot.debugGroups.length, 'group') : 'Groups unknown'}`));
    return work;
  }

  private createResources(snapshot: FrameGraphDebugViewModel): HTMLElement {
    const panel = element('section', 'panel');
    const heading = element('header', 'heading');
    heading.append(element('h2', 'title', 'Resources & memory'), this.link('View memory', () => this.callbacks.onNavigate?.('memory')));
    const allocationAvailable = snapshot.protocol.memory.allocationReport.status === 'available';
    panel.append(heading, facts([
      ['Logical resources', String(snapshot.resources.length)],
      ['Textures / buffers', `${snapshot.resources.filter(resource => resource.kind === 'texture').length} / ${snapshot.resources.filter(resource => resource.kind === 'buffer').length}`],
      ['Physical allocations', allocationAvailable ? String(snapshot.physicalAllocations.length) : 'Unavailable'],
      ['Alias savings estimate', allocationAvailable ? formatEstimatedBytes(snapshot.metrics.aliasReuseBytes) : 'Unavailable'],
    ]));
    const poolSection = element('section', 'pool');
    poolSection.append(element('h3', 'subtitle', 'Resource pool · cumulative'));
    const pool = snapshot.resourcePool;
    poolSection.append(facts([
      ['Reuse', pool.status === 'available' ? pool.acquireCount > 0 ? `${(pool.reuseCount / pool.acquireCount * 100).toFixed(1)}%` : 'Not applicable · no acquisitions' : 'Unavailable'],
      ['Idle retained estimate', pool.status === 'available' ? formatEstimatedBytes(pool.estimatedRetainedBytes) : 'Unavailable'],
      ['Idle allocations', pool.status === 'available' ? String(pool.retainedCount) : 'Unavailable'],
    ]));
    const footer = document.createElement('footer');
    footer.append(this.link('View resources', () => this.callbacks.onNavigate?.('resources')));
    panel.append(poolSection, footer);
    return panel;
  }

  private createDisclosure(label: string, className: string): HTMLDetailsElement {
    const details = element('details', 'details');
    details.classList.add(className);
    const summary = document.createElement('summary');
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
      ['Recording order', snapshot.availability.recordingOrder ? 'Available' : 'Unknown'],
      ['Access regions', snapshot.availability.accessRegions ? 'Available' : 'Unknown'],
      ['Logical transient estimate', formatEstimateCoverage(snapshot.metrics.transientEstimatedByteSize, snapshot.metrics.estimatedCoverage.transient)],
      ['GPU timing', protocol.timings.gpu.status === 'available' ? formatTimingCoverage(snapshot.metrics.timedNodeCount, snapshot.metrics.timingEligibleNodeCount) : protocol.timings.gpu.reason],
      ['CPU timing', protocol.timings.cpu.status === 'available' ? formatTimingCoverage(snapshot.metrics.cpuTimedNodeCount, snapshot.nodes.length) : protocol.timings.cpu.reason],
      ...(protocol.memory.allocationReport.status === 'unavailable' ? [['Allocation report', protocol.memory.allocationReport.reason] as const] : []),
      ...(protocol.memory.poolReport.status === 'unavailable' ? [['Pool report', protocol.memory.poolReport.reason] as const] : []),
    ]);
  }

  private link(label: string, onClick: () => void, arrow = true): HTMLButtonElement {
    const button = element('button', 'link');
    button.type = 'button';
    button.append(document.createTextNode(label));
    if (arrow) button.append(createPanelIcon('chevron-right'));
    button.addEventListener('click', onClick);
    return button;
  }
}
