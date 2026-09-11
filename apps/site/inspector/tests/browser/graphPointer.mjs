import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Exercise native mouse gestures, including the compound-node hit area.
export async function checkGraphPointer(page, output) {
    const canvas = page.locator('.zenfg-inspector-graph-canvas');
    const cursor = () => canvas.evaluate(el => getComputedStyle(el).cursor);
    const state = () => canvas.evaluate(el => {
        const cy = el._cyreg.cy;
        return { pan: cy.pan(), zoom: cy.zoom(), positions: cy.nodes().map(n => [n.id(), n.position()]), selected: cy.elements('.semantic-selected').map(n => n.id()) };
    });
    const target = async (selector, expanded = false) => {
        await canvas.evaluate(el => { el._cyreg.cy.resize(); el._cyreg.cy.fit(undefined, 32); });
        // Hit testing follows the renderer's next frame after a resize/fit.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return canvas.evaluate((el, { selector, expanded }) => {
        const cy = el._cyreg.cy;
        const node = cy.nodes(selector).first();
        const box = node.renderedBoundingBox({ includeLabels: false });
        const point = expanded ? { x: (box.x1 + box.x2) / 2, y: box.y1 + 10 } : node.renderedPosition();
        const bounds = el.getBoundingClientRect();
        return { id: node.id(), x: bounds.x + point.x, y: bounds.y + point.y };
        }, { selector, expanded });
    };
    const drag = async point => {
        await page.mouse.move(point.x, point.y);
        assert.equal(await cursor(), 'pointer');
        assert.equal(await canvas.evaluate((el, id) => el._cyreg.cy.getElementById(id).hasClass('semantic-hover'), point.id), true);
        const before = await state();
        await page.mouse.down();
        await page.mouse.move(point.x + 34, point.y + 26, { steps: 6 });
        assert.equal(await cursor(), 'grabbing');
        assert.equal(await page.locator('.zenfg-inspector-graph-tooltip').isHidden(), true);
        await page.mouse.up();
        const after = await state();
        assert.ok(Math.abs(after.pan.x - before.pan.x) > 10 && Math.abs(after.pan.y - before.pan.y) > 10);
        assert.deepEqual(after.positions, before.positions, 'pan must not move nodes');
        assert.deepEqual(after.selected, before.selected, 'drag must not select');
        assert.equal(after.zoom, before.zoom);
        assert.notEqual(await cursor(), 'grabbing');
    };
    await drag(await target('[kind="pass"]'));
    const group = await target('[kind="group"]');
    await drag(group);
    const groupPoint = await target('[kind="group"]');
    await page.mouse.dblclick(groupPoint.x, groupPoint.y, { delay: 50 });
    await page.waitForFunction(id => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.getElementById(id).isParent()
        && document.querySelector('.zenfg-inspector-graph-status').hidden, groupPoint.id);
    await drag(await target(':parent', true));

    // Releasing outside the canvas must not leave a grabbing cursor behind.
    const pass = await target('[kind="pass"]');
    await page.mouse.move(pass.x, pass.y);
    await page.mouse.down();
    await page.mouse.move(pass.x + 20, pass.y + 20, { steps: 4 });
    await page.mouse.move(pass.x, 3, { steps: 4 });
    await page.mouse.up();
    assert.equal(await cursor(), 'grab');

    // Hover a routed edge away from nodes; it remains clickable while allowing panning.
    await canvas.evaluate(el => el._cyreg.cy.fit(undefined, 32));
    const edgePoint = await canvas.evaluate(el => {
        const cy = el._cyreg.cy;
        const boxes = cy.nodes().filter(n => !n.isParent()).map(n => n.renderedBoundingBox());
        const point = cy.edges().map(edge => edge.renderedMidpoint()).find(p => p && !boxes.some(b => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2));
        const bounds = el.getBoundingClientRect();
        return point && { x: bounds.x + point.x, y: bounds.y + point.y };
    });
    assert.ok(edgePoint);
    await page.mouse.move(edgePoint.x, edgePoint.y);
    assert.equal(await cursor(), 'pointer');
    assert.ok(await canvas.evaluate(el => el._cyreg.cy.edges('.semantic-hover').length > 0));

    // Capture the reduced native indicator in both palettes.
    for (const mode of ['dark', 'light']) {
        await page.evaluate(mode => themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight), mode);
        const bounds = await canvas.boundingBox();
        await page.mouse.move(bounds.x + 40, bounds.y + bounds.height - 50);
        assert.equal(await cursor(), 'grab');
        await page.mouse.down();
        await page.mouse.move(bounds.x + 60, bounds.y + bounds.height - 50, { steps: 4 });
        assert.equal(await cursor(), 'grabbing');
        await page.screenshot({ path: resolve(output, `${mode}-graph-press.png`) });
        await page.mouse.up();
    }
    await page.evaluate(() => themeQA.inspector.setTheme(null));
    await page.mouse.move(0, 0);
}
