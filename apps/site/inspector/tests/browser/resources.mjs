import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Exercise resource estimates and access navigation without a GPU adapter. */
export async function checkResources(page, output, fullSnapshot) {
    const original = await page.evaluate(() => themeQA.snapshot);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const setSnapshot = snapshot => page.evaluate(snapshot => themeQA.inspector.setSnapshot(snapshot), snapshot);
    const open = name => page.getByRole('tab', { name, exact: true }).first().click();
    const details = page.locator('.zenfg-inspector-inspector');
    const close = async () => { if (await details.isVisible()) await details.getByRole('button', { name: 'Close inspector', exact: true }).click(); };
    const resources = page.locator('.zenfg-inspector-resources-view');
    const table = resources.locator('.zenfg-inspector-resource-table');
    const row = id => table.locator(`tr[data-selection-key="resource:resource:${id}"]`);
    const scene = () => row('scene-color');
    const search = resources.getByRole('searchbox', { name: 'Search resource, ID or group', exact: true });
    const source = resourceFixture(fullSnapshot);
    const noOverflow = async label => {
        assert.ok(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: resource table fits`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page fits`);
        assert.ok(await details.locator('.zenfg-inspector-inspector-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: details fit`);
    };
    const checkName = async (locator, label) => {
        assert.ok(await locator.evaluate(button => {
            const suffix = button.querySelector('.zenfg-inspector-name-suffix');
            const text = suffix?.firstChild; if (!text) return true;
            const range = document.createRange(); range.setStart(text, text.textContent.length - 1); range.setEnd(text, text.textContent.length);
            const tail = range.getBoundingClientRect(), bounds = button.getBoundingClientRect();
            return tail.right <= bounds.right + 1 && tail.left >= bounds.left - 1 && tail.bottom <= bounds.bottom + 1;
        }), `${label}: identifying final character remains visible`);
    };
    try {
        await close(); await setSnapshot(source); await open('Resources');
        assert.equal(await table.getAttribute('data-max-bytes'), '8294400');
        assert.equal(await row('half').locator('.zenfg-inspector-resource-size-bar > span').evaluate(el => el.style.width), '25%');
        assert.equal(await row('zero').locator('.zenfg-inspector-resource-size-value').innerText(), '0 B');
        assert.equal(await row('zero').locator('.zenfg-inspector-resource-size-bar > span').evaluate(el => el.style.width), '0%');
        assert.equal(await row('unused-data').locator('.zenfg-inspector-resource-size-bar').count(), 0);
        assert.equal(await row('unused-data').locator('.zenfg-inspector-resource-size-value').innerText(), 'Unknown');
        assert.equal(await row('unused-data').locator('.zenfg-inspector-resource-descriptor').innerText(), 'Capacity 4.0 KiB');
        assert.equal(await row('imported').locator('.zenfg-inspector-resource-descriptor').count(), 0, 'capacity equal to the estimate is not repeated');
        await search.fill('postfx.bloom');
        assert.equal(await row('half').locator('.zenfg-inspector-resource-size-bar > span').evaluate(el => el.style.width), '25%');
        assert.equal(await table.getAttribute('data-max-bytes'), '8294400');
        await resources.getByRole('button', { name: 'Clear filters', exact: true }).click();
        assert.equal(await search.evaluate(el => document.activeElement === el), true);
        await resources.getByRole('combobox', { name: 'Sort resources', exact: true }).selectOption('size');
        assert.equal(await table.locator('tbody tr[data-selection-key]').first().getAttribute('data-selection-key'), 'resource:resource:scene-color');

        for (const [width, height] of [[1877, 920], [1277, 920], [900, 920], [800, 920], [390, 844], [320, 844], [390, 480]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(height => { themeQA.host.style.height = `${Math.min(800, height - 10)}px`; }, height);
            for (const mode of ['dark', 'light', 'custom']) {
                await page.evaluate(mode => {
                    themeQA.inspector.setTheme(mode === 'light' ? themeQA.tokyoNightLight : themeQA.tokyoNightStorm);
                    if (mode === 'custom') { themeQA.host.style.setProperty('--zfgi-font-size', '14px'); themeQA.host.style.setProperty('--zfgi-font-size-small', '13px'); }
                    else { themeQA.host.style.removeProperty('--zfgi-font-size'); themeQA.host.style.removeProperty('--zfgi-font-size-small'); }
                    themeQA.inspector.refreshTheme();
                }, mode);
                await settle(); await noOverflow(`${mode}/${width}`);
                await checkName(scene().locator('.zenfg-inspector-object-name'), `${mode}/${width}`);
                const layout = await scene().evaluate(row => {
                    const name = row.cells[0].getBoundingClientRect(), size = row.cells[1].getBoundingClientRect();
                    return { stacked: getComputedStyle(row).display === 'grid', nameWidth: name.width, rowWidth: row.getBoundingClientRect().width, nameBottom: name.bottom, sizeTop: size.top };
                });
                if (layout.stacked) {
                    assert.ok(layout.nameWidth >= layout.rowWidth - 20, 'narrow names span the row');
                    assert.ok(layout.sizeTop >= layout.nameBottom - 1, 'size comparison follows the name');
                    assert.equal(await scene().locator('.zenfg-inspector-resource-size-label').isVisible(), true);
                }
                const alignment = await table.evaluate(table => {
                    const rows = [...table.tBodies[0].rows].slice(0, 2);
                    return rows.map(row => {
                        const count = row.querySelector('button[data-access=read] span').getBoundingClientRect();
                        const note = row.querySelector('.zenfg-inspector-resource-culled')?.getBoundingClientRect();
                        return { offset: count.top - row.getBoundingClientRect().top, noteFits: !note || note.bottom <= row.getBoundingClientRect().bottom + 1 };
                    });
                });
                assert.ok(alignment.every(row => row.noteFits), 'Culled explanations fit their resource rows');
                if (!layout.stacked) assert.ok(Math.abs(alignment[0].offset - alignment[1].offset) <= 1, 'Culled notes do not shift read/write count alignment');
                await page.screenshot({ path: resolve(output, `resources-${mode}-${width}-${height}.png`), animations: 'disabled' });
            }
        }
        await page.evaluate(() => { themeQA.host.style.removeProperty('--zfgi-font-size'); themeQA.host.style.removeProperty('--zfgi-font-size-small'); themeQA.inspector.refreshTheme(); });
        await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => { themeQA.host.style.height = '800px'; }); await settle();
        for (const width of [799.5, 800, 800.5]) {
            await page.evaluate(width => { themeQA.host.style.width = `${width + 20}px`; }, width); await settle();
            const state = await scene().evaluate(row => ({ width: parseFloat(getComputedStyle(row.closest('.zenfg-inspector-main')).width), display: getComputedStyle(row).display }));
            assert.ok(Math.abs(state.width - width) < 0.05); assert.equal(state.display, width < 800 ? 'grid' : 'table-row'); await noOverflow(`fractional ${width}`);
        }
        await page.evaluate(() => { themeQA.host.style.width = '100%'; }); await settle();
        const name = scene().locator('.zenfg-inspector-object-name'); await name.focus(); await setSnapshot(source); await settle();
        assert.equal(await name.evaluate(el => document.activeElement === el), true, 'capture refresh preserves resource name focus');
        const zero = row('zero').locator('.zenfg-inspector-object-name'); await zero.focus();
        const removed = structuredClone(source); removed.graph.resources = removed.graph.resources.filter(resource => resource.id !== 'resource:zero');
        await setSnapshot(removed); await settle(); assert.equal(await search.evaluate(el => document.activeElement === el), true, 'removed resource focus recovers to search');
        await setSnapshot(source); await settle();

        await scene().locator('button[data-access="read"]').click();
        const accesses = details.locator('.zenfg-inspector-resource-pass-accesses');
        assert.equal(await details.getByRole('tab', { name: 'Relations', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await accesses.getByRole('button', { name: 'Filter resource accesses: Read', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await accesses.locator('[data-access-node-id]').count(), 2);
        assert.equal(await accesses.locator('[data-access-node-id="node:present"] li').count(), 2, 'repeated ranges stay separate within a single pass');
        assert.match(await accesses.innerText(), /3 declared access records · 2 passes · 1 culled access/);
        const all = accesses.getByRole('button', { name: 'Filter resource accesses: All', exact: true }); await all.press('Enter');
        assert.equal(await all.evaluate(el => document.activeElement === el), true, 'filter refresh retains keyboard focus');
        await setSnapshot(source); assert.equal(await all.evaluate(el => document.activeElement === el), true);
        assert.deepEqual(await accesses.locator('[data-access-node-id]').evaluateAll(entries => entries.map(entry => entry.dataset.accessNodeId)), ['node:scene', 'node:present', 'node:unused']);
        await checkName(accesses.locator('[data-access-node-id="node:scene"] .zenfg-inspector-object-name'), 'related pass');
        await page.screenshot({ path: resolve(output, 'resources-relations-docked.png'), animations: 'disabled' });
        await accesses.locator('[data-access-node-id="node:present"] .zenfg-inspector-object-name').click();
        assert.equal(await page.getByRole('tab', { name: 'Resources', exact: true }).getAttribute('aria-selected'), 'true', 'inspect keeps the current page');
        assert.equal(await details.locator('header strong').innerText(), 'present'); await close();

        await row('imported').locator('.zenfg-inspector-object-name').click();
        await details.getByRole('tab', { name: 'Summary', exact: true }).click();
        assert.equal(await details.getByRole('button', { name: 'Locate in Memory', exact: true }).count(), 0);
        assert.match(await details.innerText(), /Not applicable · externally owned resource/); await close();
        await scene().locator('.zenfg-inspector-object-name').click();
        await details.getByRole('tab', { name: 'Summary', exact: true }).click();
        assert.equal(await details.getByText('Descriptor', { exact: true }).isVisible(), true);
        await page.screenshot({ path: resolve(output, 'resources-summary-docked.png'), animations: 'disabled' }); await close();

        await open('Passes'); const passes = page.locator('.zenfg-inspector-passes-view');
        await passes.getByRole('combobox', { name: 'Sort passes', exact: true }).selectOption('time');
        await passes.locator('.zenfg-inspector-timing-switch').getByRole('button', { name: 'CPU', exact: true }).click();
        await passes.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true }).fill('no match');
        await open('Resources'); await scene().locator('.zenfg-inspector-resource-lifetime button').first().click();
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await passes.locator('tr.selected').getAttribute('data-selection-key'), 'node:node:scene');
        assert.equal(await passes.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true }).inputValue(), '');
        assert.equal(await passes.getByRole('combobox', { name: 'Sort passes', exact: true }).inputValue(), 'time');
        assert.equal(await passes.locator('.zenfg-inspector-pass-table').getAttribute('data-source'), 'cpu'); await close();
        await open('Resources'); await page.setViewportSize({ width: 390, height: 844 }); await settle();
        await scene().locator('button[data-access="read"]').click();
        assert.equal(await details.getAttribute('aria-modal'), 'true');
        await accesses.getByRole('button', { name: 'Filter resource accesses: All', exact: true }).click(); await noOverflow('resource access drawer');
        await page.screenshot({ path: resolve(output, 'resources-relations-drawer.png'), animations: 'disabled' });
        await accesses.locator('[data-access-node-id="node:unused"] .zenfg-inspector-icon-action').click();
        assert.equal(await details.isVisible(), false, 'locating closes the drawer');
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await passes.locator('tr.selected').getAttribute('data-selection-key'), 'culled:node:unused');
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).evaluate(el => document.activeElement === el), true);
        await checkResourceExtremes(page, output, source);
    } finally {
        await close(); await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => {
            themeQA.host.style.width = '100%'; themeQA.host.style.height = '800px';
            themeQA.host.style.removeProperty('--zfgi-font-size'); themeQA.host.style.removeProperty('--zfgi-font-size-small');
            themeQA.inspector.setTheme(themeQA.tokyoNightStorm);
        });
        await setSnapshot(original); await open('Graph');
    }
}

function resourceFixture(fullSnapshot) {
    const snapshot = structuredClone(fullSnapshot);
    const scene = snapshot.graph.resources.find(resource => resource.id === 'resource:scene-color');
    const buffer = snapshot.graph.resources.find(resource => resource.id === 'resource:unused-data');
    scene.label = `frame.history.${'resource.namespace.'.repeat(12)}color-pyramid.layer.1`;
    buffer.label = `persistent.${'buffer.namespace.'.repeat(10)}光照缓存😀.layer.12`;
    snapshot.graph.resources.push(
        { ...scene, id: 'resource:half', label: 'postfx.bloom.prefilter.mip.0', groupId: undefined, allocationId: undefined, estimatedByteSize: scene.estimatedByteSize / 4 },
        { ...buffer, id: 'resource:zero', label: 'scratch.zero-estimate', estimatedByteSize: 0 },
        { ...buffer, id: 'resource:imported', label: 'scene.geometry.vertex-data', origin: 'imported', initialContents: 'defined', estimatedByteSize: 65536,
            descriptor: { ...buffer.descriptor, size: 65536 } },
    );
    snapshot.graph.nodes.find(node => node.id === 'node:scene').label = `mesh.${'pass.namespace.'.repeat(10)}gbuffer.layer.1`;
    const read = snapshot.graph.accesses.find(access => access.id === 'access:present-read');
    snapshot.graph.accesses.push({ ...read, id: 'access:resource-qa:repeat' }, { ...read, id: 'access:resource-qa:culled', nodeId: 'node:unused' });
    return JSON.parse(JSON.stringify(snapshot));
}


async function checkResourceExtremes(page, output, source) {
    const stress = structuredClone(source);
    stress.graph.resources.find(resource => resource.id === 'resource:scene-color').estimatedByteSize = 1024 ** 4;
    const culledLabel = 'mesh.' + 'shadow.namespace.'.repeat(16) + 'directional-shadow.depth.12';
    stress.graph.nodes.find(node => node.id === 'node:unused').label = culledLabel;
    const read = stress.graph.accesses.find(access => access.id === 'access:present-read');
    const write = stress.graph.accesses.find(access => access.id === 'access:scene-write');
    for (let index = 0; index < 10000; index++) stress.graph.accesses.push(
        { ...read, id: 'access:stress:read:' + index }, { ...write, id: 'access:stress:write:' + index, nodeId: 'node:unused' },
    );
    const resources = page.locator('.zenfg-inspector-resources-view'), table = resources.locator('.zenfg-inspector-resource-table');
    const scene = table.locator('tr[data-selection-key="resource:resource:scene-color"]');
    await page.getByRole('tab', { name: 'Resources', exact: true }).click();
    await page.evaluate(stress => themeQA.inspector.setSnapshot(stress), stress);
    const widths = [];
    for (const [width, small] of [[1277, 12], [900, 12], [320, 12], [320, 13]]) {
        await page.setViewportSize({ width, height: 920 });
        await page.evaluate(small => {
            themeQA.host.style.setProperty('--zfgi-font-size', (small + 1) + 'px');
            themeQA.host.style.setProperty('--zfgi-font-size-small', small + 'px'); themeQA.inspector.refreshTheme();
        }, small);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const geometry = await scene.evaluate(row => {
            const value = row.querySelector('.zenfg-inspector-resource-size-value'), range = document.createRange(); range.selectNodeContents(value);
            const glyphs = range.getBoundingClientRect(), size = value.closest('td').getBoundingClientRect();
            const bar = row.querySelector('.zenfg-inspector-resource-size-bar').getBoundingClientRect();
            const note = row.querySelector('.zenfg-inspector-resource-culled').getBoundingClientRect();
            return { value: value.textContent, valueFits: glyphs.right <= size.right + 1 && glyphs.left >= bar.right + 3,
                accessFits: [...row.querySelectorAll('button[data-access]')].every(button => button.getBoundingClientRect().bottom <= note.top + 1) };
        });
        assert.equal(geometry.value, '1048576.0 MiB');
        assert.ok(geometry.valueFits, width + '/' + small + ': large estimates retain their complete number and unit without covering the bar or adjacent column');
        assert.ok(geometry.accessFits, 'five-digit access counts and Culled explanations never overlap');
        const tracks = await table.locator('.zenfg-inspector-resource-size-bar').evaluateAll(bars => bars.map(bar => bar.getBoundingClientRect().width));
        assert.ok(Math.max(...tracks) - Math.min(...tracks) <= 1, 'all resource bars keep the same pixel scale for different value lengths');
        assert.ok(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (width === 1277) widths.push(await table.locator('tr[data-selection-key="resource:resource:half"] .zenfg-inspector-resource-size-bar').evaluate(el => el.getBoundingClientRect().width));
        await page.screenshot({ path: resolve(output, 'resources-stress-' + width + '-' + small + '.png'), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1277, height: 920 });
    await page.evaluate(() => { themeQA.host.style.removeProperty('--zfgi-font-size'); themeQA.host.style.removeProperty('--zfgi-font-size-small'); themeQA.inspector.refreshTheme(); });
    const search = resources.getByRole('searchbox', { name: 'Search resource, ID or group', exact: true });
    await search.fill('postfx.bloom');
    const filteredWidth = await table.locator('tr[data-selection-key="resource:resource:half"] .zenfg-inspector-resource-size-bar').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(Math.abs(filteredWidth - widths[0]) <= 1, 'filtering retains the full-capture numeric and access column widths');
    assert.equal(await table.getAttribute('data-max-bytes'), String(1024 ** 4));
    await resources.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await table.locator('tr[data-selection-key="resource:resource:unused-data"] button[data-access="write"]').click();
    const relatedName = page.locator('[data-access-node-id="node:unused"] .zenfg-inspector-object-name');
    assert.equal(await relatedName.textContent(), culledLabel);
    assert.equal(await relatedName.locator('.zenfg-inspector-name-suffix').textContent(), [...culledLabel].slice(-12).join(''));
    assert.equal(await relatedName.getAttribute('aria-label'), culledLabel + ' (culled)');
    await page.screenshot({ path: resolve(output, 'resources-culled-long-name.png'), animations: 'disabled' });
}
