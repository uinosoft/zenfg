import assert from 'node:assert/strict';
import test from 'node:test';
import { defaults, textOptions, textChanged, updateSettings } from '../src/settings.ts';
import { textMatrix } from '../src/scene.ts';

test('raster switches retain authored effects but only send them to MSDF', () => {
    const authored = updateSettings(defaults, { outline: 0.03, shadow: true, shadowX: -0.03 });
    for (const mode of ['bitmap', 'slug'] as const) {
        const switched = updateSettings(authored, { mode });
        const options = textOptions(switched, 2);
        assert.equal(options.style.outline, undefined);
        assert.equal(options.style.shadow, undefined);
        assert.deepEqual(textOptions(updateSettings(switched, { mode: 'msdf' }), 2), textOptions(authored, 2));
    }
});
test('bitmap strike choices express exact ppem through the documented pixel ratio', () => {
    for (const fontSize of [12, 64, 160]) for (const strike of ['32', '64', '128'] as const) {
        const options = textOptions({ ...defaults, mode: 'bitmap', fontSize, strike }, 2);
        assert.equal(options.rasterPixelRatio * fontSize, Number(strike));
    }
    assert.equal(textOptions(defaults, 1.5).rasterPixelRatio, 1.5);
});
test('spatial changes preserve shaping while text and paragraph edits invalidate it', () => {
    assert.equal(textChanged(defaults, { ...defaults, scale: 2, tilt: 30 }), false);
    for (const patch of [{ text: '' }, { width: 200 }, { mode: 'slug' as const }, { fontSize: 24 }])
        assert.equal(textChanged(defaults, updateSettings(defaults, patch)), true);
    assert.throws(() => updateSettings(defaults, { outline: 0.5 }), /Invalid outline/);
    assert.throws(() => updateSettings(defaults, { scale: NaN }), /Invalid scale/);
});
test('text plane centers the layout and flips its y axis before projection', () => {
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const matrix = textMatrix(identity, defaults, 160);
    assert.ok(Math.abs(matrix[0] * defaults.width / 2 + matrix[12]) < 1e-6);
    assert.ok(Math.abs(matrix[5] * 80 + matrix[13]) < 1e-6);
    assert.ok(matrix[0] > 0 && matrix[5] < 0);
});
