import assert from 'node:assert/strict';

/** Exercise the browser cascade and real graph styles; DOM mocks cannot model this failure. */
export async function checkThemeIsolation(page) {
    const graphStyles = () => page.evaluate(() => {
        const core = document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy;
        return core.elements().map(element => ({
            id: element.id(),
            styles: Object.fromEntries((element.isNode()
                ? ['color', 'background-color', 'border-color', 'border-width', 'font-family', 'font-size']
                : ['line-color', 'width']).map(property => [property, element.style(property)])),
        }));
    });
    const pollution = await page.addStyleTag({ content: `
        span { all: unset !important; color: inherit !important; font: 33px serif !important; }
        .zenfg-inspector > [aria-hidden="true"] { all: unset !important; color: red !important; font: 47px serif !important; }
    ` });
    // Start with the already-rendered graph, then force the theme through the polluted DOM.
    try {
        const original = await graphStyles();
        await page.evaluate(() => themeQA.inspector.refreshTheme());
        assert.deepEqual(await graphStyles(), original, 'host CSS must not merge graph colors or inflate line widths');

        for (const mode of ['dark', 'light']) {
            await page.evaluate(mode => themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight), mode);
            const normal = await graphStyles();
            await page.emulateMedia({ forcedColors: 'active' });
            await page.evaluate(() => themeQA.inspector.refreshTheme());
            assert.deepEqual(await graphStyles(), normal, 'forced colors must not collapse the palette during internal measurement');
            await page.emulateMedia({ forcedColors: 'none' });
        }
    } finally {
        await page.emulateMedia({ forcedColors: 'none' });
        await pollution.evaluate(element => element.remove());
        await page.evaluate(() => themeQA.inspector.setTheme(null));
    }

    const measurements = await page.evaluate(() => {
        const root = document.createElement('div');
        root.className = 'zenfg-inspector';
        root.style.cssText = 'width:400px;height:100px;font:24px/36px Arial;color:#234567;color-scheme:dark;--zfgi-graph-font-family:Arial;--audit-accent:#ff0000;--zfgi-graph-render-stroke:var(--audit-accent);';
        document.body.append(root);
        const reference = document.createElement('span');
        root.append(reference);
        const lengths = ['.5em', '.8rem', 'calc(50% + 2px)', 'clamp(10px, .8rem, 20px)', '2ch', '1lh', '1cap', '10cqw'];
        const expected = lengths.map(value => {
            reference.style.fontSize = value;
            return parseFloat(getComputedStyle(reference).fontSize);
        });
        reference.remove();
        const css = document.createElement('style');
        css.textContent = 'span { color:inherit!important; font:33px serif!important } .zenfg-inspector > [aria-hidden="true"] { all:unset!important; font:47px serif!important; }';
        document.head.append(css);
        try {
            const actual = lengths.map(value => {
                root.style.setProperty('--zfgi-graph-font-size', value);
                return themeQA.resolveGraphTheme(root).fontSize;
            });
            root.style.setProperty('--zfgi-graph-text', 'currentColor');
            root.style.setProperty('--zfgi-graph-render-fill', 'light-dark(#112233, #445566)');
            root.style.setProperty('--zfgi-graph-compute-fill', 'color-mix(in srgb, var(--audit-accent) 50%, var(--missing-accent, #000000))');
            const dark = themeQA.resolveGraphTheme(root);
            root.style.colorScheme = 'light';
            root.style.setProperty('--audit-accent', '#0000ff');
            const light = themeQA.resolveGraphTheme(root);
            return { lengths, expected, actual, dark, light, childCount: root.childElementCount };
        } finally { css.remove(); root.remove(); }
    });
    for (let i = 0; i < measurements.lengths.length; i++) {
        assert.ok(Math.abs(measurements.actual[i] - measurements.expected[i]) < 0.001,
            `${measurements.lengths[i]} must retain the Inspector's font and container context: ${measurements.actual[i]} vs ${measurements.expected[i]}`);
    }
    assert.equal(measurements.dark.text, 'rgb(35, 69, 103)', 'currentColor inherits from the Inspector');
    assert.equal(measurements.dark.render.fill, 'rgb(68, 85, 102)', 'light-dark retains the Inspector color scheme');
    assert.equal(measurements.light.render.fill, 'rgb(17, 34, 51)');
    assert.equal(measurements.dark.render.stroke, 'rgb(255, 0, 0)');
    assert.equal(measurements.light.render.stroke, 'rgb(0, 0, 255)', 'updated custom properties are re-read');
    assert.equal(measurements.dark.compute.fill, 'rgba(128, 0, 0, 1)');
    assert.equal(measurements.light.compute.fill, 'rgba(0, 0, 128, 1)');
    assert.equal(measurements.childCount, 0, 'temporary measurement elements are removed');
}
