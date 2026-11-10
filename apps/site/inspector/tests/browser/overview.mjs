import assert from 'node:assert/strict';
import { resolve } from 'node:path';

function multiPassCapture(source) {
    const snapshot = structuredClone(source);
    const names = ['mesh.deferred.gbuffer', 'mesh.directional-shadow.depth.1', 'postfx.ssr.denoise', 'fsr-taau.upscale-accumulate', 'mesh.directional-shadow.depth.2'];
    const durations = [440, 321, 313, 293, 269, ...Array(32).fill(47), 51];
    const nodes = durations.map((_, index) => ({
        id: `node:timing-${index}`, label: names[index] ?? `lighting.additional-pass.${index}`,
        kind: index === 3 || index >= 26 ? 'compute' : 'render', sideEffect: true,
        recordingOrder: index, compileState: { status: 'retained', executionOrder: index },
    }));
    for (let index = 0; index < 3; index++) {
        const order = nodes.length;
        nodes.push({ id: `node:copy-${index}`, label: `copy.readback.${index}`, kind: 'copy', sideEffect: true,
            recordingOrder: order, compileState: { status: 'retained', executionOrder: order } });
    }
    snapshot.graph = { groups: snapshot.graph.groups, nodes, resources: snapshot.graph.resources, textureViews: snapshot.graph.textureViews, accesses: [], dependencies: [], roots: [],
        segments: [{ id: 'segment:timing', kind: 'frame-graph', order: 0, nodeIds: nodes.map(node => node.id) }] };
    snapshot.timings = { cpu: { status: 'unavailable', reason: 'not-requested' }, gpu: {
        status: 'available', frameSpanMicros: 3456,
        nodes: durations.map((durationMicros, index) => ({ nodeId: nodes[index].id, durationMicros })),
    } };
    snapshot.diagnostics = [];
    return snapshot;
}

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
    const resizeMain = async width => {
        await page.evaluate(width => {
            // Re-evaluate outer padding after a host breakpoint, without rounding
            // fractional CSS pixels through clientWidth.
            for (let attempt = 0; attempt < 3; attempt++) {
                const main = document.querySelector('.zenfg-inspector-main');
                const style = getComputedStyle(main);
                const inset = style.boxSizing === 'border-box' ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, property) => sum + parseFloat(style[property]), 0) : 0;
                const mainWidth = parseFloat(style.width) - inset;
                const hostWidth = parseFloat(getComputedStyle(themeQA.host).width);
                themeQA.host.style.width = `${hostWidth + width - mainWidth}px`;
            }
        }, width);
        await settle();
    };
    const expectNoOverflow = async label => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page horizontal overflow`);
        assert.ok(await overview.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: overview horizontal overflow`);
    };
    const readLayout = () => overview.evaluate(el => {
        const count = selector => getComputedStyle(el.querySelector(selector)).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
        const bounds = selector => {
            const box = el.querySelector(selector).getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const main = el.closest('.zenfg-inspector-main');
        const mainStyle = getComputedStyle(main);
        const mainInset = mainStyle.boxSizing === 'border-box' ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, property) => sum + parseFloat(mainStyle[property]), 0) : 0;
        return { mainWidth: parseFloat(mainStyle.width) - mainInset,
            kpis: count('.zenfg-inspector-overview-kpis'), columns: count('.zenfg-inspector-overview-columns'), overflowY: getComputedStyle(el).overflowY,
            summary: bounds('.zenfg-inspector-overview-summary'), timing: bounds('.zenfg-inspector-overview-timing-panel'), columnsBounds: bounds('.zenfg-inspector-overview-columns'),
            side: bounds('.zenfg-inspector-overview-side'), resources: bounds('.zenfg-inspector-overview-resources'), workCards: el.querySelectorAll('.zenfg-inspector-overview-work').length,
            resourceFacts: bounds('.zenfg-inspector-overview-allocations'), pool: bounds('.zenfg-inspector-overview-pool'),
            track: bounds('.zenfg-inspector-overview-timing-rows tr:first-child .zenfg-inspector-overview-bar'), fill: bounds('.zenfg-inspector-overview-timing-rows tr:first-child .zenfg-inspector-overview-bar > span'),
            name: bounds('.zenfg-inspector-overview-timing-rows tr:first-child .zenfg-inspector-overview-pass'),
            identity: bounds('.zenfg-inspector-overview-timing-rows tr:first-child .zenfg-inspector-timing-identity'),
            attributes: bounds('.zenfg-inspector-overview-timing-rows tr:first-child .zenfg-inspector-timing-attributes'),
            accessCopies: el.querySelector('.zenfg-inspector-overview-timing-rows tr:first-child').querySelectorAll('.zenfg-inspector-timing-accesses').length,
            firstRow: bounds('.zenfg-inspector-overview-timing-rows tr:first-child'),
            heading: bounds('.zenfg-inspector-overview-timing-panel h2'), coverage: bounds('.zenfg-inspector-overview-coverage'), scope: bounds('.zenfg-inspector-overview-scope-note'),
            share: bounds('.zenfg-inspector-overview-timing-rows tr:first-child .zenfg-inspector-timing-share-number'),
            contentLeft: (() => { const panel = el.querySelector('.zenfg-inspector-overview-timing-panel'); const style = getComputedStyle(panel); return panel.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft); })(),
            contentRight: (() => { const panel = el.querySelector('.zenfg-inspector-overview-timing-panel'); const style = getComputedStyle(panel); return panel.getBoundingClientRect().right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight); })(),
            table: bounds('.zenfg-inspector-overview-timings'),
            shareHeader: (() => { const cell = el.querySelector('th[data-timing-column="share"]'); const range = document.createRange(); range.selectNodeContents(cell); const box = range.getBoundingClientRect(); return { x: box.x, right: box.right }; })(),
            headerX: (() => { const cell = el.querySelector('th[data-timing-column="name"]'); if (getComputedStyle(cell).position === 'absolute') return undefined; const range = document.createRange(); range.selectNodeContents(cell); return range.getBoundingClientRect().x; })(),
            overviewBottom: el.getBoundingClientRect().bottom,
            tails: [...el.querySelectorAll('.zenfg-inspector-overview-pass-suffix')].map(tail => {
                const text = tail.firstChild;
                const lastCharacter = [...text.textContent].at(-1);
                const range = document.createRange();
                range.setStart(text, text.textContent.length - lastCharacter.length);
                range.setEnd(text, text.textContent.length);
                const box = range.getBoundingClientRect();
                const name = tail.closest('button').getBoundingClientRect();
                return { x: box.x, right: box.right, width: box.width, nameX: name.x, nameRight: name.right };
            }),
            ticks: [...el.querySelectorAll('.zenfg-inspector-timing-axis > span')].filter(tick => getComputedStyle(tick).display !== 'none').map(tick => {
                const box = tick.getBoundingClientRect();
                return { x: box.x, right: box.right };
            }).sort((a, b) => a.x - b.x) };
    });
    const expectLayout = (layout, label) => {
        const wide = layout.mainWidth >= 1000;
        assert.equal(layout.kpis, layout.mainWidth >= 900 ? 4 : 2, `${label}: KPI columns follow the main container`);
        assert.equal(layout.columns, wide ? 2 : 1, `${label}: analysis columns follow the main container`);
        assert.equal(layout.overflowY, 'auto');
        assert.ok(layout.columnsBounds.y >= layout.summary.bottom, `${label}: analysis follows the frame summary`);
        if (wide) {
            assert.ok(layout.timing.right <= layout.side.x && Math.abs(layout.timing.y - layout.side.y) <= 1, `${label}: timing and supporting facts sit side by side`);
            assert.ok(Math.abs(layout.timing.width / (layout.timing.width + layout.side.width) - 2 / 3) < 0.04, `${label}: timing receives approximately two thirds of the analysis width`);
            assert.ok(layout.pool.y >= layout.resourceFacts.bottom, `${label}: the narrow resources panel stacks facts and pool metrics`);
        } else {
            assert.ok(Math.abs(layout.timing.x - layout.summary.x) <= 1 && Math.abs(layout.timing.width - layout.summary.width) <= 1, `${label}: stacked timing analysis uses full content width`);
            assert.ok(layout.side.y >= layout.timing.bottom, `${label}: supporting facts follow timing when the main container is narrow`);
        }
        assert.equal(layout.workCards, 0, `${label}: the repeated work summary does not occupy a separate card`);
        assert.ok(Math.abs(layout.resources.y - layout.side.y) <= 1 && Math.abs(layout.resources.x - layout.side.x) <= 1 && Math.abs(layout.resources.width - layout.side.width) <= 1, `${label}: resources fill the supporting column`);
        assert.ok(layout.pool.y >= layout.resourceFacts.bottom || layout.resourceFacts.right <= layout.pool.x, `${label}: resource facts and pool metrics do not overlap`);
        assert.ok(layout.track.width > 20 && Math.abs(layout.fill.width / layout.track.width - 0.88) < 0.01, `${label}: visible time bars use the millisecond axis, not 13.8% share`);
        assert.ok(layout.name.right <= layout.track.x + 1 || layout.name.bottom <= layout.track.y + 1 || layout.track.bottom <= layout.name.y + 1, `${label}: pass label does not overlap the time chart`);
        assert.ok(Math.abs(layout.name.width - layout.identity.width) < 1 && layout.attributes.y >= layout.name.bottom - 1, `${label}: the pass name fills a separate line above its Kind and access counts`);
        assert.ok([layout.heading, layout.coverage, layout.scope, layout.name, layout.attributes].every(box => Math.abs(box.x - layout.contentLeft) < 1), `${label}: timing content shares the card's left edge`);
        if (layout.headerX !== undefined) assert.ok(Math.abs(layout.headerX - layout.contentLeft) < 1, `${label}: Pass header aligns with the card content`);
        assert.ok(Math.abs(layout.share.right - layout.contentRight) < 1, `${label}: Share aligns with the card's right edge`);
        if (layout.headerX !== undefined) assert.ok(layout.headerX - layout.table.x >= 7, `${label}: Pass has visible space inside the header background`);
        assert.ok(layout.table.right - layout.shareHeader.right >= 7, `${label}: Share has visible space inside the header background`);
        assert.equal(layout.accessCopies, 1, `${label}: access counts appear once per row`);
        assert.ok(layout.tails.length > 0 && layout.tails.every(tail => tail.width > 0 && tail.x >= tail.nameX - 1 && tail.right <= tail.nameRight + 1), `${label}: the final identifying character remains visible when a wide suffix crops from the left`);
        assert.ok(layout.ticks.length >= 2, `${label}: time axis retains visible start and end labels`);
        for (let index = 1; index < layout.ticks.length; index++) {
            assert.ok(layout.ticks[index - 1].right <= layout.ticks[index].x, `${label}: visible time-axis labels do not overlap`);
        }
    };

    try {
        await setSnapshot(fullSnapshot);
        await openOverview();
        assert.match(await value('gpu'), /1\.851\s*ms/);
        assert.equal(await value('cpu'), 'Not collected');
        assert.match(await metric('cpu').innerText(), /not (?:collected|captured|requested)/i);
        assert.match(await value('memory'), /7\.9\s*MiB/);
        assert.match(await value('passes'), /3/);
        assert.equal(await toggle('GPU').getAttribute('aria-pressed'), 'true');
        assert.equal(await rows.count(), 2);
        assert.equal(await overview.locator('[data-timing-column="order"]').count(), 0, 'Overview omits the execution-order column');
        assert.equal(await rows.first().getAttribute('data-node-id'), 'node:scene');
        assert.match(await rows.first().innerText(), /88\.6%/);
        assert.match(await overview.innerText(), /1\.591\s*ms/);
        assert.match(await overview.innerText(), /external/i);
        assert.equal(await overview.locator('.zenfg-inspector-overview-timing-totals [data-part="other"]').count(), 0);
        assert.equal(await overview.locator('.zenfg-inspector-overview-timing-summary').count(), 0, 'no redundant Top N total when every measured pass is displayed');
        assert.match(await overview.locator('.zenfg-inspector-overview-scope-note').innerText(), /Share of measured pass sum/);
        assert.equal(await metric('gpu').locator('.zenfg-inspector-overview-note').count(), 0);
        assert.equal(await metric('memory').locator('.zenfg-inspector-overview-note').count(), 0);
        assert.equal(await overview.getByRole('heading', { name: 'Work composition', exact: true }).count(), 0);
        await metric('passes').getByRole('button', { name: '1 Culled', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).evaluate(el => el === document.activeElement), true, 'Culled navigation leaves focus on the visible destination tab');
        assert.equal(await page.getByRole('combobox', { name: 'Pass compile state', exact: true }).inputValue(), 'culled');
        await openOverview();
        await overview.getByRole('button', { name: 'View all passes', exact: true }).click();
        assert.equal(await page.getByRole('combobox', { name: 'Pass compile state', exact: true }).inputValue(), 'all');
        await openOverview();

        // A user-selected metric and both disclosure states survive a capture refresh.
        await toggle('CPU').click();
        assert.equal(await toggle('CPU').getAttribute('aria-pressed'), 'true');
        await setSnapshot(fullSnapshot);
        assert.equal(await toggle('CPU').evaluate(el => el === document.activeElement), true, 'capture refresh retains timing-source focus');
        assert.equal(await rows.count(), 0);
        assert.equal(await overview.locator('.zenfg-inspector-timing-axis').count(), 0);
        assert.equal(await overview.locator('.zenfg-inspector-overview-timing-summary').count(), 0);
        for (const name of ['.zenfg-inspector-capture-details', '.zenfg-inspector-snapshot-details']) {
            const details = overview.locator(name);
            const summary = details.locator('summary');
            await summary.focus();
            await summary.press('Enter');
            assert.equal(await details.evaluate(el => el.open), true);
        }
        const snapshotDetails = overview.locator('.zenfg-inspector-snapshot-details');
        assert.match(await snapshotDetails.innerText(), /Frame-graph segments\s*2/);
        assert.match(await snapshotDetails.innerText(), /External boundaries\s*1/);
        assert.match(await snapshotDetails.innerText(), /Groups\s*2/);
        await setSnapshot(fullSnapshot);
        assert.equal(await toggle('CPU').getAttribute('aria-pressed'), 'true');
        assert.equal(await snapshotDetails.locator('summary').evaluate(el => el === document.activeElement), true, 'capture refresh retains disclosure focus');
        assert.equal(await overview.locator('.zenfg-inspector-capture-details').evaluate(el => el.open), true);
        assert.equal(await overview.locator('.zenfg-inspector-snapshot-details').evaluate(el => el.open), true);

        const withCpu = structuredClone(fullSnapshot);
        withCpu.timings.cpu = {
            status: 'available', executionDurationMicros: 100,
            nodes: [{ nodeId: 'node:scene', durationMicros: 40 }, { nodeId: 'node:external', durationMicros: 50 }, { nodeId: 'node:present', durationMicros: 10 }],
        };
        await page.getByRole('button', { name: 'Export', exact: true }).focus();
        await setSnapshot(withCpu);
        assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).evaluate(el => el === document.activeElement), true, 'capture refresh leaves command-bar focus alone');
        assert.match(await value('cpu'), /0\.100\s*ms/);
        assert.equal(await rows.first().getAttribute('data-node-id'), 'node:external');
        assert.match(await rows.first().innerText(), /50(?:\.0)?%/);
        await toggle('GPU').click();

        // A hotspot uses the same selection/reveal path as other Inspector views.
        await rows.first().getByRole('button', { name: 'scene', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByRole('tab', { name: 'Passes', exact: true }).evaluate(el => el === document.activeElement), true, 'pass reveal leaves focus on the visible destination tab');
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
        await page.getByRole('combobox', { name: 'Sort passes', exact: true }).selectOption('time');
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
        assert.equal(await page.getByRole('combobox', { name: 'Sort passes', exact: true }).inputValue(), 'time');
        await openOverview();
        await overview.locator('.zenfg-inspector-capture-details > summary').click();
        await overview.locator('.zenfg-inspector-snapshot-details > summary').click();
        await overview.evaluate(el => { el.scrollTop = 0; });
        for (const [label, tab] of [['View resources', 'Resources'], ['View memory', 'Memory'], ['View diagnostics', 'Diagnostics']]) {
            await overview.getByRole('button', { name: label, exact: true }).click();
            assert.equal(await page.getByRole('tab', { name: tab, exact: true }).getAttribute('aria-selected'), 'true');
            await openOverview();
        }
        const multiPass = multiPassCapture(fullSnapshot);
        await setSnapshot(multiPass);
        assert.equal(await metric('passes').getByRole('button', { name: /Culled/i }).count(), 0, 'no culled navigation occupies space when no pass was culled');
        assert.doesNotMatch(await metric('passes').innerText(), /culled/i);
        assert.equal(await rows.count(), 5);
        assert.deepEqual(await rows.evaluateAll(elements => elements.map(el => el.dataset.nodeId)), [0, 1, 2, 3, 4].map(index => `node:timing-${index}`));
        assert.match(await rows.first().innerText(), /0\.440\s*ms.*13\.8%/s);
        assert.match(await overview.locator('.zenfg-inspector-overview-coverage').innerText(), /3\.191\s*ms.*38\/38/);
        assert.equal(await overview.locator('.zenfg-inspector-overview-timings').getAttribute('data-max-micros'), '500');
        assert.match(await overview.locator('.zenfg-inspector-timing-axis').innerText(), /0\.5(?:0+)?\s*ms/);
        assert.match(await overview.locator('.zenfg-inspector-overview-timing-totals [data-part="top"]').innerText(), /5.*1\.636\s*ms.*51\.3%/s);
        assert.match(await overview.locator('.zenfg-inspector-overview-timing-totals [data-part="other"]').innerText(), /33.*1\.555\s*ms.*48\.7%/s);
        const resources = overview.locator('.zenfg-inspector-overview-resources');
        assert.equal(await resources.locator('.zenfg-inspector-overview-report-state').count(), 0, 'available allocation and pool reports are present in layout screenshots');
        assert.match(await resources.innerText(), /Logical resources\s*3\s*2 textures\s*·\s*1 buffers?/);
        assert.match(await resources.innerText(), /Cumulative reuse\s*66\.7%/);
        assert.match(await resources.innerText(), /Idle retained estimate\s*7\.9 MiB\s*1 allocation/);

        // Keep the browser wide while resizing the embedded host across the exact
        // main-container breakpoint; overview padding must not move the threshold.
        await page.setViewportSize({ width: 1280, height: 920 });
        await page.evaluate(() => {
            themeQA.host.style.height = '920px';
            themeQA.inspector.setTheme(themeQA.tokyoNightStorm);
        });
        for (const mainWidth of [599.5, 600, 601, 899, 899.5, 900, 999, 999.5, 1000]) {
            await resizeMain(mainWidth);
            await overview.evaluate(el => { el.scrollTop = 0; });
            const layout = await readLayout();
            assert.equal(await page.evaluate(() => innerWidth), 1280, 'the host-resize check keeps the browser width unchanged');
            assert.ok(Math.abs(layout.mainWidth - mainWidth) < 0.5, `main container reaches ${mainWidth}px independently of the browser`);
            expectLayout(layout, `1280 browser / ${mainWidth} main`);
            await expectNoOverflow(`1280 browser / ${mainWidth} main`);
            await page.screenshot({ path: resolve(output, `dark-1280-main-${mainWidth}-overview-layout.png`), animations: 'disabled' });
        }

        // Wide glyphs and microsecond timings expose clipping that ordinary
        // ASCII names and a 0.5 ms axis cannot exercise.
        const edgeCases = [
            ...[599.5, 600, 601].map(width => [width, 440, false]),
            ...[320, 899, 900, 1000].map(width => [width, 440, true]),
            ...[600, 1000].flatMap(width => [4.4, 0.44, 0.044].map(maximum => [width, maximum, false])),
        ];
        for (const [mainWidth, maximum, largeType] of edgeCases) {
            const edge = structuredClone(multiPass);
            edge.graph.nodes[1].label = `${'中文名称'.repeat(40)}.depth.1`;
            edge.graph.nodes[2].label = `${'😀'.repeat(60)}1`;
            edge.graph.nodes[4].label = `${'A'.repeat(300)}.depth.2`;
            const scale = maximum / 440;
            edge.timings.gpu.frameSpanMicros *= scale;
            for (const entry of edge.timings.gpu.nodes) entry.durationMicros *= scale;
            await page.evaluate(largeType => themeQA.inspector.setTheme({ ...themeQA.tokyoNightStorm, variables: {
                ...themeQA.tokyoNightStorm.variables,
                '--zfgi-font-size': largeType ? '16px' : '13px',
                '--zfgi-font-size-small': largeType ? '14px' : '12px',
            } }), largeType);
            await setSnapshot(edge);
            await resizeMain(mainWidth);
            const label = `${mainWidth}px main / ${maximum} µs / ${largeType ? '16/14' : '13/12'}px type`;
            const layout = await readLayout();
            assert.ok(Math.abs(layout.mainWidth - mainWidth) < 0.05, `${label}: exact embedded width`);
            expectLayout(layout, label);
            await expectNoOverflow(label);
        }
        await setSnapshot(multiPass);
        await page.evaluate(() => themeQA.inspector.setTheme(themeQA.tokyoNightStorm));
        await page.evaluate(() => { themeQA.host.style.width = '100%'; });

        // Container width, rather than the surrounding browser page, determines layout.
        for (const [width, height] of [[1280, 920], [1277, 920], [1024, 920], [800, 920], [390, 844], [320, 844], [390, 480]]) {
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
                await overview.evaluate(el => { el.scrollTop = 0; });
                const layout = await readLayout();
                expectLayout(layout, `${width}/${height}/${mode}`);
                const unknownSize = await metric('cpu').locator('.zenfg-inspector-overview-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
                const measuredSize = await metric('gpu').locator('.zenfg-inspector-overview-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
                assert.ok(unknownSize < measuredSize * 0.8, `${width}/${height}/${mode}: unavailable status uses secondary type size`);
                if (width <= 390 && height === 844) {
                    assert.ok(layout.firstRow.bottom <= Math.min(layout.overviewBottom, height), `${width}/${height}/${mode}: the first pass name, chart and values fit in the initial viewport`);
                }
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
                if (width < 600) {
                    await overview.evaluate(el => {
                        const panel = el.querySelector('.zenfg-inspector-overview-timing-panel');
                        el.scrollTop += panel.getBoundingClientRect().top - el.getBoundingClientRect().top;
                    });
                    await settle();
                    await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-overview-timing.png`), animations: 'disabled' });
                }
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
        assert.equal(await overview.locator('.zenfg-inspector-overview-timing-composition').count(), 0, 'zero total has no invented composition');

        const unavailable = structuredClone(multiPass);
        unavailable.memory = { allocationReport: { status: 'unavailable', reason: 'not-requested' }, poolReport: { status: 'unavailable', reason: 'not-requested' } };
        for (const resource of unavailable.graph.resources) delete resource.allocationId;
        await setSnapshot(unavailable);
        assert.equal(await value('memory'), 'Unavailable');
        assert.equal(await metric('memory').locator('.zenfg-inspector-overview-note').count(), 0);
        assert.equal(await resources.locator('.zenfg-inspector-overview-allocations .zenfg-inspector-overview-report-state').count(), 1);
        assert.equal(await resources.locator('.zenfg-inspector-overview-pool .zenfg-inspector-overview-report-state').count(), 1);
        assert.equal(await resources.locator('.zenfg-inspector-overview-pool dl').count(), 0);
        assert.equal(await resources.getByText('Physical allocations', { exact: true }).count(), 0);
        await expectNoOverflow('unavailable report group states');
        await page.screenshot({ path: resolve(output, 'custom-390-480-overview-unavailable.png'), animations: 'disabled' });

        const partial = structuredClone(fullSnapshot);
        partial.timings.gpu.nodes = [partial.timings.gpu.nodes[0]];
        delete partial.memory.allocationReport.allocations[0].estimatedByteSize;
        partial.graph.nodes[0].label = 'A'.repeat(300);
        await setSnapshot(partial);
        assert.equal(await rows.count(), 1);
        assert.match(await metric('gpu').innerText(), /Pass timing partial/);
        assert.doesNotMatch(await metric('gpu').innerText(), /1\s*\/\s*2|1 of 2/);
        assert.match(await overview.locator('.zenfg-inspector-overview-coverage').innerText(), /Partial.*1\/2/);
        assert.match(await value('memory'), /Unknown/i);
        assert.match(await metric('memory').innerText(), /0\/1 sizes known/);
        assert.equal(await metric('memory').locator('.zenfg-inspector-overview-value').getAttribute('data-state'), 'unknown');
        const unknownMemorySize = await metric('memory').locator('.zenfg-inspector-overview-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        const measuredGpuSize = await metric('gpu').locator('.zenfg-inspector-overview-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(unknownMemorySize < measuredGpuSize * 0.8, 'unknown memory estimate uses secondary type size');
        await expectNoOverflow('partial capture and long pass name');
    } finally {
        await page.evaluate(() => {
            themeQA.host.style.height = '800px';
            themeQA.host.style.width = '100%';
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
