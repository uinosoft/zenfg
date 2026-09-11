import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameRate } from '../src/frameRate.ts';

test('rolling average drops old intervals and retains the window boundary', () => {
 const rate = createFrameRate();
 for (const now of [0, 100, 200, 300, 400, 500]) rate.record(now);
 assert.equal(rate.sample(500), 10);
 rate.record(600); rate.record(800);
 assert.equal(rate.sample(800), 8); // Four intervals spanning 300–800ms.
 rate.reset(); assert.equal(rate.sample(800), undefined);
});

test('empty, duplicate, stale and low-rate samples remain well defined', () => {
 const rate = createFrameRate();
 assert.equal(rate.record(0), undefined);
 assert.equal(rate.sample(0), undefined);
 assert.equal(rate.record(0), undefined);
 assert.equal(rate.record(1000), 1);
 assert.equal(rate.sample(1000), 1);
 assert.equal(rate.sample(2501), undefined);
 assert.equal(rate.record(3000), undefined);
 assert.equal(rate.record(3020), 50);
 assert.equal(rate.sample(3020), 50);
});
