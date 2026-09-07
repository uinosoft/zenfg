import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraFrameTransform } from '../src/camera-session.ts';
import { LatestTransition } from '../src/latest-transition.ts';
import { squareCanvasFraction } from '../src/light-input.ts';
import {
    MODEL_REVISION,
    modelVariant,
} from '../src/model-store.ts';

test('model variants follow shader-f16 availability at the pinned revision', () => {
    assert.equal(MODEL_REVISION, '913a7c13ddfbd48549279555d1db98172e8e5e0d');
    assert.deepEqual(modelVariant('small', true), { bundle: 'depthart-relative-s-448-balanced', megabytes: 13 });
    assert.deepEqual(modelVariant('small', false), { bundle: 'depthart-relative-s-448-f32', megabytes: 23 });
    assert.deepEqual(modelVariant('base', false), { bundle: 'depthart-relative-b-448-f32', megabytes: 43 });
    assert.equal(modelVariant('large', false), undefined);
});

test('latest transition rejects stale commits and retains the last committed source', () => {
    const transition = new LatestTransition<'demo' | 'camera' | 'upload'>('demo');
    const camera = transition.begin('camera');
    const upload = transition.begin('upload');
    assert.equal(transition.commit(camera), false);
    assert.equal(transition.committed, 'demo');
    assert.equal(transition.commit(upload), true);
    assert.equal(transition.committed, 'upload');
    transition.invalidate();
    assert.equal(transition.isCurrent(upload), false);
});

test('camera orientation and square pointer mapping match the displayed crop', () => {
    assert.deepEqual(cameraFrameTransform(false, 'portrait-primary'), {
        uvTransform: [1, 0, 0, 1], swapAxes: false,
    });
    assert.deepEqual(cameraFrameTransform(true, 'portrait-primary'), {
        uvTransform: [0, -1, 1, 0], swapAxes: true,
    });
    assert.deepEqual(cameraFrameTransform(true, 'landscape-primary'), {
        uvTransform: [-1, 0, 0, -1], swapAxes: false,
    });

    const rect = { left: 10, top: 20, width: 200, height: 100 };
    assert.deepEqual(squareCanvasFraction(rect, 110, 70), { x: 0.5, y: 0.5 });
    assert.deepEqual(squareCanvasFraction(rect, 60, 20), { x: 0, y: 0 });
    assert.equal(squareCanvasFraction(rect, 20, 70), undefined);
});
