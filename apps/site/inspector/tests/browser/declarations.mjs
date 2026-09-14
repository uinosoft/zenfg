import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function checkDeclarations(page, output) {
    const control = page.getByRole('button', { name: 'Show resource declaration nodes', exact: true });
    const canvas = page.locator('.zenfg-inspector-graph-canvas');
    const ready = async () => {
        await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-status').hidden);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    for (const width of [1277, 390]) {
        await page.setViewportSize({ width, height: 920 });
        for (const mode of ['dark', 'light']) {
            await page.evaluate(mode => themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight), mode);
            await control.click();
            await ready();
            assert.equal(await control.getAttribute('aria-pressed'), 'false');
            const state = await canvas.evaluate(el => {
                const cy = el._cyreg.cy;
                return {
                    resources: cy.nodes('[kind="resource"]').length,
                    passes: cy.nodes('[kind="pass"]').length,
                    dangling: cy.edges().some(edge => edge.source().empty() || edge.target().empty()),
                    bounds: cy.nodes().map(node => node.boundingBox()),
                    initialLabels: cy.nodes('[kind="root"]').filter(node => node.data('tooltip').includes('Initial contents: true')).map(node => node.data('displayLabel').split('\n').at(-1)),
                };
            });
            assert.equal(state.resources, 0);
            assert.ok(state.passes > 0);
            assert.equal(state.dangling, false);
            assert.ok(state.initialLabels.length > 0);
            assert.ok(state.initialLabels.every(label => ['With initial contents', 'Initial contents only'].includes(label)), 'initial-content notes must remain fully readable');
            assert.ok(state.bounds.every(box => Number.isFinite(box.x1) && Number.isFinite(box.y1)));
            assert.equal(await page.locator('.zenfg-inspector-graph-legend').innerText().then(text => text.includes('Declaration')), false);
            const visible = await control.evaluate(el => {
                const bounds = el.getBoundingClientRect();
                return bounds.x >= 0 && bounds.right <= innerWidth;
            });
            assert.ok(visible, 'Declarations remains accessible in a narrow panel');
            await page.screenshot({ path: resolve(output, mode + '-' + width + '-declarations-hidden.png'), animations: 'disabled' });
            // Refreshing the theme must not restore the hidden legend category.
            await page.evaluate(() => themeQA.inspector.refreshTheme());
            assert.equal(await page.locator('.zenfg-inspector-graph-legend').innerText().then(text => text.includes('Declaration')), false);
            await control.click();
            await ready();
            assert.ok(await canvas.evaluate(el => el._cyreg.cy.nodes('[kind="resource"]').length > 0));
        }
    }
    await page.setViewportSize({ width: 1277, height: 920 });
    await control.click();
    await ready();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Find in graph', exact: true }).fill('history');
    await page.locator('.zenfg-inspector-graph-search-results button').filter({ hasText: /^Resource ·/ }).first().click();
    await ready();
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    assert.ok(await canvas.evaluate(el => el._cyreg.cy.nodes('[kind="resource"].semantic-selected').length > 0));
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    // Consecutive structural requests must settle on the final projection.
    await control.evaluate(el => { el.click(); el.click(); el.click(); });
    await ready();
    assert.equal(await control.getAttribute('aria-pressed'), 'false');
    assert.equal(await canvas.evaluate(el => el._cyreg.cy.nodes('[kind="resource"]').length), 0);
    await control.click();
    await ready();
    await page.evaluate(() => themeQA.inspector.setTheme(null));
    await ready();
}
