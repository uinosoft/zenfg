import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Real DOM + Canvas checks against the compiler-produced four-branch capture.
// Public controls drive actions; the rendered Cytoscape state verifies their
// effect on selection, one-hop relations, and the independently owned viewport.
export async function checkGraphImprovements(page, output) {
    const canvas = page.locator('.zenfg-inspector-graph-canvas');
    const button = name => page.getByRole('button', { name, exact: true });
    const search = button('Search');
    const input = page.getByRole('combobox', { name: 'Find in graph', exact: true });
    const results = page.getByRole('listbox', { name: 'Graph search results', exact: true });
    const display = button('Display');
    const displayDialog = page.getByRole('dialog', { name: 'Graph display options', exact: true });
    const focus = button('Focus relations');
    const settle = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const ready = async () => {
        await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-canvas')?._cyreg?.cy?.nodes().length > 0
            && document.querySelector('.zenfg-inspector-graph-status').hidden);
        await settle();
    };
    const state = () => canvas.evaluate(el => {
        const cy = el._cyreg.cy;
        return { pan: cy.pan(), zoom: cy.zoom(), positions: cy.nodes().map(node => [node.id(), node.position()]),
            selected: cy.elements('.semantic-selected').map(node => node.id()) };
    });
    const closeInspector = async () => {
        const close = button('Close inspector');
        if (await close.isVisible()) { await close.click(); await ready(); }
    };
    const find = async query => {
        if (await input.isHidden()) await search.click();
        await input.fill(query);
        await settle();
    };
    const expectZoomOutput = async () => {
        const zoom = await canvas.evaluate(el => el._cyreg.cy.zoom());
        assert.equal(await page.locator('output[aria-label="Graph zoom"]').innerText(), `${Math.round(zoom * 100)}%`);
    };
    const expectControlsFit = async label => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page horizontal overflow`);
        const layout = await page.locator('.zenfg-inspector-graph-view').evaluate(el => {
            const host = el.getBoundingClientRect();
            const visible = selector => [...el.querySelectorAll(selector)].filter(item => item.getClientRects().length > 0)
                .map(item => { const rect = item.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }; });
            const buttons = visible('.zenfg-inspector-graph-toolbar button, .zenfg-inspector-graph-zoom-controls button');
            const groups = visible('.zenfg-inspector-graph-search, .zenfg-inspector-graph-action-controls, .zenfg-inspector-graph-zoom-controls, .zenfg-inspector-graph-legend-toggle');
            const iconsCentered = [...el.querySelectorAll('.zenfg-inspector-graph-zoom-controls > button > svg')].every(icon => {
                const bounds = icon.getBoundingClientRect();
                const button = icon.parentElement.getBoundingClientRect();
                return Math.abs(bounds.x + bounds.width / 2 - button.x - button.width / 2) <= 0.5
                    && Math.abs(bounds.y + bounds.height / 2 - button.y - button.height / 2) <= 0.5;
            });
            const overlap = rects => rects.some((a, index) => rects.slice(index + 1).some(b =>
                Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1));
            return { overflow: el.scrollWidth > el.clientWidth + 1,
                within: buttons.every(rect => rect.x >= host.x - 1 && rect.right <= host.right + 1 && rect.y >= host.y - 1 && rect.bottom <= host.bottom + 1),
                overlap: overlap(buttons) || overlap(groups), iconsCentered };
        });
        assert.equal(layout.overflow, false, `${label}: Graph horizontal overflow`);
        assert.equal(layout.within, true, `${label}: controls remain within the Graph panel`);
        assert.equal(layout.overlap, false, `${label}: controls and legend do not overlap`);
        assert.equal(layout.iconsCentered, true, `${label}: zoom icons are centered in both directions`);
    };

    try {
        await page.setViewportSize({ width: 1277, height: 920 });
        await page.evaluate(() => { themeQA.host.style.height = '920px'; themeQA.inspector.setSnapshot(themeQA.snapshot); });
        await page.getByRole('tab', { name: 'Graph', exact: true }).click();
        await ready();
        await closeInspector();
        const target = await page.evaluate(() => themeQA.snapshot.graph.nodes.find(node => node.label === 'Lighting.stage3'));
        assert.ok(target, 'dense compiler fixture contains the target pass');
        const targetElementId = `pass:${target.id}`;

        // Start from a predictable projection using the same menu controls as a user.
        await display.click();
        assert.equal(await displayDialog.isVisible(), true);
        assert.equal(await display.getAttribute('aria-expanded'), 'true');
        const declarations = button('Show resource declaration nodes');
        if (await declarations.getAttribute('aria-pressed') === 'true') { await declarations.click(); await ready(); }
        const groups = button('Toggle diagnostic group projection');
        if (await groups.getAttribute('aria-pressed') !== 'true') { await groups.click(); await ready(); }
        const collapseAll = button('Collapse every diagnostic group');
        if (await collapseAll.isEnabled()) {
            await collapseAll.click(); await ready();
            assert.equal(await displayDialog.isHidden(), true, 'Collapse All completes and returns to the canvas');
            assert.equal(await display.evaluate(el => el === document.activeElement), true);
            await display.click();
        }
        await page.keyboard.press('Escape');
        assert.equal(await displayDialog.isHidden(), true);
        assert.equal(await display.evaluate(el => el === document.activeElement), true);
        await display.press('Enter');
        assert.equal(await displayDialog.isVisible(), true);
        assert.equal(await declarations.evaluate(el => el === document.activeElement), true);
        const canvasBounds = await canvas.boundingBox();
        await page.mouse.click(canvasBounds.x + 8, canvasBounds.y + canvasBounds.height - 8);
        assert.equal(await displayDialog.isHidden(), true, 'outside click dismisses Display');
        assert.equal(await display.getAttribute('aria-expanded'), 'false');
        assert.equal(await display.evaluate(el => el === document.activeElement), false, 'outside click preserves the new focus target');

        await display.click();
        for (let step = 0; step < 5 && !(await search.evaluate(el => el === document.activeElement)); step++) {
            await page.keyboard.press('Shift+Tab');
        }
        assert.equal(await search.evaluate(el => el === document.activeElement), true, 'keyboard can leave Display for Search');
        assert.equal(await displayDialog.isHidden(), true, 'moving focus outside closes Display');
        await search.press('Enter');
        await input.press('Escape');
        assert.equal(await search.evaluate(el => el === document.activeElement), true, 'Search handles its own Escape');

        // Name, group path, and stable ID stay visible on separate result rows.
        await find(target.label);
        const targetResult = results.locator('[data-selection-kind="node"]').filter({ hasText: target.label }).first();
        assert.equal(await targetResult.locator('.zenfg-inspector-graph-search-label').innerText(), target.label);
        assert.match(await targetResult.locator('.zenfg-inspector-graph-search-metadata').innerText(), /Pass · Command ·/);
        assert.ok((await targetResult.locator('.zenfg-inspector-graph-search-metadata').innerText()).includes(target.id));
        assert.equal(await targetResult.locator('.zenfg-inspector-graph-search-path').innerText(), 'Frame / Lighting');
        const primaryBounds = await targetResult.locator('.zenfg-inspector-graph-search-label').boundingBox();
        const metadataBounds = await targetResult.locator('.zenfg-inspector-graph-search-metadata').boundingBox();
        assert.ok(metadataBounds.y >= primaryBounds.y + primaryBounds.height - 1, 'search metadata has its own row');
        await page.screenshot({ path: resolve(output, 'dark-1277-graph-search-improvements.png'), animations: 'disabled' });
        const options = results.getByRole('option');
        assert.ok(await options.count() >= 2, 'name search distinguishes pass and matching resource');
        await input.press('ArrowDown');
        assert.equal(await input.getAttribute('aria-activedescendant'), await options.first().getAttribute('id'));
        await input.press('ArrowDown');
        assert.equal(await input.getAttribute('aria-activedescendant'), await options.nth(1).getAttribute('id'));
        await input.press('ArrowUp');
        assert.equal(await input.getAttribute('aria-activedescendant'), await options.first().getAttribute('id'));
        assert.equal(await input.evaluate(el => el === document.activeElement), true, 'keyboard navigation retains combobox focus');
        assert.equal(await options.first().getAttribute('data-selection-kind'), 'node', 'exact pass name precedes less specific entries');
        await input.press('Enter');
        await ready();
        await page.waitForFunction(id => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.getElementById(id).hasClass('semantic-selected'), targetElementId);
        await closeInspector();

        // Focus is one recorded hop, and affects neither geometry nor viewport.
        const beforeFocus = await state();
        assert.equal(await focus.isEnabled(), true);
        await focus.click();
        await ready();
        assert.equal(await focus.getAttribute('aria-pressed'), 'true');
        assert.deepEqual(await state(), beforeFocus, 'relation focus preserves positions, selection, pan and zoom');
        const relationState = await canvas.evaluate(el => {
            const cy = el._cyreg.cy;
            const pass = label => cy.nodes('[kind="pass"]').filter(node => node.data('tooltip').split('\n')[0] === label).first();
            return { nearby: ['Lighting.stage2', 'Lighting.stage3', 'Lighting.stage4'].map(label => ({ exists: !pass(label).empty(), muted: pass(label).hasClass('semantic-muted') })),
                distant: ['Lighting.stage1', 'Lighting.stage5'].map(label => pass(label).hasClass('semantic-muted')),
                bloom: cy.nodes().filter(node => node.data('tooltip').split('\n')[0].includes('Bloom')).map(node => node.hasClass('semantic-muted')),
                mutedCount: cy.elements('.semantic-muted').length };
        });
        assert.ok(relationState.nearby.every(node => node.exists && !node.muted), 'direct upstream/downstream remain visible');
        assert.deepEqual(relationState.distant, [true, true], 'second-hop passes are muted');
        assert.ok(relationState.bloom.length && relationState.bloom.every(Boolean), 'unrelated branch is muted');
        assert.ok(relationState.mutedCount > 0);
        await focus.click();
        await ready();
        assert.equal(await focus.getAttribute('aria-pressed'), 'false');
        assert.equal(await canvas.evaluate(el => el._cyreg.cy.elements('.semantic-muted').length), 0);
        assert.deepEqual(await state(), beforeFocus);

        // Zoom controls report the renderer's actual zoom and preserve selection.
        const beforeZoom = await state();
        await button('Zoom in').click();
        await settle();
        assert.ok((await state()).zoom > beforeZoom.zoom);
        await expectZoomOutput();
        await button('Zoom out').click();
        await settle();
        assert.ok(Math.abs((await state()).zoom - beforeZoom.zoom) < 1e-8);
        await button('Reset graph zoom to 100%').click();
        await settle();
        assert.equal((await state()).zoom, 1);
        await expectZoomOutput();
        for (const name of ['Fit selection to view', 'Fit graph to view']) {
            await button(name).click();
            await ready();
            assert.deepEqual((await state()).positions, beforeZoom.positions, `${name} preserves node geometry`);
            assert.deepEqual((await state()).selected, beforeZoom.selected, `${name} preserves selection`);
            await expectZoomOutput();
        }

        // Search by a path then use explicit selected-group controls.
        await find('Frame / Lighting');
        const groupResult = results.locator('[data-selection-kind="group"]').filter({ has: page.locator('.zenfg-inspector-graph-search-label', { hasText: /^Lighting$/ }) }).first();
        assert.equal(await groupResult.locator('.zenfg-inspector-graph-search-path').innerText(), 'Frame / Lighting');
        await groupResult.click();
        await ready();
        await closeInspector();
        await button('Collapse group').click();
        await ready();
        const collapsed = await state();
        assert.equal(await canvas.evaluate(el => el._cyreg.cy.nodes('[kind="pass"]').filter(node => node.data('tooltip').split('\n')[0].startsWith('Lighting.stage')).length), 0);
        await button('Fit selection to view').click();
        await ready();
        assert.deepEqual((await state()).positions, collapsed.positions, 'Fit selection does not expand a collapsed group');
        assert.deepEqual((await state()).selected, collapsed.selected);
        assert.equal(await button('Expand group').isVisible(), true);
        await button('Expand group').click();
        await ready();
        assert.equal(await canvas.evaluate(el => el._cyreg.cy.nodes('[kind="pass"]').filter(node => node.data('tooltip').split('\n')[0].startsWith('Lighting.stage')).length), 6);
        assert.equal(await button('Collapse group').isVisible(), true);
        await find(target.id);
        assert.equal(await results.getByRole('option').first().getAttribute('data-selection-id'), target.id);
        assert.equal(await results.getByRole('option').first().locator('.zenfg-inspector-graph-search-label').innerText(), target.label);
        await input.press('Enter');
        await ready();
        await closeInspector();

        // Theme and compact-container acceptance, including the smallest panel.
        for (const [width, height] of [[1277, 920], [800, 920], [390, 844], [390, 480]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(height => { themeQA.host.style.height = height + 'px'; }, height);
            for (const mode of ['dark', 'light', 'custom']) {
                await page.evaluate(mode => {
                    themeQA.host.style.removeProperty('--zfgi-text');
                    themeQA.host.style.removeProperty('--zfgi-graph-text');
                    delete themeQA.host.dataset.zfgiTheme;
                    if (mode === 'custom') {
                        themeQA.inspector.setTheme(null);
                        themeQA.host.dataset.zfgiTheme = 'tokyo-night-light';
                        themeQA.host.style.setProperty('--zfgi-text', '#234567');
                        themeQA.host.style.setProperty('--zfgi-graph-text', '#234567');
                        themeQA.inspector.refreshTheme();
                    } else themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight);
                }, mode);
                await ready();
                if (await focus.getAttribute('aria-pressed') !== 'true') { await focus.click(); await ready(); }
                await button('Fit graph to view').click();
                await ready();
                await expectZoomOutput();
                await expectControlsFit(`${width}/${height}/${mode}`);
                assert.equal(await canvas.evaluate((el, id) => el._cyreg.cy.getElementById(id).hasClass('semantic-selected'), targetElementId), true);
                if (mode === 'custom') assert.equal(await canvas.evaluate((el, id) => el._cyreg.cy.getElementById(id).style('color'), targetElementId), 'rgb(35,69,103)', 'graph follows the host text token');
                await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-graph-improvements.png`), animations: 'disabled' });
                await button('Fit selection to view').click();
                await button('Reset graph zoom to 100%').click();
                await ready();
                await expectZoomOutput();
                assert.equal(await page.locator('output[aria-label="Graph zoom"]').innerText(), '100%');
                assert.ok(await canvas.evaluate((el, id) => el._cyreg.cy.getElementById(id).data('displayLabel').includes('\n'), targetElementId), 'readable scale includes execution metadata');
                // Read existing canvas geometry without recomputing bounds: a
                // stale one-line cache clips the selected two-line texture.
                const labelGeometry = await canvas.evaluate((el, id) => {
                    const data = el._cyreg.cy.getElementById(id)[0]._private;
                    return { clean: data.rstyle.clean, bounds: data.labelBounds.main,
                        width: data.rstyle.labelWidth, height: data.rstyle.labelHeight };
                }, targetElementId);
                assert.equal(labelGeometry.clean, true, 'readable label has been measured');
                assert.ok(labelGeometry.bounds && labelGeometry.bounds.w >= labelGeometry.width - 1
                    && labelGeometry.bounds.h >= labelGeometry.height - 1,
                    `${width}/${height}/${mode}: selected label texture includes every line`);
                await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-graph-readable.png`), animations: 'disabled' });
                const legendTrigger = button('Legend');
                const legend = page.getByRole('region', { name: 'Graph legend', exact: true });
                const beforeLegend = { trigger: await legendTrigger.boundingBox(), canvas: await canvas.boundingBox(), state: await state() };
                await legendTrigger.click();
                assert.equal(await legendTrigger.getAttribute('aria-expanded'), 'true');
                assert.equal(await legend.isVisible(), true);
                const legendBounds = await legend.boundingBox();
                assert.ok(legendBounds.x >= beforeLegend.canvas.x && legendBounds.y >= beforeLegend.canvas.y);
                assert.ok(legendBounds.x + legendBounds.width <= beforeLegend.canvas.x + beforeLegend.canvas.width + 1);
                assert.ok(legendBounds.y + legendBounds.height < beforeLegend.trigger.y, 'legend opens above its fixed trigger');
                const closeLegend = button('Close legend');
                const closeBefore = await closeLegend.boundingBox();
                const legendEntries = legend.locator('.zenfg-inspector-graph-legend');
                await legendEntries.focus();
                await legendEntries.press('End');
                await settle();
                const scroll = await legendEntries.evaluate(el => ({ top: el.scrollTop, client: el.clientHeight, height: el.scrollHeight }));
                if (scroll.height > scroll.client) assert.ok(scroll.top > 0, 'keyboard can scroll the compact legend');
                assert.deepEqual(await closeLegend.boundingBox(), closeBefore, 'scrolling keeps the close button fixed');
                assert.deepEqual({ trigger: await legendTrigger.boundingBox(), canvas: await canvas.boundingBox(), state: await state() }, beforeLegend, 'legend open and scrolling preserve its trigger and viewport');
                if (mode === 'dark') await page.screenshot({ path: resolve(output, `${mode}-${width}-${height}-graph-legend-fixed.png`), animations: 'disabled' });
                await legendEntries.press('Escape');
                assert.equal(await legend.isHidden(), true);
                assert.equal(await legendTrigger.evaluate(el => el === document.activeElement), true);
                assert.deepEqual(await legendTrigger.boundingBox(), beforeLegend.trigger);
            }
        }
        // Force overflow so the scroll path is exercised even by captures with
        // only a few legend categories. The header and toggle remain reachable.
        await page.evaluate(() => { themeQA.host.style.height = '280px'; });
        await ready();
        const compactLegendTrigger = button('Legend');
        const compactTriggerBounds = await compactLegendTrigger.boundingBox();
        await compactLegendTrigger.click();
        const compactLegend = page.getByRole('region', { name: 'Graph legend', exact: true });
        const compactEntries = compactLegend.locator('.zenfg-inspector-graph-legend');
        const compactCloseBounds = await button('Close legend').boundingBox();
        await compactEntries.focus();
        await compactEntries.press('End');
        await settle();
        const compactScroll = await compactEntries.evaluate(el => ({ height: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }));
        assert.ok(compactScroll.height > compactScroll.client && compactScroll.top > 0,
            `short panel scrolls legend content: ${JSON.stringify(compactScroll)}`);
        assert.deepEqual(await compactLegendTrigger.boundingBox(), compactTriggerBounds);
        assert.deepEqual(await button('Close legend').boundingBox(), compactCloseBounds);
        await compactEntries.press('Escape');
        await page.evaluate(() => { themeQA.host.style.height = '480px'; });
        await ready();
        await display.click();
        assert.equal(await displayDialog.isVisible(), true);
        const dialogBounds = await displayDialog.boundingBox();
        assert.ok(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= 391, 'Display fits the narrow panel');
        await page.screenshot({ path: resolve(output, 'custom-390-480-graph-display-improvements.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
    } finally {
        if (await input.isVisible()) await input.press('Escape');
        if (await displayDialog.isVisible()) await page.keyboard.press('Escape');
        if (await focus.getAttribute('aria-pressed') === 'true') await focus.click();
        await page.evaluate(() => {
            themeQA.host.style.height = '800px';
            themeQA.host.style.removeProperty('--zfgi-text');
            themeQA.host.style.removeProperty('--zfgi-graph-text');
            delete themeQA.host.dataset.zfgiTheme;
            themeQA.inspector.setTheme(null);
            themeQA.inspector.setSnapshot(themeQA.snapshot);
        });
        await page.setViewportSize({ width: 1277, height: 920 });
        await page.getByRole('tab', { name: 'Graph', exact: true }).click();
        await ready();
    }
}
