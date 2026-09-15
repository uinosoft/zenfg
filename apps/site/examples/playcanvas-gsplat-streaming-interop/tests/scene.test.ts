import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstances, source } from '../src/scene.ts';
test('streaming uses the selected CDN capture and a deterministic small mesh scene', () => {
    assert.equal(source.url, 'https://code.playcanvas.com/examples_data/example_roman_parish_02/lod-meta.json');
    assert.deepEqual(createInstances(), createInstances());
    assert.equal(createInstances().length, 32);
    assert.equal(source.streaming, true);
});
