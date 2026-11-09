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
    snapshot.timings = {
        cpu: { status: 'available', executionDurationMicros: 1700, nodes: [100, 200, 300, 400, 500].map((durationMicros, index) => ({ nodeId: nodes[index].id, durationMicros })) },
        gpu: { status: 'available', frameSpanMicros: 1100, nodes: [440, 220, 110].map((durationMicros, index) => ({ nodeId: nodes[index].id, durationMicros })) },
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
        await passes.getByRole('combobox', { name: 'Sort passes', exact: true }).selectOption('gpu');
        assert.equal(await passes.locator('tr[data-selection-key]').first().getAttribute('data-selection-key'), 'node:node:scene');
        await passes.getByRole('button', { name: 'scene', exact: true }).click();
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        const details = page.locator('.zenfg-inspector-inspector');
        assert.match(await details.innerText(), /GPU.*1\.410/s);
        assert.match(await details.innerText(), /CPU.*Not collected/s);
        await within(passes.locator('tr[data-selection-key]').first().locator('td[data-timing="gpu"]'), passes, 'open dock GPU');
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
        await sortPasses.selectOption('order');
        assert.equal(await passTable.locator('thead th').count(), 3);
        assert.equal(await passTable.getAttribute('data-primary'), 'gpu');
        assert.equal(await passTable.getAttribute('data-max-micros'), '500');
        assert.equal(await passRows.count(), 7);
        assert.equal(await firstPass().locator('[data-timing="gpu"] .zenfg-inspector-pass-duration').innerText(), '0.440');
        assert.equal(await firstPass().locator('[data-timing="gpu"] .zenfg-inspector-pass-share').innerText(), '57.1%');
        const fullWidth = await firstPass().locator('.zenfg-inspector-pass-bar > span').evaluate(el => el.style.width);
        assert.equal(fullWidth, '88%');
        assert.equal(await firstPass().locator('[data-timing="cpu"] .zenfg-inspector-pass-bar').count(), 0);
        await searchPasses.fill('mesh.directional-shadow.depth.1');
        assert.equal(await passRows.count(), 1);
        assert.equal(await firstPass().locator('.zenfg-inspector-pass-share').last().innerText(), '57.1%');
        assert.equal(await firstPass().locator('.zenfg-inspector-pass-bar > span').evaluate(el => el.style.width), fullWidth);
        assert.match(await passes.locator('.zenfg-inspector-pass-matched').innerText(), /0\.440 ms.*57\.1%/);
        await passes.getByRole('button', { name: 'Clear filters', exact: true }).click();
        await sortPasses.selectOption('cpu');
        assert.equal(await passTable.getAttribute('data-primary'), 'cpu');
        assert.equal(await passRows.first().getAttribute('data-selection-key'), 'node:node:pass-analysis:4');
        assert.equal(await passRows.first().locator('[data-timing="cpu"] .zenfg-inspector-pass-share').innerText(), '33.3%');
        assert.equal(await passTable.locator('tbody [data-timing="gpu"] .zenfg-inspector-pass-bar').count(), 0);

        await passStatus.selectOption('culled');
        assert.equal(await passRows.count(), 1);
        assert.equal(await passTable.locator('tbody [data-timing]').count(), 0);
        assert.equal(await passTable.getByRole('columnheader', { name: 'Culled reason', exact: true }).count(), 1);
        assert.match(await passRows.first().locator('.zenfg-inspector-pass-reason').innerText(), /Not executed.*not-reachable-from-root/);
        assert.equal(await passRows.first().locator('.zenfg-inspector-pass-reason').getAttribute('colspan'), '2');
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
        await sortPasses.selectOption('gpu');
        for (const width of [1277, 800, 390, 320]) {
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
                for (const source of ['cpu', 'gpu']) await within(firstPass().locator(`td[data-timing="${source}"]`), passes, `${width}/${state}: ${source} remains visible`);
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
                const name = row.cells[0].getBoundingClientRect();
                const cpu = row.querySelector('td[data-timing="cpu"]');
                return { mainWidth: parseFloat(getComputedStyle(main).width), display: getComputedStyle(row).display,
                    label: getComputedStyle(cpu, '::before').content, nameBottom: name.bottom, cpuTop: cpu.getBoundingClientRect().top };
            });
            assert.ok(Math.abs(layout.mainWidth - width) < 0.05, `${width}: fractional embedded main width`);
            assert.equal(layout.display, width < 600 ? 'grid' : 'table-row', `${width}: base and timing row layouts share one breakpoint`);
            if (width < 600) {
                assert.match(layout.label, /CPU \(ms\)/);
                assert.ok(layout.cpuTop >= layout.nameBottom - 1, 'fractional mobile width keeps timing labels below the name');
            }
            for (const source of ['cpu', 'gpu']) await within(firstPass().locator(`td[data-timing="${source}"]`), passes, `${width}: fractional ${source} cell`);
            await noOverflow(`${width}: fractional pass layout`);
        }
        await page.evaluate(() => { themeQA.host.style.width = '100%'; });
        const cpuOnly = structuredClone(analysis); cpuOnly.timings.gpu = { status: 'unavailable', reason: 'unsupported' };
        await setSnapshot(cpuOnly); await sortPasses.selectOption('order');
        assert.equal(await passTable.getAttribute('data-primary'), 'cpu', 'execution-order mode falls back to available CPU measurements');
        await setSnapshot(fullSnapshot); await sortPasses.selectOption('gpu');

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
        const fold = allocation.getByRole('button', { name: /^Collapse allocation / });
        await fold.focus(); await fold.press('Enter');
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
        await within(scopedScene.locator('td[data-timing="gpu"]'), passes, 'deep scope GPU timing');
        await passes.getByRole('button', { name: 'Clear group scope', exact: true }).press('Enter');
        await passes.getByRole('tab', { name: 'Pass List', exact: true }).click();
        // Preserve a long name and descriptor through all layouts and host themes.
        const responsiveSnapshot = structuredClone(messages);
        responsiveSnapshot.graph.nodes.find(node => node.id === 'node:scene').label = 'Scene with a deliberately long pass name and rendering context '.repeat(3);
        responsiveSnapshot.graph.resources.find(resource => resource.id === 'resource:scene-color').label = 'Long texture name for the main scene color and post-processing input '.repeat(3);
        await setSnapshot(responsiveSnapshot);
        for (const [width, height] of [[1277, 920], [800, 920], [390, 844], [320, 844], [390, 480]]) {
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
                        await within(row.locator('td[data-timing="cpu"]'), root, `${mode}/${width} CPU`);
                        await within(row.locator('td[data-timing="gpu"]'), root, `${mode}/${width} GPU`);
                        assert.equal(await row.locator('td[data-timing="gpu"] .zenfg-inspector-pass-duration').innerText(), '1.410');
                    }
                    if (view === 'Resources') {
                        const row = root.locator('tr[data-selection-key="resource:resource:scene-color"]');
                        await within(row.locator('td').nth(2), root, `${mode}/${width} estimated size`);
                        assert.match(await row.innerText(), /rgba16float.*1920×1080/);
                    }
                    if (view === 'Memory') {
                        assert.ok(await root.locator('.zenfg-inspector-memory-timeline').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${mode}/${width}: full lifecycle domain fits`);
                        assert.match(await root.innerText(), /Physical allocation estimate.*7\.9/s);
                        const bar = root.locator('.zenfg-inspector-memory-resource').first().locator('.zenfg-inspector-memory-track');
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
					if (view === 'Memory' && height === 480) {
						await root.locator('.zenfg-inspector-memory-resource').first().scrollIntoViewIfNeeded();
						assert.ok(await root.locator('.zenfg-inspector-memory-scroller').evaluate(el => el.scrollTop > 0), 'small memory panel scrolls to its lifetimes');
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
