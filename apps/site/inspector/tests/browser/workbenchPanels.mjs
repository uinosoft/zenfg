import assert from 'node:assert/strict';
import { resolve } from 'node:path';

function passAnalysisSnapshot(source) {
    const snapshot = structuredClone(source);
    const labels = ['mesh.directional-shadow.depth.1', `${'中文名称'.repeat(30)}.depth.2`, `${'😀'.repeat(60)}1`, 'copy.resolve', 'external.queue', 'mesh.unmeasured'];
    const groups = ['same-a', 'child-a', 'same-b', 'branch-a', 'branch-b', 'same-a'];
    const nodes = labels.map((label, order) => ({ id: `node:pass-analysis:${order}`, label,
        kind: order === 2 ? 'compute' : order === 3 ? 'copy' : order === 4 ? 'external-submission' : 'render',
        groupId: `group:pass-analysis:${groups[order]}`, recordingOrder: order, sideEffect: true,
        compileState: { status: 'retained', executionOrder: order } }));
    nodes.push({ id: 'node:pass-analysis:culled', label: 'unused-pass.depth.3', kind: 'render', groupId: 'group:pass-analysis:same-a',
        recordingOrder: 6, sideEffect: false, compileState: { status: 'culled', reason: 'not-reachable-from-root' } });
    snapshot.graph.groups.push(...[
        ['branch-a', 'Branch A'], ['branch-b', 'Branch B'], ['same-a', 'Same', 'branch-a'],
        ['child-a', 'Child', 'same-a'], ['same-b', 'Same', 'branch-b'],
    ].map(([id, label, parent]) => ({ id: `group:pass-analysis:${id}`, label, ...(parent ? { parentId: `group:pass-analysis:${parent}` } : {}) })));
    snapshot.graph = { ...snapshot.graph, nodes, accesses: [], dependencies: [], roots: [], segments: [
        { id: 'segment:pass-analysis:0', kind: 'frame-graph', order: 0, nodeIds: nodes.slice(0, 4).map(node => node.id) },
        { id: 'segment:pass-analysis:external', kind: 'external-submission', order: 1, nodeIds: [nodes[4].id] },
        { id: 'segment:pass-analysis:1', kind: 'frame-graph', order: 2, nodeIds: [nodes[5].id] },
    ] };
    snapshot.graph.accesses = source.graph.accesses.filter(access => access.resourceId === 'resource:scene-color').slice(0, 2)
        .map((access, index) => ({ ...access, id: `access:pass-analysis:${index}`, nodeId: nodes[index].id }));
    snapshot.timings = {
        cpu: { status: 'available', executionDurationMicros: 2900, nodes: [1300, 200, 300, 400, 500].map((durationMicros, index) => ({ nodeId: nodes[index].id, durationMicros })) },
        gpu: { status: 'available', frameSpanMicros: 100, nodes: [20, 44, 11].map((durationMicros, index) => ({ nodeId: nodes[index].id, durationMicros })) },
    };
    snapshot.diagnostics = [];
    return snapshot;
}

// Real DOM acceptance for list reflow, allocation folds and the selection pane.
export async function checkWorkbenchPanels(page, output, fullSnapshot, aliasSnapshot) {
    const original = await page.evaluate(() => themeQA.snapshot);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const close = async () => {
        const button = page.getByRole('button', { name: 'Close inspector', exact: true });
        if (await button.isVisible()) await button.click();
    };
    const setSnapshot = async snapshot => { await page.evaluate(snapshot => themeQA.inspector.setSnapshot(snapshot), snapshot); await settle(); };
    const openView = async name => { await page.getByRole('tab', { name, exact: true }).first().click(); await settle(); };
    const within = async (locator, container, label) => {
        const rect = await locator.boundingBox(); const bounds = await container.boundingBox();
        assert.ok(rect && bounds && rect.width > 0 && rect.x >= bounds.x - 1 && rect.x + rect.width <= bounds.x + bounds.width + 1, `${label}: key data remains in the content width`);
    };
    const noOverflow = async label => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page overflow`);
        assert.ok(await page.locator('.zenfg-inspector-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: main overflow`);
    };
    try {
        await close(); await setSnapshot(fullSnapshot);
        await openView('Passes');
        const passes = page.locator('.zenfg-inspector-passes-view');
        const sourceButton = source => passes.locator('.zenfg-inspector-timing-switch').getByRole('button', { name: source, exact: true });
        await sourceButton('GPU').click();
        await passes.getByRole('combobox', { name: 'Sort passes', exact: true }).selectOption('time');
        assert.equal(await passes.locator('tr[data-selection-key]').first().getAttribute('data-selection-key'), 'node:node:scene');
        await passes.getByRole('button', { name: 'scene', exact: true }).click();
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        const details = page.locator('.zenfg-inspector-inspector');
        assert.match(await details.innerText(), /GPU.*1\.410/s);
        assert.match(await details.innerText(), /CPU.*Not collected/s);
        await within(passes.locator('tr[data-selection-key]').first().locator('[data-timing-column="time"]'), passes, 'open dock GPU');
        await page.getByRole('tab', { name: 'Raw', exact: true }).click();
        const rawSearch = details.getByRole('searchbox', { name: 'Search Raw fields or values', exact: true });
        await rawSearch.fill('scene');
        assert.ok(await details.locator('mark').count() > 0);
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await page.getByRole('tab', { name: 'Raw', exact: true }).click();
        assert.equal(await rawSearch.inputValue(), 'scene');
        await rawSearch.press('Escape');
        assert.equal(await rawSearch.inputValue(), '');
        await close();

        // Timing graphics and group drill-downs use capture-wide domains even
        // when the visible rows are restricted by search or group scope.
        const analysis = passAnalysisSnapshot(fullSnapshot);
        await setSnapshot(analysis);
        const passTable = passes.locator('.zenfg-inspector-pass-table');
        const passRows = passTable.locator('tbody tr[data-selection-key]');
        const firstPass = () => passTable.locator('tbody tr[data-selection-key="node:node:pass-analysis:0"]');
        const sortPasses = passes.getByRole('combobox', { name: 'Sort passes', exact: true });
        const searchPasses = passes.getByRole('searchbox', { name: 'Search pass, ID or group', exact: true });
        const passStatus = passes.getByRole('combobox', { name: 'Pass compile state', exact: true });
        await sourceButton('GPU').click();
        await sortPasses.selectOption('order');
        assert.equal(await passTable.locator('thead th').count(), 5);
        assert.equal(await passTable.getAttribute('data-source'), 'gpu');
        assert.equal(await passTable.getAttribute('data-max-micros'), '50');
        assert.equal(await passRows.count(), 7);
        assert.equal(await firstPass().locator('.zenfg-inspector-timing-number').innerText(), '0.020');
        assert.equal(await firstPass().locator('.zenfg-inspector-timing-percentage').innerText(), '26.7%');
        const series = async () => ({ source: await passTable.getAttribute('data-source'), maximum: await passTable.getAttribute('data-max-micros'),
            duration: await firstPass().locator('.zenfg-inspector-timing-number').innerText(), share: await firstPass().locator('.zenfg-inspector-timing-percentage').innerText(),
            width: await firstPass().locator('.zenfg-inspector-timing-bar > span').evaluate(el => el.style.width) });
        const fullSeries = await series();
        assert.equal(fullSeries.width, '40%');
        assert.equal(await firstPass().locator('.zenfg-inspector-timing-bar').count(), 1);
        assert.equal(await firstPass().locator('.zenfg-inspector-timing-kind').innerText(), 'Render');
        assert.equal(await firstPass().locator('.zenfg-inspector-timing-accesses').count(), 1, 'each pass presents its access counts once');
        assert.equal(await firstPass().locator('.zenfg-inspector-timing-attributes .zenfg-inspector-timing-access-count').count(), 2);
        assert.equal(await firstPass().locator('[data-timing-column="order"]').innerText(), '0');
        assert.equal(await passTable.locator('.zenfg-inspector-list-group-path, .zenfg-inspector-pass-identity').count(), 0, 'row identities do not repeat group paths or order metadata');
        assert.equal(await passes.locator('.zenfg-inspector-pass-matched').isVisible(), false, 'unfiltered rows do not repeat capture totals');
        await searchPasses.fill('mesh.directional-shadow.depth.1');
        assert.equal(await passRows.count(), 1);
        assert.deepEqual(await series(), fullSeries, 'search leaves the selected timing domain and percentages unchanged');
        assert.match(await passes.locator('.zenfg-inspector-pass-matched').innerText(), /GPU.*0\.020 ms.*26\.7%/);
        await passes.getByRole('button', { name: 'Clear filters', exact: true }).click();
        await sortPasses.selectOption('time');
        assert.deepEqual(await series(), fullSeries, 'time sorting leaves the explicitly selected GPU source unchanged');
        assert.equal(await passRows.first().getAttribute('data-selection-key'), 'node:node:pass-analysis:1');
        await sortPasses.selectOption('order');
        assert.deepEqual(await series(), fullSeries, 'execution order leaves the selected GPU source unchanged');
        await sourceButton('CPU').click();
        assert.equal((await series()).duration, '1.300');
        assert.equal((await series()).width, '65%');
        assert.equal((await series()).share, '48.1%');
        await openView('Overview');
        assert.equal(await page.locator('.zenfg-inspector-overview-view').getByRole('button', { name: 'CPU', exact: true }).getAttribute('aria-pressed'), 'true', 'Overview shares the explicit source choice');
        await openView('Passes');
        assert.equal(await sourceButton('CPU').getAttribute('aria-pressed'), 'true');
        assert.equal(await passTable.locator('tr[data-selection-key="node:node:pass-analysis:5"] .zenfg-inspector-timing-state').innerText(), 'Not collected');
        await sourceButton('GPU').click();
        assert.equal(await passTable.locator('tr[data-selection-key="node:node:pass-analysis:4"] .zenfg-inspector-timing-state').innerText(), 'Opaque');
        await openView('Overview');
        assert.equal(await page.locator('.zenfg-inspector-overview-view').getByRole('button', { name: 'GPU', exact: true }).getAttribute('aria-pressed'), 'true');
        await openView('Passes');

        await passStatus.selectOption('culled');
        assert.equal(await passRows.first().locator('[data-timing-column="order"]').innerText(), '—');
        assert.equal(await passRows.count(), 1);
        assert.equal(await passTable.locator('tbody [data-timing]').count(), 0);
        assert.equal(await passTable.getByRole('columnheader', { name: 'Culled reason', exact: true }).count(), 1);
        assert.match(await passRows.first().locator('.zenfg-inspector-pass-reason').innerText(), /Not executed.*not-reachable-from-root/);
        assert.equal(await passRows.first().locator('.zenfg-inspector-pass-reason').getAttribute('colspan'), '3');
        await passes.getByRole('button', { name: 'Clear filters', exact: true }).click();
        await passes.getByRole('tab', { name: 'Group Hierarchy', exact: true }).click();
        await passes.getByRole('button', { name: 'View passes in group Branch A / Same', exact: true }).press('Enter');
        const groupScope = passes.locator('.zenfg-inspector-pass-scope');
        assert.match(await groupScope.innerText(), /Branch A \/ Same.*includes subgroups/s);
        assert.equal(await passRows.count(), 4, 'group scope contains descendants and culled passes');
        await setSnapshot(analysis);
        assert.equal(await groupScope.isVisible(), true, 'group scope survives capture refresh');
        assert.equal(await passRows.count(), 4);
        await searchPasses.fill('mesh.directional-shadow.depth.1');
        await groupScope.getByRole('button', { name: 'Clear group scope', exact: true }).press('Enter');
        assert.equal(await searchPasses.inputValue(), 'mesh.directional-shadow.depth.1', 'clearing scope leaves ordinary filters intact');
        await passes.getByRole('button', { name: 'Clear filters', exact: true }).click();
        await passes.getByRole('tab', { name: 'Group Hierarchy', exact: true }).click();
        await passes.getByRole('button', { name: 'View passes in group Branch B / Same', exact: true }).press('Enter');
        assert.equal(await passRows.count(), 1, 'identically named groups use their distinct paths and IDs');
        assert.equal(await passRows.first().getAttribute('data-selection-key'), 'node:node:pass-analysis:2');
        await groupScope.getByRole('button', { name: 'Clear group scope', exact: true }).click();
        await sortPasses.selectOption('time');
        for (const width of [1877, 1277, 800, 390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await settle();
            const name = firstPass().getByRole('button', { name: 'mesh.directional-shadow.depth.1', exact: true });
            await name.focus();
            await setSnapshot(analysis);
            assert.equal(await name.evaluate(el => el === document.activeElement), true, `${width}: capture refresh retains pass keyboard focus`);
            assert.equal(await name.evaluate(el => getComputedStyle(el).display), 'flex', `${width}: old multiline name rules do not hide identifying suffixes`);
            assert.ok(await passTable.locator('.zenfg-inspector-pass-name-suffix').evaluateAll(tails => tails.every(tail => {
                const text = tail.firstChild; const last = [...text.textContent].at(-1); const range = document.createRange();
                range.setStart(text, text.textContent.length - last.length); range.setEnd(text, text.textContent.length);
                const rect = range.getBoundingClientRect(); const bounds = tail.closest('button').getBoundingClientRect();
                return rect.width > 0 && rect.x >= bounds.x - 1 && rect.right <= bounds.right + 1 && rect.y >= bounds.y - 1 && rect.bottom <= bounds.bottom + 1;
            })), `${width}: Unicode pass suffixes retain their last identifying character`);
            for (const state of ['closed', 'open']) {
                if (state === 'open') { await name.press('Enter'); await settle(); }
                await within(firstPass().locator('[data-timing-column="time"]'), passes, `${width}/${state}: selected timing remains visible`);
                const geometry = await firstPass().evaluate(row => {
                    const bounds = el => { const rect = el.getBoundingClientRect(); return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, centerY: rect.y + rect.height / 2 }; };
                    const table = row.closest('table'); const main = row.closest('.zenfg-inspector-main');
                    return { mainWidth: parseFloat(getComputedStyle(main).width), containerWidth: parseFloat(getComputedStyle(main).width), table: bounds(table), name: bounds(row.querySelector('[data-timing-column="name"]')),
                        nameButton: bounds(row.querySelector('.zenfg-inspector-timing-name')), identity: bounds(row.querySelector('.zenfg-inspector-timing-identity')),
                        attributes: bounds(row.querySelector('.zenfg-inspector-timing-attributes')), order: bounds(row.querySelector('[data-timing-column="order"]')),
                        bar: bounds(row.querySelector('.zenfg-inspector-timing-bar')), time: bounds(row.querySelector('[data-timing-column="time"]')),
                        share: bounds(row.querySelector('[data-timing-column="share"]')), axis: bounds(table.querySelector('.zenfg-inspector-timing-axis')),
                        orderHeader: bounds(table.querySelector('th[data-timing-column="order"]')) };
                });
                assert.ok(Math.abs(geometry.time.centerY - geometry.bar.centerY) < 1 && Math.abs(geometry.share.centerY - geometry.bar.centerY) < 1, `${width}/${state}: bar, time and share have aligned vertical centers`);
                assert.ok(Math.abs(geometry.axis.x - geometry.bar.x) < 1 && Math.abs(geometry.axis.width - geometry.bar.width) < 1, `${width}/${state}: the common axis aligns with row bars`);
                const expectedName = geometry.mainWidth < 600 ? geometry.table.width - 60 : Math.min(360, Math.max(220, geometry.containerWidth * 0.32));
                assert.ok(Math.abs(geometry.name.width - expectedName) < 2, `${width}/${state}: the name column follows its bounded width (${geometry.name.width} vs ${expectedName}, table ${geometry.table.width}, main ${geometry.mainWidth})`);
                assert.ok(Math.abs(geometry.nameButton.width - geometry.identity.width) < 1 && geometry.attributes.y >= geometry.nameButton.bottom - 1, `${width}/${state}: the name fills its own line above Kind and Read/Write`);
                if (geometry.mainWidth >= 600) assert.ok(Math.abs(geometry.order.width - 54) < 1 && Math.abs(geometry.order.x - geometry.orderHeader.x) < 1, 'desktop order values align below their own header');
                else assert.ok(geometry.order.right <= geometry.name.x && geometry.bar.x <= geometry.order.x + 1, 'compact order occupies the identity area without reducing the chart width');
                await noOverflow(`${width}/${state}: pass timing layout`);
            }
            await close();
        }
        await page.setViewportSize({ width: 1280, height: 844 });
        for (const width of [599.5, 999.5]) {
            await page.evaluate(width => {
                for (let attempt = 0; attempt < 3; attempt++) {
                    const main = document.querySelector('.zenfg-inspector-main');
                    const current = parseFloat(getComputedStyle(main).width);
                    themeQA.host.style.width = `${parseFloat(getComputedStyle(themeQA.host).width) + width - current}px`;
                }
            }, width);
            await settle();
            const layout = await firstPass().evaluate(row => {
                const main = row.closest('.zenfg-inspector-main');
                const name = row.querySelector('[data-timing-column="name"]').getBoundingClientRect();
                const time = row.querySelector('[data-timing-column="time"]');
                return { mainWidth: parseFloat(getComputedStyle(main).width), display: getComputedStyle(row).display,
                    nameBottom: name.bottom, timeTop: time.getBoundingClientRect().top };
            });
            assert.ok(Math.abs(layout.mainWidth - width) < 0.05, `${width}: fractional embedded main width`);
            assert.equal(layout.display, width < 600 ? 'grid' : 'table-row', `${width}: base and timing row layouts share one breakpoint`);
            if (width < 600) {
                assert.ok(layout.timeTop >= layout.nameBottom - 1, 'fractional mobile width keeps timing values below the name');
            }
            await within(firstPass().locator('[data-timing-column="time"]'), passes, `${width}: fractional selected time cell`);
            await noOverflow(`${width}: fractional pass layout`);
        }
        await page.evaluate(() => { themeQA.host.style.width = '100%'; });
        const cpuOnly = structuredClone(analysis); cpuOnly.timings.gpu = { status: 'unavailable', reason: 'unsupported' };
        await setSnapshot(cpuOnly); await sortPasses.selectOption('order');
        assert.equal(await passTable.getAttribute('data-source'), 'gpu', 'an explicit source is retained when its measurements become unavailable');
        assert.equal(await passTable.getAttribute('data-max-micros'), '0');
        assert.equal(await passTable.locator('tbody .zenfg-inspector-timing-bar').count(), 0);
        await sourceButton('CPU').click();
        assert.equal(await passTable.getAttribute('data-max-micros'), '2000');
        assert.equal(await passTable.locator('tbody .zenfg-inspector-timing-bar').count(), 5);
        await setSnapshot(fullSnapshot); await sourceButton('GPU').click(); await sortPasses.selectOption('time');

        const noGroups = structuredClone(fullSnapshot);
        noGroups.graph.groups = [];
        for (const entry of [...noGroups.graph.nodes, ...noGroups.graph.resources]) delete entry.groupId;
        for (const origin of ['tab', 'search', 'clear']) {
            const groupTab = passes.getByRole('tab', { name: 'Group Hierarchy', exact: true });
            await groupTab.click();
            const groupToolbar = passes.getByRole('toolbar', { name: 'Group search', exact: true });
            await (origin === 'tab' ? groupTab : origin === 'search' ? groupToolbar.getByRole('searchbox')
                : groupToolbar.getByRole('button', { name: 'Clear filters', exact: true })).focus();
            await setSnapshot(noGroups);
            assert.equal(await groupTab.isDisabled(), true);
            assert.equal(await passes.getByRole('tab', { name: 'Pass List', exact: true }).evaluate(el => el === document.activeElement), true,
                `${origin}: disappearing groups return focus to the visible Pass List`);
            await setSnapshot(fullSnapshot);
        }
        await passes.getByRole('tab', { name: 'Group Hierarchy', exact: true }).click();
        const exportTrigger = page.getByRole('button', { name: 'Export', exact: true });
        await exportTrigger.focus(); await setSnapshot(noGroups);
        assert.equal(await exportTrigger.evaluate(el => el === document.activeElement), true, 'group removal preserves command-bar focus');
        await setSnapshot(fullSnapshot);

        const messages = structuredClone(fullSnapshot);
        messages.diagnostics = [
            { severity: 'warning', code: 'same', message: 'Warning first', nodeId: 'node:scene', resourceId: 'resource:scene-color' },
            { severity: 'error', code: 'same', message: 'Error first' },
            { severity: 'warning', code: 'same', message: 'Warning second' },
            { severity: 'info', code: 'info', message: 'Info first' },
        ];
        await setSnapshot(messages); await openView('Diagnostics');
        const diagnostics = page.locator('.zenfg-inspector-diagnostics-view');
        await diagnostics.getByRole('button', { name: 'Warning diagnostics', exact: true }).press('Enter');
        await diagnostics.getByRole('searchbox').fill('second');
        assert.equal(await diagnostics.locator('.zenfg-inspector-diagnostic-message').count(), 1);
        assert.equal(await diagnostics.getByRole('button', { name: 'Warning diagnostics', exact: true }).innerText(), 'Warning · 2');
        assert.match(await diagnostics.innerText(), /1 \/ 4 diagnostics/);
        await diagnostics.getByRole('button', { name: 'Clear filters', exact: true }).click();
        assert.deepEqual(await diagnostics.locator('.zenfg-inspector-diagnostic-message p').allTextContents(), ['Error first', 'Warning first', 'Warning second', 'Info first']);

        await setSnapshot(aliasSnapshot); await openView('Memory');
        const memory = page.locator('.zenfg-inspector-memory-view');
        const allocation = memory.locator('.zenfg-inspector-memory-allocation').first();
        const fold = allocation.locator('[data-allocation-toggle]');
        await fold.focus(); await fold.press('Enter'); await fold.press('Enter');
        const collapsedName = await allocation.getByRole('button', { name: /^Expand allocation / }).getAttribute('aria-label');
        await setSnapshot(aliasSnapshot);
        assert.equal(await memory.getByRole('button', { name: collapsedName, exact: true }).count(), 1);
        const memorySearch = memory.getByRole('searchbox', { name: 'Search memory resources or allocations', exact: true });
        await memorySearch.fill('allocation:');
        assert.equal(await memory.getByRole('button', { name: collapsedName, exact: true }).count(), 0, 'search temporarily opens matching allocations');
        await memorySearch.fill('');
        assert.equal(await memory.getByRole('button', { name: collapsedName, exact: true }).count(), 1, 'search retains the fold preference');
        await memory.getByRole('button', { name: collapsedName, exact: true }).click();
        const axisBefore = await memory.locator('.zenfg-inspector-memory-axis-track').innerText();
        await memory.getByRole('combobox', { name: 'Memory allocation status', exact: true }).selectOption('aliased');
        assert.equal(await memory.locator('.zenfg-inspector-memory-axis-track').innerText(), axisBefore);
        await memory.getByRole('button', { name: 'Clear filters', exact: true }).click();

        // Deep indentation must leave usable group labels before and after docking.
        const deepSnapshot = structuredClone(fullSnapshot);
        const depth = 24;
        for (let index = 0; index < depth; index++) {
            deepSnapshot.graph.groups.push({
                id: `group:deep-hierarchy-qa:${index}`, label: `Deep group ${index}`,
                ...(index ? { parentId: `group:deep-hierarchy-qa:${index - 1}` } : {}),
            });
        }
        deepSnapshot.graph.nodes.find(node => node.id === 'node:scene').groupId = `group:deep-hierarchy-qa:${depth - 1}`;
        await setSnapshot(deepSnapshot); await openView('Passes');
        await passes.getByRole('tab', { name: 'Group Hierarchy', exact: true }).click();
        const groupRows = passes.locator('.zenfg-inspector-group-table tbody');
        const leaf = groupRows.getByRole('button', { name: `Deep group ${depth - 1}`, exact: true });
        const leafRow = leaf.locator('xpath=ancestor::tr');
        const checkDeepLayout = async label => {
            await within(leaf, passes, `${label}: deep group label`);
            assert.ok((await leaf.boundingBox()).width >= 60, `${label}: deep group keeps a readable target`);
            await within(leafRow.locator('.zenfg-inspector-icon-action'), passes, `${label}: deep group locate`);
            await within(leafRow.locator('.zenfg-inspector-group-view-passes'), passes, `${label}: group pass drill-down`);
            assert.ok(await groupRows.locator('tr').evaluateAll(rows => rows.every(row => {
                const cell = row.cells[0].getBoundingClientRect(); const rect = row.getBoundingClientRect();
                return cell.x + cell.width <= rect.x + rect.width + 1;
            })), `${label}: hierarchy cells fit their rows`);
            assert.ok(await passes.locator('.zenfg-inspector-group-table').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: hierarchy has no internal overflow`);
            assert.equal((await leafRow.locator('td').first().getAttribute('title')).split(' / ').length, depth, 'the complete group path remains available');
        };
        for (const [width, height] of [[1277, 920], [800, 920], [640, 920], [390, 480], [320, 844]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(height => { themeQA.host.style.height = `${height < 800 ? height - 10 : 800}px`; }, height);
            await settle();
            await leaf.scrollIntoViewIfNeeded();
            await checkDeepLayout(`${width} / closed inspector`);
            await leaf.press('Enter');
            await page.getByRole('tab', { name: 'Summary', exact: true }).click();
            await settle();
            await checkDeepLayout(`${width} / open inspector`);
            await close();
        }
        await groupRows.getByRole('button', { name: 'Collapse group Deep group 0', exact: true }).press('Enter');
        assert.equal(await leaf.count(), 0);
        const groupSearch = passes.getByRole('searchbox', { name: 'Search group path or ID', exact: true });
        await groupSearch.fill(`Deep group ${depth - 1}`);
        await checkDeepLayout('deep group search');
        await groupSearch.fill('');
        assert.equal(await leaf.count(), 0, 'search keeps the hierarchy fold preference');
        await groupSearch.fill(`Deep group ${depth - 1}`);
        await leaf.press('Enter');
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await details.getByRole('button', { name: 'Locate in Passes', exact: true }).click();
        await close();
        assert.equal(await groupSearch.inputValue(), '', 'explicit reveal removes group search');
        await checkDeepLayout('deep group revealed');
        assert.ok(await leafRow.evaluate(row => row.classList.contains('selected')), 'explicit reveal selects the deep group');
        await leafRow.locator('.zenfg-inspector-group-view-passes').press('Enter');
        const deepScopePath = passes.locator('.zenfg-inspector-pass-scope-path');
        assert.equal((await deepScopePath.getAttribute('title')).split(' / ').length, depth, 'the full deep scope path remains available');
        assert.ok(await deepScopePath.evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1), 'deep scope paths occupy at most two text lines');
        const scopedScene = passes.locator('.zenfg-inspector-pass-table tr[data-selection-key="node:node:scene"]');
        await within(scopedScene.getByRole('button', { name: 'scene', exact: true }), passes, 'deep scope pass name');
        await within(scopedScene.locator('[data-timing-column="time"]'), passes, 'deep scope GPU timing');
        await passes.getByRole('button', { name: 'Clear group scope', exact: true }).press('Enter');
        await passes.getByRole('tab', { name: 'Pass List', exact: true }).click();
        // Preserve a long name and descriptor through all layouts and host themes.
        const responsiveSnapshot = structuredClone(messages);
        responsiveSnapshot.graph.nodes.find(node => node.id === 'node:scene').label = 'Scene with a deliberately long pass name and rendering context '.repeat(3);
        responsiveSnapshot.graph.resources.find(resource => resource.id === 'resource:scene-color').label = 'Long texture name for the main scene color and post-processing input '.repeat(3);
        responsiveSnapshot.timings = {
            cpu: { status: 'available', executionDurationMicros: 2200, nodes: [
                { nodeId: 'node:scene', durationMicros: 1300 }, { nodeId: 'node:external', durationMicros: 500 }, { nodeId: 'node:present', durationMicros: 200 },
            ] },
            gpu: { status: 'available', frameSpanMicros: 100, nodes: [{ nodeId: 'node:scene', durationMicros: 20 }, { nodeId: 'node:present', durationMicros: 44 }] },
        };
        await setSnapshot(responsiveSnapshot);
        for (const [width, height] of [[1877, 920], [1277, 920], [800, 920], [390, 844], [320, 844], [390, 480]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(height => { themeQA.host.style.height = `${height < 800 ? height - 10 : 800}px`; }, height);
            for (const mode of ['dark', 'light', 'custom']) {
                await page.evaluate(mode => {
                    themeQA.host.style.removeProperty('--zfgi-text');
                    delete themeQA.host.dataset.zfgiTheme;
                    themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : mode === 'light' ? themeQA.tokyoNightLight : null);
                    if (mode === 'custom') {
                        themeQA.host.dataset.zfgiTheme = 'tokyo-night-light';
                        themeQA.host.style.setProperty('--zfgi-text', '#234567');
                        themeQA.inspector.refreshTheme();
                    }
                }, mode);
                for (const view of ['Passes', 'Resources', 'Memory', 'Diagnostics']) {
                    await openView(view);
                    const root = page.locator(`.zenfg-inspector-${view.toLowerCase()}-view`);
                    if (view === 'Passes') {
                        const row = root.locator('tr[data-selection-key="node:node:scene"]');
                        await within(row.locator('[data-timing-column="time"]'), root, `${mode}/${width} selected GPU timing`);
                        assert.equal(await row.locator('.zenfg-inspector-timing-number').innerText(), '0.020');
                        const orderAlignment = await root.locator('.zenfg-inspector-pass-table').evaluate(table => {
                            const cells = [...table.querySelectorAll('td[data-timing-column="order"], th[data-timing-column="order"]')].filter(cell => getComputedStyle(cell).position !== 'absolute');
                            return cells.every(cell => { const range = document.createRange(); range.selectNodeContents(cell); const text = range.getBoundingClientRect(), box = cell.getBoundingClientRect(); return Math.abs(text.x + text.width / 2 - box.x - box.width / 2) < 1; });
                        });
                        assert.ok(orderAlignment, `${mode}/${width}: Order headings and values share their column center`);
                    }
                    if (view === 'Resources') {
                        const row = root.locator('tr[data-selection-key="resource:resource:scene-color"]');
                        await within(row.locator('[data-resource-column="size"]'), root, `${mode}/${width} logical estimate`);
                        assert.match(await row.innerText(), /rgba16float.*1920×1080/);
                    }
                    if (view === 'Memory') {
                        assert.ok(await root.locator('.zenfg-inspector-memory-timeline').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${mode}/${width}: full lifecycle domain fits`);
                        assert.match(await root.innerText(), /Physical allocation estimate.*7\.9/s);
                        const bar = root.locator('.zenfg-inspector-memory-allocation').first().locator('.zenfg-inspector-memory-track');
                        await within(bar, root, `${mode}/${width} lifecycle`);
                    }
                    await noOverflow(`${mode}/${width}/${height}/${view}`);
					assert.ok(await root.locator('.zenfg-inspector-icon-action').evaluateAll(buttons => buttons.every(button => {
						const icon = button.querySelector('svg');
						if (!icon || !button.getClientRects().length) return true;
						const rect = button.getBoundingClientRect(); const svg = icon.getBoundingClientRect();
						return Math.abs(rect.x + rect.width / 2 - svg.x - svg.width / 2) < 1
							&& Math.abs(rect.y + rect.height / 2 - svg.y - svg.height / 2) < 1;
					})), `${mode}/${width}/${view}: action icons are centered`);
                    await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-${view.toLowerCase()}-redesign.png`), animations: 'disabled' });
                    if (view === 'Passes' && mode === 'dark' && ([1877, 1277].includes(width) || height === 844)) {
                        for (const timingView of ['Passes', 'Overview']) {
                            await openView(timingView);
                            const timingRoot = page.locator(`.zenfg-inspector-${timingView.toLowerCase()}-view`);
                            for (const source of ['GPU', 'CPU']) {
                                await timingRoot.locator('.zenfg-inspector-timing-switch').getByRole('button', { name: source, exact: true }).click();
                                await page.screenshot({ path: resolve(output, `name-first-${source.toLowerCase()}-${width}-${timingView.toLowerCase()}.png`), animations: 'disabled' });
                            }
                        }
                        await openView('Passes'); await sourceButton('GPU').click();
                    }
					if (view === 'Memory' && height === 480) {
						await root.locator('.zenfg-inspector-memory-resource').first().scrollIntoViewIfNeeded();
						const lifecycle = await root.locator('.zenfg-inspector-memory-allocation').first().locator('.zenfg-inspector-memory-track').boundingBox();
						const controls = await root.locator('.zenfg-inspector-memory-controls').boundingBox();
						const viewport = await root.locator('.zenfg-inspector-memory-scroller').boundingBox();
						assert.ok(lifecycle.y >= controls.y + controls.height - 1 && lifecycle.y + lifecycle.height <= viewport.y + viewport.height + 1, 'small memory panel keeps its lifetime visible below sticky controls');
						await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-memory-lifetimes-redesign.png`), animations: 'disabled' });
						await root.locator('.zenfg-inspector-memory-scroller').evaluate(el => { el.scrollTop = 0; });
					}
                }
                await openView('Resources');
                await page.locator('tr[data-selection-key="resource:resource:scene-color"]').getByRole('button').first().click();
                for (const detail of ['Summary', 'Relations', 'Raw']) {
                    await page.getByRole('tab', { name: detail, exact: true }).click();
                    assert.ok(await details.locator('.zenfg-inspector-inspector-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${mode}/${width}/${detail}: detail overflow`);
                    await noOverflow(`${mode}/${width}/${detail}`);
                    await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-detail-${detail.toLowerCase()}-redesign.png`), animations: 'disabled' });
                }
                await close();
            }
        }
    } finally {
        await close();
        await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => {
            themeQA.host.style.height = '800px';
            themeQA.host.style.removeProperty('--zfgi-text');
            delete themeQA.host.dataset.zfgiTheme;
            themeQA.inspector.setTheme(themeQA.tokyoNightStorm);
        });
        await setSnapshot(original);
        await openView('Graph');
    }
}
