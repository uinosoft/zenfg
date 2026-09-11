import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPresetSettings, getPresetScene, parseImportedSettings, validateParticles4AllSettings } from '../src/settings';

test('effective presets come from the pinned INI with native fallback values', () => {
    for (const preset of ['small', 'medium', 'large'] as const) {
        const values = Object.fromEntries(readFileSync(`apps/site/examples/particles4all-framegraph/src/presets/${preset}.ini`, 'utf8')
            .split(/\r?\n/).filter(line => line.includes('=')).map(line => line.split('=')));
        const settings = createPresetSettings(preset);
        const scene = getPresetScene(preset);
        assert.equal(settings.displayMode, 'ssfr');
        assert.equal(settings.ssfrScale, Number(values.ssfrscale));
        assert.equal(settings.substeps, Number(values.substeps));
        assert.equal(settings.pourSpeed, values.pourspeed === undefined ? 3 : Number(values.pourspeed));
        assert.equal(settings.pourWidth, values.pourwidth === undefined ? 0.24 : Number(values.pourwidth));
        assert.equal(settings.pourHeight, values.pourheight === undefined ? 0.85 : Number(values.pourheight));
        assert.equal(scene.targetParticleCount, Number(values.particles));
        assert.deepEqual(scene.camera, values.camera!.split(' ').map(Number));
    }
    const small = createPresetSettings('small');
    small.transmission[0] = 0;
    assert.equal(createPresetSettings('small').transmission[0], 0.34902);
    const scene = getPresetScene('small');
    scene.bodies?.pop();
    assert.equal(getPresetScene('small').bodies?.length, 3);
});

test('INI preserves display mappings, scene overrides and soraverage extension without requesting a panorama', () => {
    for (const [display, mode] of ['particles', 'surface-mesh', 'surface-mesh', 'ray-march', 'ssfr'].entries()) {
        assert.equal(parseImportedSettings(`display=${display}`).settings.displayMode, mode);
    }
    const result = parseImportedSettings([
        'soraverage=1', 'raysurface=0', 'transmit=0.1, 0.2, 0.3', 'particles=42', 'spacing=0.05',
        'box=1 2 3', 'camera=-1 0.2 2', 'body=', 'bodysize=0.12',
        'cubemap="https://elsewhere.example/env/sky.hdr"', 'ssfrstretch=0', 'unknown=8',
    ].join('\n'), 'medium');
    assert.equal(result.settings.sorAverage, true);
    assert.equal(result.settings.raySurface, 'field');
    assert.equal(result.settings.rigidBodiesEnabled, false);
    assert.deepEqual(result.settings.transmission, [0.1, 0.2, 0.3]);
    assert.deepEqual(result.sceneOverrides, { targetParticleCount: 42, spacing: 0.05, box: [1, 2, 3], bodies: [], bodySize: 0.12, camera: [-1, 0.2, 2] });
    assert.equal(result.missingPanorama, 'sky.hdr');
    assert.deepEqual(result.skipped, ['ssfrstretch', 'unknown']);
});

test('malformed INI fails atomically for numbers, vectors, booleans and scene configuration', () => {
    const before = createPresetSettings('small');
    for (const text of [
        'timescale=', 'timescale=NaN', 'timescale=Infinity', 'timescale=0x1', 'timescale=1garbage',
        'hover=maybe', 'soraverage=2', 'ssfrcleanup=true', 'display=4.5', 'raysurface=3',
        'transmit=0.1 0.2', 'transmit=0.1 0.2 nope', 'box=1 2 3 4', 'camera=1 2 -3',
        'particles=0', 'particles=1.1', 'spacing=-0.1', 'ssfrfilter=2.1',
        'body=sphere:NaN', 'body=wrong:0.5', 'body=sphere:0.5:2', 'body=sphere:0.5,',
    ]) assert.throws(() => parseImportedSettings(`exposure=2\n${text}`), /Particles4All/, text);
    assert.deepEqual(createPresetSettings('small'), before);
    for (const text of ['', '# comment', 'not an INI file', 'unknown=42']) {
        assert.throws(() => parseImportedSettings(text), /no recognized settings/);
    }
    assert.throws(() => validateParticles4AllSettings({ ...before, paused: 1 as unknown as boolean }), /boolean/);
});
