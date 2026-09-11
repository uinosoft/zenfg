import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function checkDrawerBackdrop(page, output) {
    await page.setViewportSize({ width: 800, height: 700 });
    const backdrop = page.locator('.zenfg-inspector-detail-backdrop');
    const canvas = page.locator('.zenfg-inspector-graph-canvas');
    const graphState = () => canvas.evaluate(el => {
        const cy = el._cyreg.cy;
        return { pan: cy.pan(), zoom: cy.zoom(), positions: cy.nodes().map(n => [n.id(), n.position()]), selected: cy.elements('.semantic-selected').map(n => n.id()) };
    });
    for (const mode of ['dark', 'light']) {
        await page.evaluate(mode => {
            themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight);
            document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes('[kind="pass"]').first().emit('tap');
        }, mode);
        await page.waitForFunction(() => document.querySelector('.zenfg-inspector-inspector').getAttribute('aria-modal') === 'true');
        const bounds = await backdrop.boundingBox();
        await page.mouse.move(bounds.x + 30, bounds.y + 90);
        const background = await backdrop.evaluate(el => getComputedStyle(el).backgroundColor);
        const state = await graphState();
        const clip = { x: bounds.x + 10, y: bounds.y + 60, width: 200, height: 200 };
        const before = await page.screenshot({ clip, animations: 'disabled' });
        await page.mouse.down();
        await page.screenshot({ path: resolve(output, `${mode}-drawer-backdrop-pressed.png`), animations: 'disabled' });
        assert.equal(await backdrop.isVisible(), true, 'drawer remains open until release');
        assert.equal(await backdrop.evaluate(el => getComputedStyle(el).backgroundColor), background, 'press must retain translucent backdrop');
        assert.deepEqual(await page.screenshot({ clip, animations: 'disabled' }), before, 'graph under backdrop remains visually unchanged while pressed');
        assert.deepEqual(await graphState(), state);
        await page.mouse.up();
        assert.equal(await backdrop.isHidden(), true, 'release closes the drawer');
        assert.deepEqual(await graphState(), state, 'closing preserves graph state');
    }
    await page.setViewportSize({ width: 1277, height: 920 });
    await page.evaluate(() => themeQA.inspector.setTheme(null));
}
