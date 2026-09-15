import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstances, source } from '../src/scene.ts';
test('static source is pinned and the local scene remains procedural', () => {
    assert.match(source.url, /074196ac869561d0d0fedba3a88795adbac747c1/);
    assert.equal(source.streaming, false);
    assert.equal(createInstances().length, 5);
});
