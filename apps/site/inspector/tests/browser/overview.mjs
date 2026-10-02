import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// DOM acceptance for the redesigned overview. Real capture values complement
// the synthetic edge cases covered by the Inspector unit tests.
export async function checkOverview(page, output, fullSnapshot) {
    const overview = page.locator('.zenfg-inspector-overview-view');
    const metric = name => overview.locator(`.zenfg-inspector-overview-kpi[data-metric="${name}"]`);
    const value = name => metric(name).locator('.zenfg-inspector-overview-value').innerText();
    const rows = overview.locator('.zenfg-inspector-overview-timing-rows tr[data-node-id]');
    const toggle = name => overview.getByRole('button', { name, exact: true });
    const settle = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const openOverview = async () => {
        await page.getByRole('tab', { name: 'Overview', exact: true }).first().click();
        await settle();
    };
    const setSnapshot = async snapshot => {
        await page.evaluate(snapshot => themeQA.inspector.setSnapshot(snapshot), snapshot);
        await settle();
    };
    const expectNoOverflow = async label => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page horizontal overflow`);
        assert.ok(await overview.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: overview horizontal overflow`);
    };

    try {
        await setSnapshot(fullSnapshot);
        await openOverview();
        assert.match(await value('gpu'), /1\.851\s*ms/);
        assert.equal(await value('cpu'), '—');
        assert.match(await metric('cpu').innerText(), /not (?:collected|captured|requested)/i);
        assert.match(await value('memory'), /7\.9\s*MiB/);
        assert.match(await value('passes'), /3/);
        assert.equal(await toggle('GPU').getAttribute('aria-pressed'), 'true');
        assert.equal(await rows.count(), 2);
        assert.equal(await rows.first().getAttribute('data-node-id'), 'node:scene');
        assert.match(await rows.first().innerText(), /88\.6%/);
        assert.match(await overview.innerText(), /1\.591\s*ms/);
        assert.match(await overview.innerText(), /external/i);

        // A user-selected metric and both disclosure states survive a capture refresh.
        await toggle('CPU').click();
        assert.equal(await toggle('CPU').getAttribute('aria-pressed'), 'true');
        assert.equal(await rows.count(), 0);
        for (const name of ['.zenfg-inspector-capture-details', '.zenfg-inspector-snapshot-details']) {
            const details = overview.locator(name);
            const summary = details.locator('summary');
            await summary.focus();
            await summary.press('Enter');
            assert.equal(await details.evaluate(el => el.open), true);
        }
        await setSnapshot(fullSnapshot);
        assert.equal(await toggle('CPU').getAttribute('aria-pressed'), 'true');
        assert.equal(await overview.locator('.zenfg-inspector-capture-details').evaluate(el => el.open), true);
        assert.equal(await overview.locator('.zenfg-inspector-snapshot-details').evaluate(el => el.open), true);

        const withCpu = structuredClone(fullSnapshot);
        withCpu.timings.cpu = {
            status: 'available', executionDurationMicros: 100,
            nodes: [{ nodeId: 'node:scene', durationMicros: 40 }, { nodeId: 'node:external', durationMicros: 50 }, { nodeId: 'node:present', durationMicros: 10 }],
        };
        await setSnapshot(withCpu);
        assert.match(await value('cpu'), /0\.100\s*ms/);
        assert.equal(await rows.first().getAttribute('data-node-id'), 'node:external');
        assert.match(await rows.first().innerText(), /50(?:\.0)?%/);
        await toggle('GPU').click();

        // A hotspot uses the same selection/reveal path as other Inspector views.
        await rows.first().getByRole('button', { name: 'scene', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('.zenfg-inspector-passes-view tr[data-selection-key="node:node:scene"]').evaluate(el => el.classList.contains('selected')), true);
        const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
        const closeInspector = page.getByRole('button', { name: 'Close inspector', exact: true });
        if (await closeInspector.isVisible()) await closeInspector.click();
        assert.equal(await inspector.isVisible(), true);
        await page.setViewportSize({ width: 390, height: 844 });
        await settle();
        assert.equal(await inspector.locator('.zenfg-inspector-button-label').isVisible(), false);
        assert.equal(await inspector.locator('svg[aria-hidden="true"]').count(), 1);
        assert.ok(await inspector.getAttribute('title'));
        await inspector.focus();
        await inspector.press('Enter');
        assert.equal(await closeInspector.isVisible(), true);
        await closeInspector.click();

        // View all clears filters/subview while retaining the chosen sort order.
        await page.getByRole('combobox', { name: 'Sort passes', exact: true }).selectOption('cpu');
        await page.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true }).fill('missing');
        await page.getByRole('combobox', { name: 'Pass kind', exact: true }).selectOption('compute');
        await page.getByRole('combobox', { name: 'Pass compile state', exact: true }).selectOption('culled');
        await page.getByRole('tab', { name: 'Group Hierarchy', exact: true }).click();
        await openOverview();
        await overview.getByRole('button', { name: 'View all passes', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Pass List', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true }).inputValue(), '');
        assert.equal(await page.getByRole('combobox', { name: 'Pass kind', exact: true }).inputValue(), 'all');
        assert.equal(await page.getByRole('combobox', { name: 'Pass compile state', exact: true }).inputValue(), 'all');
        assert.equal(await page.getByRole('combobox', { name: 'Sort passes', exact: true }).inputValue(), 'cpu');
        await openOverview();
        await overview.locator('.zenfg-inspector-capture-details > summary').click();
        await overview.locator('.zenfg-inspector-snapshot-details > summary').click();
        await overview.evaluate(el => { el.scrollTop = 0; });
        for (const [label, tab] of [['View resources', 'Resources'], ['View memory', 'Memory'], ['View diagnostics', 'Diagnostics']]) {
            await overview.getByRole('button', { name: label, exact: true }).click();
            assert.equal(await page.getByRole('tab', { name: tab, exact: true }).getAttribute('aria-selected'), 'true');
            await openOverview();
        }
        await setSnapshot(fullSnapshot);

        // Container width, rather than the surrounding browser page, determines layout.
        for (const [width, height] of [[1277, 920], [800, 920], [390, 844], [390, 480]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(height => { themeQA.host.style.height = height + 'px'; }, height);
            for (const mode of ['dark', 'light', 'custom']) {
                await page.evaluate(mode => {
                    themeQA.host.style.removeProperty('--zfgi-text');
                    themeQA.host.style.removeProperty('--zfgi-accent');
                    delete themeQA.host.dataset.zfgiTheme;
                    if (mode === 'custom') {
                        themeQA.inspector.setTheme(null);
                        themeQA.host.dataset.zfgiTheme = 'tokyo-night-light';
                        themeQA.host.style.setProperty('--zfgi-text', '#234567');
                        themeQA.host.style.setProperty('--zfgi-accent', '#945ab1');
                        themeQA.inspector.refreshTheme();
                    } else themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight);
                }, mode);
                await settle();
                const layout = await overview.evaluate(el => {
                    const count = selector => getComputedStyle(el.querySelector(selector)).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
                    return { kpis: count('.zenfg-inspector-overview-kpis'), columns: count('.zenfg-inspector-overview-columns'), overflowY: getComputedStyle(el).overflowY };
                });
                assert.equal(layout.kpis, width >= 1000 ? 4 : width >= 600 ? 2 : 1, `${width}/${height}/${mode}: KPI columns`);
                assert.equal(layout.columns, width >= 1000 ? 2 : 1, `${width}/${height}/${mode}: lower columns`);
                assert.equal(layout.overflowY, 'auto');
                if (mode === 'custom') assert.equal(await metric('gpu').evaluate(el => getComputedStyle(el).color), 'rgb(35, 69, 103)', 'overview inherits custom host text');
                await expectNoOverflow(`${width}/${height}/${mode}`);
                for (const label of ['Import', 'Export']) {
                    const button = page.getByRole('button', { name: label, exact: true });
                    assert.ok(await button.locator('svg[aria-hidden="true"]').count());
                    assert.ok(await button.getAttribute('title'));
                    await button.focus();
                    assert.equal(await button.evaluate(el => el === document.activeElement), true);
                    assert.equal(await button.locator('.zenfg-inspector-button-label').isVisible(), width > 720);
                }
                await page.getByRole('button', { name: 'Export', exact: true }).press('Enter');
                assert.equal(await page.getByRole('menuitem', { name: 'Download JSON', exact: true }).isVisible(), true);
                await page.getByRole('menuitem', { name: 'Download JSON', exact: true }).press('Escape');
                assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).evaluate(el => el === document.activeElement), true);
                await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-overview-redesign.png`), animations: 'disabled' });
            }
        }
        assert.ok(await overview.evaluate(el => el.scrollHeight > el.clientHeight), '390 × 480 overview scrolls');
        await overview.hover();
        await page.mouse.wheel(0, 10000);
        await page.waitForFunction(() => {
            const el = document.querySelector('.zenfg-inspector-overview-view');
            return el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        });

        const zero = structuredClone(withCpu);
        zero.timings.gpu = { status: 'available', frameSpanMicros: 0, nodes: [{ nodeId: 'node:scene', durationMicros: 0 }, { nodeId: 'node:present', durationMicros: 0 }] };
        zero.timings.cpu = { status: 'available', executionDurationMicros: 0, nodes: withCpu.timings.cpu.nodes.map(entry => ({ ...entry, durationMicros: 0 })) };
        zero.memory.poolReport = { status: 'available', acquireCount: 0, reuseCount: 0, createdCount: 0, retainedCount: 0, estimatedRetainedBytes: 0 };
        await setSnapshot(zero);
        assert.match(await value('gpu'), /0\.000\s*ms/);
        assert.match(await value('cpu'), /0\.000\s*ms/);
        assert.equal(await rows.count(), 2, 'measured zero-duration passes remain visible');
        assert.ok((await rows.allInnerTexts()).every(text => text.includes('—') && !text.includes('NaN')), 'zero total has no invented percentages');

        const partial = structuredClone(fullSnapshot);
        partial.timings.gpu.nodes = [partial.timings.gpu.nodes[0]];
        delete partial.memory.allocationReport.allocations[0].estimatedByteSize;
        partial.graph.nodes[0].label = 'A'.repeat(300);
        await setSnapshot(partial);
        assert.equal(await rows.count(), 1);
        assert.match(await metric('gpu').innerText(), /1\s*\/\s*2|1 of 2/);
        assert.match(await value('memory'), /Unknown/i);
        await expectNoOverflow('partial capture and long pass name');
    } finally {
        await page.evaluate(() => {
            themeQA.host.style.height = '800px';
            themeQA.host.style.removeProperty('--zfgi-text');
            themeQA.host.style.removeProperty('--zfgi-accent');
            delete themeQA.host.dataset.zfgiTheme;
            themeQA.inspector.setTheme(null);
            themeQA.inspector.setSnapshot(themeQA.snapshot);
        });
        await page.setViewportSize({ width: 1277, height: 920 });
        await openOverview();
    }
}
