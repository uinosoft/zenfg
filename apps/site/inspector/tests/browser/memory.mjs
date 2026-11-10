import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check allocation scopes, inclusive lifetimes, and compact responsive navigation. */
export async function checkMemory(page, output, fullSnapshot) {
    const original = await page.evaluate(() => themeQA.snapshot);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const setSnapshot = snapshot => page.evaluate(snapshot => themeQA.inspector.setSnapshot(snapshot), JSON.parse(JSON.stringify(snapshot)));
    const open = name => page.getByRole('tab', { name, exact: true }).first().click();
    const memory = page.locator('.zenfg-inspector-memory-view');
    const details = page.locator('.zenfg-inspector-inspector');
    const close = async () => { if (await details.isVisible()) await details.getByRole('button', { name: 'Close inspector', exact: true }).click(); };
    const scroller = memory.locator('.zenfg-inspector-memory-scroller');
    const row = id => memory.locator(`.zenfg-inspector-memory-resource[data-selection-key="resource:resource:${id}"]`);
    const allocation = id => memory.locator(`.zenfg-inspector-memory-allocation[data-allocation-id="allocation:${id}"]`);
    const mainAllocation = () => memory.locator('.zenfg-inspector-memory-allocation[data-kind="texture"]').first();
    const expand = async id => { const toggle = memory.locator(`[data-allocation-toggle="allocation:${id}"]`); if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click(); };
    const expandAll = async expanded => { await memory.evaluate((root, expanded) => {
        const ids = [...root.querySelectorAll('[data-allocation-toggle]')].map(button => button.dataset.allocationToggle);
        for (const id of ids) { const button = [...root.querySelectorAll('[data-allocation-toggle]')].find(button => button.dataset.allocationToggle === id); if (button.getAttribute('aria-expanded') !== String(expanded)) button.click(); }
    }, expanded); await settle(); };
    const control = key => memory.locator(`[data-memory-focus="${key}"]`);
    const search = memory.getByRole('searchbox');
    const filter = memory.getByRole('combobox', { name: 'Memory allocation status', exact: true });
    const sort = memory.getByRole('combobox', { name: 'Memory sort', exact: true });
    const metric = label => memory.locator('.zenfg-inspector-memory-metric').filter({ hasText: label }).locator('strong').innerText();
    const source = memoryFixture(fullSnapshot);
    const activeKey = () => page.evaluate(() => document.activeElement?.dataset.memoryFocus);
    const fits = async label => {
        for (const locator of [memory, scroller, memory.locator('.zenfg-inspector-memory-timeline'), memory.locator('.zenfg-inspector-memory-controls')]) {
            assert.ok(await locator.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: no horizontal overflow`);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page fits`);
        assert.ok(await mainAllocation().locator('.zenfg-inspector-memory-preview').evaluate(button => {
            const text = button.querySelector('.zenfg-inspector-name-suffix')?.firstChild;
            if (!text) return false;
            const range = document.createRange(); range.setStart(text, text.length - 1); range.setEnd(text, text.length);
            const tail = range.getBoundingClientRect(), bounds = button.getBoundingClientRect();
            return tail.right <= bounds.right + 1 && tail.left >= bounds.left - 1;
        }), `${label}: name suffix remains visible`);
        const geometry = await mainAllocation().evaluate(row => {
            const track = row.querySelector('.zenfg-inspector-memory-track').getBoundingClientRect();
            const name = row.querySelector('.zenfg-inspector-memory-name').getBoundingClientRect();
            const axis = row.closest('.zenfg-inspector-memory-view').querySelector('.zenfg-inspector-memory-axis-track').getBoundingClientRect();
            return { trackWidth: track.width, nameWidth: name.width, rowWidth: row.getBoundingClientRect().width, delta: Math.abs(track.x - axis.x) + Math.abs(track.width - axis.width), stacked: track.y > name.bottom };
        });
        assert.ok(geometry.trackWidth >= 150, `${label}: useful lifecycle width`);
        assert.ok(geometry.delta < 2, `${label}: axis and bar share coordinates`);
        if (await row('single-0').count()) {
            const inlineAction = await row('single-0').evaluate(row => {
                const name = row.querySelector('.zenfg-inspector-memory-title > .zenfg-inspector-object-name').getBoundingClientRect(), reveal = row.querySelector('.zenfg-inspector-memory-reveal').getBoundingClientRect();
                return { gap: reveal.x - name.right, center: Math.abs(reveal.y + reveal.height / 2 - name.y - name.height / 2) };
            });
            assert.ok(inlineAction.gap >= 3 && inlineAction.gap <= 5 && inlineAction.center < 1, `${label}: locate action stays beside its name`);
        }
        assert.ok(await memory.locator('.zenfg-inspector-memory-size').evaluateAll(cells => cells.every(cell => {
            const bounds = cell.getBoundingClientRect(), amount = cell.querySelector('.zenfg-inspector-memory-size-value').getBoundingClientRect(); return amount.left >= bounds.left - 1 && amount.right <= bounds.right + 1;
        })), `${label}: estimates fit their columns`);
        const labels = await memory.locator('.zenfg-inspector-memory-axis-track').evaluate(axis => {
            const bounds = axis.getBoundingClientRect();
            const ticks = [...axis.querySelectorAll(':scope > span')].filter(tick => tick.getClientRects().length).map(tick => tick.getBoundingClientRect());
            return ticks.every((tick, index) => tick.left >= bounds.left - 1 && tick.right <= bounds.right + 1 && (!index || tick.left >= ticks[index - 1].right + 3));
        });
        assert.ok(labels, `${label}: tick labels fit without overlap`);
        if (await memory.evaluate(el => el.clientWidth < 800)) assert.ok(geometry.stacked && geometry.nameWidth >= geometry.rowWidth - 20, `${label}: full-row identity`);
    };
    try {
        await close(); await setSnapshot(source); await open('Memory'); await settle(); await expandAll(false);
        assert.equal(await metric('Alias savings estimate'), '64 B');
        assert.equal(await memory.locator('.zenfg-inspector-memory-allocation-group[data-sharing="single"]').count(), 8);
        assert.equal(await memory.locator('.zenfg-inspector-memory-allocation').count(), 10);
        assert.equal(await memory.locator('.zenfg-inspector-memory-allocation-resources .zenfg-inspector-memory-resource').count(), 0, 'all physical allocations can be collapsed');
        assert.equal(await memory.locator('[data-allocation-toggle]').count(), 9, 'Single and Shared share the same fold behavior');
        await expand('shared-qa');
        assert.match(await row('shared-a').locator('.zenfg-inspector-memory-size').innerText(), /60 B/);
        assert.match(await memory.locator('.zenfg-inspector-memory-allocation[data-allocation-id="allocation:shared-qa"]').innerText(), /Shared ×2.*Physical\s+64 B/s);
        const axis = await memory.locator('.zenfg-inspector-memory-axis-track').innerText();
        const bar = await row('shared-a').locator('.zenfg-inspector-memory-bar').evaluate(el => ({ left: el.style.left, width: el.style.width }));
        assert.deepEqual(bar, { left: '0%', width: '33.3333%' });
        await search.fill('shared.work-a');
        assert.match(await memory.locator('.zenfg-inspector-memory-sharing').innerText(), /Shared ×2/);
        assert.match(await memory.locator('.zenfg-inspector-memory-member-count').innerText(), /1 [/] 2 logical resources matching/);
        assert.equal(await memory.locator('.zenfg-inspector-memory-axis-track').innerText(), axis);
        await memory.getByRole('button', { name: 'Clear filters', exact: true }).click();
        assert.equal(await search.evaluate(el => el === document.activeElement), true);
        await filter.selectOption('unreferenced');
        assert.match(await memory.locator('.zenfg-inspector-result-count').innerText(), /1 \/ 10 allocations · 0 \/ 11 resources/);
        assert.equal(await memory.locator('[data-allocation-toggle]').count(), 0);
        await memory.getByRole('button', { name: 'Clear filters', exact: true }).click();
        await sort.selectOption('size'); await expandAll(false);

        for (const [width, height] of [[1877, 920], [1277, 920], [830, 920], [800, 920], [600, 844], [390, 844], [320, 844], [390, 480]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(height => { themeQA.host.style.height = `${Math.min(800, height - 10)}px`; }, height);
            for (const mode of ['dark', 'light']) {
                await page.evaluate(mode => themeQA.inspector.setTheme(mode === 'light' ? themeQA.tokyoNightLight : themeQA.tokyoNightStorm), mode);
                await scroller.evaluate(el => { el.scrollTop = 0; }); await settle(); await fits(`${mode}/${width}/${height}`);
                const values = await memory.locator('.zenfg-inspector-memory-summary strong').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().y));
                assert.ok(Math.abs(values[0] - values[1]) < 1, `${mode}/${width}: KPI values align`);
                await page.screenshot({ path: resolve(output, `memory-${mode}-${width}-${height}.png`), animations: 'disabled' });
                if (height === 480) {
                    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; }); await settle();
                    const sticky = await memory.locator('.zenfg-inspector-memory-controls').boundingBox(), bounds = await scroller.boundingBox();
                    assert.ok(Math.abs(sticky.y - bounds.y) < 1, 'filters and axis remain together while scrolling');
                    await page.screenshot({ path: resolve(output, `memory-${mode}-390-scrolled.png`), animations: 'disabled' });
                }
            }
        }
        await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => { themeQA.host.style.height = '800px'; themeQA.inspector.setTheme(themeQA.tokyoNightStorm); });
        for (const width of [799.5, 800, 800.5]) {
            await page.evaluate(width => { themeQA.host.style.width = `${width + 20}px`; }, width); await settle(); await fits(`fractional/${width}`);
            assert.ok(Math.abs(await memory.evaluate(el => parseFloat(getComputedStyle(el).width)) - width) < 0.05, 'test the actual container breakpoint');
        }
        await page.evaluate(() => {
            themeQA.host.style.width = '100%'; themeQA.host.style.setProperty('--zfgi-font-size', '16px'); themeQA.host.style.setProperty('--zfgi-font-size-small', '14px');
        });
        await page.setViewportSize({ width: 320, height: 844 }); await settle(); await fits('large fonts/320');
        await page.screenshot({ path: resolve(output, 'memory-large-font-320.png'), animations: 'disabled' });
        await page.evaluate(() => { themeQA.host.style.removeProperty('--zfgi-font-size'); themeQA.host.style.removeProperty('--zfgi-font-size-small'); });
        await page.setViewportSize({ width: 1277, height: 920 }); await settle();

        await expandAll(true);
        for (const key of ['resource:scene-color:name', 'resource:scene-color:order:first', 'resource:scene-color:lifetime', 'allocation:shared-qa:toggle']) {
            await control(key).focus(); await setSnapshot(source); assert.equal(await activeKey(), key, 'capture refresh restores the same control');
        }
        await control('allocation:shared-qa:toggle').press('Enter');
        assert.equal(await activeKey(), 'allocation:shared-qa:toggle');
        await control('allocation:shared-qa:toggle').press('Enter');
        const single = structuredClone(source); single.graph.resources = single.graph.resources.filter(resource => resource.id !== 'resource:shared-b');
        await setSnapshot(single); assert.equal(await activeKey(), 'allocation:shared-qa:toggle', 'Shared to Single retains the same toggle');
        await setSnapshot(source); assert.equal(await activeKey(), 'allocation:shared-qa:toggle');
        await control('resource:single-0:name').focus();
        const removed = structuredClone(source); removed.graph.resources = removed.graph.resources.filter(resource => resource.id !== 'resource:single-0');
        removed.memory.allocationReport.allocations = removed.memory.allocationReport.allocations.filter(allocation => allocation.id !== 'allocation:single-0');
        await setSnapshot(removed); assert.equal(await search.evaluate(el => el === document.activeElement), true, 'removed target falls back to search');
        await setSnapshot(source);

        await control('resource:scene-color:name').click(); await settle(); await fits('docked');
        await page.screenshot({ path: resolve(output, 'memory-docked.png'), animations: 'disabled' });
        await close(); assert.equal(await activeKey(), 'resource:scene-color:name');
        await allocation('texture-0').locator('.zenfg-inspector-memory-allocation-link').click();
        assert.equal(await row('scene-color').evaluate(el => el.classList.contains('related-allocation')), true);
        assert.equal(await row('scene-color').evaluate(el => el.classList.contains('selected')), false, 'allocation selection is distinct from resource selection');
        await search.fill('no match'); await filter.selectOption('unreferenced');
        await details.getByRole('button', { name: 'Locate in Memory', exact: true }).click();
        assert.equal(await search.inputValue(), ''); assert.equal(await filter.inputValue(), 'all'); assert.equal(await sort.inputValue(), 'size');
        assert.equal(await activeKey(), 'allocation:texture-0:name'); await close();
        await open('Passes');
        const passes = page.locator('.zenfg-inspector-passes-view');
        await passes.locator('.zenfg-inspector-timing-switch').getByRole('button', { name: 'CPU', exact: true }).click();
        await passes.getByRole('combobox', { name: 'Sort passes', exact: true }).selectOption('time');
        await passes.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true }).fill('no match');
        await open('Memory'); await control('resource:scene-color:order:last').click();
        assert.equal(await passes.locator('tr.selected').getAttribute('data-selection-key'), 'node:node:present');
        assert.equal(await passes.locator('.zenfg-inspector-pass-table').getAttribute('data-source'), 'cpu');
        assert.equal(await passes.getByRole('combobox', { name: 'Sort passes', exact: true }).inputValue(), 'time');
        assert.equal(await passes.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true }).inputValue(), ''); await close();
        await open('Memory'); await control('resource:scene-color:locate').click();
        assert.equal(await page.getByRole('tab', { name: 'Resources', exact: true }).getAttribute('aria-selected'), 'true');
        await close(); await open('Memory');
        await page.setViewportSize({ width: 390, height: 844 }); await settle();
        await control('resource:scene-color:name').click(); assert.equal(await details.getAttribute('aria-modal'), 'true');
        await close(); assert.equal(await activeKey(), 'resource:scene-color:name', 'drawer closes back to the initiating control');
        await control('resource:scene-color:name').click(); await setSnapshot(source); await close();
        assert.equal(await activeKey(), 'resource:scene-color:name', 'drawer refresh preserves the initiating control');
        await expand('single-0'); await control('resource:single-0:name').click(); await setSnapshot(removed);
        assert.equal(await details.isVisible(), false, 'removing the selected resource closes its drawer');
        assert.equal(await search.evaluate(el => el === document.activeElement), true, 'removed drawer opener returns to search');
        await setSnapshot(source); await control('resource:shared-a:name').click(); await setSnapshot(single); await close();
        assert.equal(await activeKey(), 'resource:shared-a:name', 'Shared to Single keeps the drawer opener');
        await setSnapshot(source);
        await control('resource:scene-color:lifetime').click();
        await details.getByRole('button', { name: 'Locate in Memory', exact: true }).click();
        assert.equal(await details.isVisible(), false);
        const targetBounds = await row('scene-color').boundingBox(), controlsBounds = await memory.locator('.zenfg-inspector-memory-controls').boundingBox();
        assert.ok(targetBounds.y >= controlsBounds.y + controlsBounds.height - 1, 'explicit reveal clears sticky controls');

        const unknown = structuredClone(source);
        delete unknown.memory.allocationReport.allocations.find(allocation => allocation.id === 'allocation:single-0').estimatedByteSize;
        await setSnapshot(unknown); assert.equal(await metric('Alias savings estimate'), '64 B');
        await open('Overview'); assert.match(await page.locator('.zenfg-inspector-overview-view').innerText(), /Alias savings estimate\s*64 B/);
        await open('Memory');
        delete unknown.memory.allocationReport.allocations.find(allocation => allocation.id === 'allocation:shared-qa').estimatedByteSize;
        await setSnapshot(unknown); assert.equal(await metric('Alias savings estimate'), 'Unknown');
        assert.match(await memory.locator('.zenfg-inspector-memory-summary').innerText(), /0\/1 shared allocation sizes known/);
        const unavailable = structuredClone(source); unavailable.memory.allocationReport = { status: 'unavailable', reason: 'Not captured' };
        unavailable.graph.resources.forEach(resource => { delete resource.allocationId; });
        await setSnapshot(unavailable); assert.equal(await memory.locator('.zenfg-inspector-memory-summary .zenfg-inspector-memory-metric').count(), 0);
        assert.match(await memory.locator('.zenfg-inspector-memory-report-state').innerText(), /unavailable · Not captured/);
        await page.screenshot({ path: resolve(output, 'memory-unavailable-390.png'), animations: 'disabled' });
        const extremes = structuredClone(source);
        const longAllocation = 'allocation:' + 'transient.pool.'.repeat(20) + 'target.layer.12';
        extremes.graph.resources.find(resource => resource.id === 'resource:scene-color').allocationId = longAllocation;
        extremes.graph.resources.find(resource => resource.id === 'resource:scene-color').estimatedByteSize = 2 ** 40;
        extremes.memory.allocationReport.allocations[0].id = longAllocation;
        extremes.memory.allocationReport.allocations[0].estimatedByteSize = 2 ** 40;
        await setSnapshot(extremes);
        for (const width of [1277, 830, 320]) {
            await page.setViewportSize({ width, height: 844 }); await settle(); await fits(`large estimates/${width}`);
            const link = mainAllocation().locator('.zenfg-inspector-memory-allocation-link');
            assert.match(await link.getAttribute('title'), /target.layer.12/);
            assert.ok(await link.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long allocation name fits');
            await page.screenshot({ path: resolve(output, `memory-extremes-${width}.png`), animations: 'disabled' });
        }
        const longDomain = structuredClone(source);
        const lateNodes = Array.from({ length: 997 }, (_, index) => ({ id: `node:memory-order-qa:${index + 3}`, recordingOrder: index + 4, kind: 'compute', sideEffect: true, compileState: { status: 'retained', executionOrder: index + 3 } }));
        longDomain.graph.nodes.push(...lateNodes); longDomain.graph.segments[2].nodeIds.push(...lateNodes.map(node => node.id));
        longDomain.graph.resources.find(resource => resource.id === 'resource:scene-color').lifetime = { firstUse: 0, lastUse: 999 };
        await setSnapshot(longDomain);
        for (const width of [830, 320]) {
            await page.setViewportSize({ width, height: 844 }); await settle(); await fits(`large Order domain/${width}`);
            await page.screenshot({ path: resolve(output, `memory-large-order-${width}.png`), animations: 'disabled' });
        }
        const assignedExternal = structuredClone(source);
        for (const resource of assignedExternal.graph.resources) if (resource.origin === 'transient' && resource.lifetime) resource.lifetime = { firstUse: 1, lastUse: 1 };
        const assignedSurface = assignedExternal.graph.resources.find(resource => resource.id === 'resource:backbuffer');
        assignedSurface.allocationId = 'allocation:texture-0'; assignedSurface.lifetime = { firstUse: 0, lastUse: 2 };
        await setSnapshot(assignedExternal); await expand('texture-0');
        assert.deepEqual(await memory.locator('[data-selection-key="resource:resource:backbuffer"] .zenfg-inspector-memory-bar').evaluate(el => [el.style.left, el.style.width]), ['0%', '100%']);
        assert.equal(await metric('Alias savings estimate'), '64 B', 'assigned external resources do not add transient savings');
        assert.equal(await row('backbuffer').locator('[data-origin="surface"]').innerText(), 'Surface');
        await control('resource:backbuffer:name').click(); await details.getByRole('button', { name: 'Locate in Memory', exact: true }).click();
        assert.equal(await details.isVisible(), false); assert.equal(await row('backbuffer').evaluate(el => el.classList.contains('selected')), true);
        await page.screenshot({ path: resolve(output, 'memory-assigned-surface-320.png'), animations: 'disabled' });
        const mixed = mixedAllocationFixture(source);
        await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => { themeQA.host.style.height = '800px'; });
        await setSnapshot(mixed); await sort.selectOption('size');
        const allocationOrder = () => memory.locator('.zenfg-inspector-memory-allocation-group').evaluateAll(groups => groups.map(group => group.dataset.allocationId));
        const expectedOrder = ['allocation:mixed:large', 'allocation:mixed:unused', 'allocation:mixed:shared', 'allocation:mixed:small'];
        assert.deepEqual(await allocationOrder(), expectedOrder);
        const coverage = () => allocation('mixed:shared').locator('.zenfg-inspector-memory-bar').evaluateAll(bars => bars.map(bar => [bar.style.left, bar.style.width]));
        const completeCoverage = await coverage(); assert.equal(completeCoverage.length, 2);
        assert.match(await allocation('mixed:shared').innerText(), /2\/3 known/);
        await search.fill('scratch.history.a'); assert.deepEqual(await coverage(), completeCoverage);
        assert.equal(await row('mixed:a').count(), 1); assert.match(await allocation('mixed:shared').innerText(), /Shared ×3/);
        await memory.getByRole('button', { name: 'Clear filters', exact: true }).click();
        for (const width of [1277, 390]) {
            await page.setViewportSize({ width, height: 920 }); await settle();
            await scroller.evaluate(el => { el.scrollTop = 0; });
            await page.screenshot({ path: resolve(output, `memory-hierarchy-collapsed-${width}.png`), animations: 'disabled' });
        }
        await page.setViewportSize({ width: 1277, height: 920 }); await expand('mixed:shared'); await expand('mixed:small');
        assert.deepEqual(await allocationOrder(), expectedOrder, 'expanded children stay within global physical ordering');
        assert.equal(await allocation('mixed:small').locator('[data-scope="physical"] .zenfg-inspector-memory-size-value').innerText(), '64 B');
        assert.equal(await row('mixed:small').locator('[data-scope="logical"] .zenfg-inspector-memory-size-value').innerText(), '60 B');
        await allocation('mixed:small').locator('.zenfg-inspector-memory-track').click();
        assert.equal(await allocation('mixed:small').evaluate(el => el.classList.contains('selected')), true); await close();
        await row('mixed:small').locator('.zenfg-inspector-memory-track').click();
        assert.equal(await row('mixed:small').evaluate(el => el.classList.contains('selected')), true); await close();
        for (const width of [1277, 390, 320]) {
            await page.setViewportSize({ width, height: 920 }); await settle();
            assert.ok(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            await scroller.evaluate(el => { el.scrollTop = 0; });
            await page.screenshot({ path: resolve(output, `memory-hierarchy-expanded-${width}.png`), animations: 'disabled' });
        }
        const physicalOnlyLarge = structuredClone(mixed);
        physicalOnlyLarge.memory.allocationReport.allocations[1].estimatedByteSize = 2 ** 50;
        await setSnapshot(physicalOnlyLarge); await page.setViewportSize({ width: 830, height: 920 }); await settle();
        assert.ok(await allocation('mixed:large').locator('.zenfg-inspector-memory-size').evaluate(cell => {
            const box = cell.getBoundingClientRect(), amount = cell.querySelector('.zenfg-inspector-memory-size-value').getBoundingClientRect(); return amount.left >= box.left - 1 && amount.right <= box.right + 1;
        }), 'large physical capacities reserve numeric space independently of logical estimates');
        const empty = structuredClone(source);
        empty.graph = { groups: [], nodes: [], resources: [], textureViews: [], accesses: [], dependencies: [], roots: [], segments: [] };
        empty.memory.allocationReport = { status: 'available', allocations: [] };
        empty.timings = { cpu: { status: 'unavailable', reason: 'not-requested' }, gpu: { status: 'unavailable', reason: 'Not captured' } }; empty.diagnostics = [];
        await setSnapshot(empty); assert.equal(await metric('Physical allocation estimate'), '0 B'); assert.equal(await metric('Alias savings estimate'), '0 B');
        assert.match(await memory.locator('.zenfg-inspector-memory-axis-track').innerText(), /No execution lifetimes/);
        console.log('Memory acceptance: 16 responsive views, large fonts, shared/single focus, scoped estimates and Order navigation passed.');
    } finally {
        await close(); await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => {
            themeQA.host.style.width = '100%'; themeQA.host.style.height = '800px';
            themeQA.host.style.removeProperty('--zfgi-font-size'); themeQA.host.style.removeProperty('--zfgi-font-size-small'); themeQA.inspector.setTheme(themeQA.tokyoNightStorm);
        });
        await setSnapshot(original); await open('Graph');
    }
}

function mixedAllocationFixture(source) {
    const snapshot = structuredClone(source);
    const nodes = [0, 1, 2].map(order => ({ id: `node:mixed:${order}`, kind: 'compute', sideEffect: true, recordingOrder: order, compileState: { status: 'retained', executionOrder: order } }));
    const resource = (id, label, allocationId, size, lifetime) => ({ id: `resource:mixed:${id}`, label, kind: 'buffer', origin: 'transient', initialContents: 'undefined', usageFlags: ['storage'], allocationId: allocationId && `allocation:mixed:${allocationId}`, estimatedByteSize: size, lifetime, descriptor: { kind: 'buffer', size: size ?? 256 } });
    snapshot.graph = { groups: [], nodes, textureViews: [], accesses: [], dependencies: [], roots: nodes.map(node => ({ reason: 'side-effect', nodeId: node.id })), segments: [{ id: 'segment:mixed', order: 0, kind: 'frame-graph', nodeIds: nodes.map(node => node.id) }], resources: [
        resource('a', 'scratch.history.a', 'shared', 1024, { firstUse: 0, lastUse: 0 }),
        resource('b', 'scratch.history.b', 'shared', 1024, { firstUse: 2, lastUse: 2 }),
        resource('missing', 'scratch.history.missing', 'shared'),
        resource('large', 'frame.history.' + 'resource.namespace.'.repeat(10) + 'color.layer.12', 'large', 7800, { firstUse: 0, lastUse: 2 }),
        resource('small', 'draw.indirect-args', 'small', 60, { firstUse: 0, lastUse: 2 }),
        resource('loose', 'scratch.unallocated'),
    ] };
    snapshot.memory = { allocationReport: { status: 'available', allocations: [['shared', 1024], ['large', 8192], ['small', 64], ['unused', 2048]].map(([id, estimatedByteSize]) => ({ id: `allocation:mixed:${id}`, kind: 'buffer', compatibilityClassId: `compatibility:mixed:${id}`, estimatedByteSize })) }, poolReport: { status: 'available', acquireCount: 2, reuseCount: 1, createdCount: 1, retainedCount: 1, estimatedRetainedBytes: 1024 } };
    snapshot.timings = { cpu: { status: 'unavailable', reason: 'not-requested' }, gpu: { status: 'unavailable', reason: 'Not captured' } }; snapshot.diagnostics = [];
    return snapshot;
}

function memoryFixture(fullSnapshot) {
    const snapshot = structuredClone(fullSnapshot);
    const texture = snapshot.graph.resources.find(resource => resource.id === 'resource:scene-color');
    const buffer = snapshot.graph.resources.find(resource => resource.kind === 'buffer');
    texture.label = `frame.history.${'resource.namespace.'.repeat(12)}光照缓存😀.layer.12`;
    for (let index = 0; index < 7; index++) {
        snapshot.graph.resources.push({ ...texture, id: `resource:single-${index}`, label: `postfx.history.layer.${index}`, allocationId: `allocation:single-${index}` });
        snapshot.memory.allocationReport.allocations.push({ ...snapshot.memory.allocationReport.allocations[0], id: `allocation:single-${index}` });
    }
    for (const [name, order, estimate] of [['a', 0, 60], ['b', 2, 64]]) snapshot.graph.resources.push({
        ...buffer, id: `resource:shared-${name}`, label: `lighting.shared.work-${name}`, groupId: undefined, lifetime: { firstUse: order, lastUse: order }, allocationId: 'allocation:shared-qa', estimatedByteSize: estimate,
    });
    snapshot.memory.allocationReport.allocations.push(
        { id: 'allocation:shared-qa', kind: 'buffer', compatibilityClassId: 'compatibility:shared-qa', estimatedByteSize: 64 },
        { id: 'allocation:unreferenced-qa', kind: 'buffer', compatibilityClassId: 'compatibility:unreferenced-qa', estimatedByteSize: 2048 },
    );
    return snapshot;
}
