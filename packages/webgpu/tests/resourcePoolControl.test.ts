import assert from 'node:assert/strict';
import test from 'node:test';
import { runResourcePoolControl } from '../examples/resource-pool-control.ts';
import { FrameGraph, FrameGraphError, type ResourcePoolEntryInfo, type ResourcePoolScope } from '../src/index.ts';
import { buffer, bufferUsage, mockDevice, texture, textureUsage } from './testUtils.ts';

function buffers(graph: FrameGraph, scopes: readonly (ResourcePoolScope | undefined)[], overlapping = false, size = 33) {
  const frame = graph.beginFrame();
  const handles = scopes.map(scope => frame.createBuffer({ size }, { scope }));
  if (overlapping) frame.clearBuffer({ operations: handles.map(target => ({ target })), sideEffect: true });
  else for (const target of handles) frame.clearBuffer({ operations: [{ target }], sideEffect: true });
  return frame.compile({ report: true });
}

function entries(graph: FrameGraph) {
  const result: ResourcePoolEntryInfo[] = [];
  const report = graph.evictResourcePool(info => { result.push(info); return false; });
  assert.deepEqual(report, { evictedCount: 0, estimatedEvictedBytes: 0 });
  return result;
}

test('scope partitions both aliasing and reuse, preserves defaults, and survives clearing', () => {
  const graph = new FrameGraph(mockDevice());
  const a = graph.createResourcePoolScope(), b = graph.createResourcePoolScope();
  assert.notEqual(a, b);
  assert.deepEqual(Reflect.ownKeys(a), []);
  assert.ok(Object.isFrozen(a));
  const compiled = buffers(graph, [a, a, b, undefined, undefined]);
  assert.equal(compiled.compilationReport.allocations.length, 3);
  assert.equal(new Set(compiled.compilationReport.allocations.map(item => item.compatibilityClassId)).size, 3);
  compiled.execute();
  assert.equal(graph.getResourcePoolStats().createdCount, 3);
  compiled.execute();
  assert.equal(graph.getResourcePoolStats().reuseCount, 3);
  graph.clearResourcePool(a);
  assert.equal(graph.getResourcePoolStats().retainedCount, 2);
  compiled.execute(); // old TS plans are still valid, and recreate the cleared cache
  assert.equal(graph.getResourcePoolStats().createdCount, 4);
  assert.equal(entries(graph).filter(info => info.scope === a).length, 1);
  assert.deepEqual(graph.evictResourcePool(info => info.scope === undefined),
    { evictedCount: 1, estimatedEvictedBytes: 64 });
  graph.clearResourcePool(undefined); // explicitly undefined still clears all partitions
  assert.equal(graph.getResourcePoolStats().retainedCount, 0);
  buffers(graph, [a]).execute();
  graph.destroy();
  assert.throws(() => compiled.execute(), /destroyed/);
});

test('foreign and forged scopes fail before resource registration or clearing', () => {
  const graph = new FrameGraph(mockDevice()), other = new FrameGraph(mockDevice());
  const foreign = other.createResourcePoolScope();
  for (const scope of [foreign, Object.freeze({}) as ResourcePoolScope]) {
    const frame = graph.beginFrame();
    assert.throws(() => frame.createBuffer({ size: 4 }, { scope }), (error) =>
      error instanceof FrameGraphError && error.code === 'FG2014');
    assert.throws(() => frame.createTexture({ format: 'rgba8unorm', size: [1, 1] }, { scope }), /scope/);
    assert.equal(frame.createBuffer({ size: 4 }).id, 1);
    assert.throws(() => graph.clearResourcePool(scope), /scope/);
  }
  assert.deepEqual(graph.getResourcePoolStats(), { acquireCount: 0, reuseCount: 0, createdCount: 0, retainedCount: 0, estimatedRetainedBytes: 0 });
});

test('age is per physical instance and advances only on accepted executions', () => {
  const graph = new FrameGraph(mockDevice());
  buffers(graph, [undefined, undefined], true).execute({ frameIndex: 100 });
  const saved = entries(graph);
  assert.deepEqual(saved.map(info => info.unusedExecutions), [0, 0]);
  const empty = graph.beginFrame().compile();
  assert.throws(() => empty.execute({ frameIndex: -1 }), /frameIndex/);
  assert.deepEqual(entries(graph).map(info => info.unusedExecutions), [0, 0]);
  empty.execute({ frameIndex: 0 });
  buffers(graph, [undefined]).execute({ frameIndex: 0 });
  assert.deepEqual(entries(graph).map(info => info.unusedExecutions).sort(), [0, 2]);
  assert.deepEqual(saved.map(info => info.unusedExecutions), [0, 0]); // snapshots never change
  assert.deepEqual(graph.evictResourcePool(info => info.unusedExecutions > 1),
    { evictedCount: 1, estimatedEvictedBytes: 64 });
  assert.equal(graph.getResourcePoolStats().retainedCount, 1);
});

test('partial allocation failure returns acquired metadata and still ages idle instances', () => {
  const base = mockDevice();
  const device = { ...base, createTexture() { throw new Error('allocation failure'); } } as unknown as GPUDevice;
  const graph = new FrameGraph(device);
  buffers(graph, [undefined], false, 4).execute();
  const frame = graph.beginFrame();
  const scratch = frame.createBuffer({ size: 33 });
  frame.clearBuffer({ operations: [{ target: scratch }], sideEffect: true });
  const target = frame.createTexture({ format: 'rgba8unorm', size: [1, 1] });
  frame.render({ colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }], sideEffect: true });
  assert.throws(() => frame.compile().execute(), /allocation failure/);
  assert.deepEqual(entries(graph).map(info => [info.estimatedBytes, info.unusedExecutions]).sort((a, b) => a[0]! - b[0]!),
    [[4, 1], [64, 0]]);
});

test('selection throw, non-boolean and async returns leave the whole pool unchanged', async () => {
  const graph = new FrameGraph(mockDevice());
  buffers(graph, [undefined, undefined], true).execute();
  const before = graph.getResourcePoolStats();
  let calls = 0;
  assert.throws(() => graph.evictResourcePool(() => { if (++calls === 2) throw new Error('predicate'); return true; }), /predicate/);
  assert.equal(calls, 2);
  assert.deepEqual(graph.getResourcePoolStats(), before);
  for (const value of [1, undefined, Promise.resolve(true), Promise.reject(new Error('async predicate'))]) {
    calls = 0;
    const predicate = (() => ++calls === 1 ? true : value) as (info: ResourcePoolEntryInfo) => boolean;
    assert.throws(() => graph.evictResourcePool(predicate), /synchronously return a boolean/);
    assert.deepEqual(graph.getResourcePoolStats(), before);
  }
  await new Promise(resolve => setImmediate(resolve)); // rejected async return is consumed
  assert.deepEqual(graph.evictResourcePool(() => true), { evictedCount: 2, estimatedEvictedBytes: 128 });
  buffers(graph, [undefined]).execute(); // guard recovers after each failure
});

test('same-runtime maintenance rejects all pool-changing and execution reentry', () => {
  const graph = new FrameGraph(mockDevice());
  const compiled = buffers(graph, [undefined, undefined], true);
  compiled.execute();
  const before = graph.getResourcePoolStats();
  const other = new FrameGraph(mockDevice());
  const operations = [
    () => graph.clearResourcePool(),
    () => graph.evictResourcePool(() => false),
    () => graph.destroy(),
    () => compiled.execute(),
  ];
  for (const operation of operations) {
    let calls = 0;
    assert.throws(() => graph.evictResourcePool(() => { if (++calls === 2) operation(); return true; }),
      error => error instanceof FrameGraphError && error.code === 'FG2015');
    assert.deepEqual(graph.getResourcePoolStats(), before);
  }
  graph.evictResourcePool(() => {
    assert.deepEqual(graph.getResourcePoolStats(), before);
    other.beginFrame().compile().execute(); // unrelated runtimes remain usable
    return false;
  });
  compiled.execute();
  const frame = graph.beginFrame();
  frame.command({ sideEffect: true, encode() {
    assert.throws(() => graph.evictResourcePool(() => true), /execute.*running/);
    assert.throws(() => graph.clearResourcePool(), /execute.*running/);
  } });
  frame.compile().execute();
});

test('physical descriptor snapshots are deeply frozen, normalized and handle-free', () => {
  const graph = new FrameGraph(mockDevice());
  const scope = graph.createResourcePoolScope();
  const frame = graph.beginFrame();
  const target = frame.createTexture({ format: 'rgba8unorm', size: [4, 2], viewFormats: ['rgba8unorm-srgb'] }, { scope });
  frame.render({ colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }], sideEffect: true });
  frame.compile().execute();
  const info = entries(graph)[0]!;
  assert.equal(info.kind, 'texture');
  if (info.kind !== 'texture') return;
  assert.equal(info.estimatedBytes, 32);
  assert.equal(info.descriptor.usage, textureUsage.RENDER_ATTACHMENT);
  assert.equal(info.descriptor.dimension, '2d');
  assert.deepEqual(info.descriptor.size, { width: 4, height: 2, depthOrArrayLayers: 1 });
  assert.ok(Object.isFrozen(info) && Object.isFrozen(info.descriptor) && Object.isFrozen(info.descriptor.size)
    && Object.isFrozen(info.descriptor.viewFormats));
  assert.deepEqual(Object.keys(info).sort(), ['descriptor', 'estimatedBytes', 'kind', 'scope', 'unusedExecutions']);
  assert.throws(() => { (info.descriptor.size as { width: number }).width = 99; }, TypeError);
  graph.clearResourcePool(scope);
  assert.equal(info.descriptor.size.width, 4);
});

test('imported and surface objects never appear in eviction or runtime destruction', () => {
  let destroyed = 0;
  const nativeBuffer = buffer('import', bufferUsage.COPY_DST, 4);
  nativeBuffer.destroy = () => { destroyed++; };
  const nativeTexture = texture('surface', textureUsage.RENDER_ATTACHMENT);
  nativeTexture.destroy = () => { destroyed++; };
  const graph = new FrameGraph(mockDevice());
  const frame = graph.beginFrame();
  const imported = frame.importBuffer(nativeBuffer, { initialContents: 'undefined' });
  const surface = frame.importSwapchainTexture(nativeTexture);
  frame.clearBuffer({ operations: [{ target: imported }], sideEffect: true });
  frame.render({ colorAttachments: [{ target: surface, loadOp: 'clear', storeOp: 'store' }] });
  frame.markPresent(surface);
  frame.compile().execute();
  assert.equal(entries(graph).length, 0);
  graph.clearResourcePool();
  graph.destroy();
  assert.equal(destroyed, 0);
});

test('pool-control recipe executes with caller-owned device inputs', () => {
  assert.doesNotThrow(() => runResourcePoolControl(mockDevice()));
});

for (const stage of ['command', 'beforeSubmit', 'afterSubmit', 'external'] as const) {
  test('failed ' + stage + ' execution returns scoped instances without a completion fence', () => {
    const base = mockDevice();
    let submissions = 0;
    const graph = new FrameGraph({ ...base, queue: { ...base.queue,
      submit() { submissions++; },
      onSubmittedWorkDone() { throw new Error('unexpected completion fence'); },
    } } as unknown as GPUDevice);
    const a = graph.createResourcePoolScope(), b = graph.createResourcePoolScope();
    buffers(graph, [a]).execute();
    const frame = graph.beginFrame();
    const target = frame.createBuffer({ size: 33 }, { scope: b });
    frame.clearBuffer({ operations: [{ target }], sideEffect: true });
    const fail = (): undefined => { throw new Error('failed stage'); };
    if (stage === 'command') frame.command({ sideEffect: true, encode: fail });
    if (stage === 'external') frame.externalSubmission({ submit: fail });
    const compiled = frame.compile();
    assert.throws(() => compiled.execute({
      beforeSubmit: stage === 'beforeSubmit' ? fail : undefined,
      afterSubmit: stage === 'afterSubmit' ? fail : undefined,
    }), /failed stage/);
    assert.deepEqual(entries(graph).map(info => info.unusedExecutions).sort(), [0, 1]);
    assert.equal(submissions, stage === 'afterSubmit' || stage === 'external' ? 2 : 1);
    graph.clearResourcePool(b);
    assert.equal(entries(graph)[0]!.scope, a);
  });
}

test('eviction deletes empty buckets and metadata while keeping live partitions', () => {
  const graph = new FrameGraph(mockDevice());
  const scope = graph.createResourcePoolScope();
  buffers(graph, [scope, undefined]).execute();
  const internal = graph as unknown as { runtime: { pool: {
    buffers: Map<string, GPUBuffer[]>; metadata: Map<string, unknown>;
  } } };
  graph.clearResourcePool(scope);
  assert.equal(internal.runtime.pool.buffers.size, 1);
  assert.equal(internal.runtime.pool.metadata.size, 1);
  graph.clearResourcePool();
  assert.equal(internal.runtime.pool.buffers.size, 0);
  assert.equal(internal.runtime.pool.metadata.size, 0);
});

test('texture scopes independently partition aliasing, reuse and resize clearing', () => {
  const graph = new FrameGraph(mockDevice());
  const a = graph.createResourcePoolScope(), b = graph.createResourcePoolScope();
  const frame = graph.beginFrame();
  for (const scope of [a, a, b, undefined]) {
    const target = frame.createTexture({ format: 'rgba8unorm', size: [4, 2] }, { scope });
    frame.render({ colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }], sideEffect: true });
  }
  const compiled = frame.compile({ report: true });
  assert.equal(compiled.compilationReport.allocations.length, 3);
  compiled.execute();
  graph.clearResourcePool(a);
  assert.equal(graph.getResourcePoolStats().retainedCount, 2);
  compiled.execute();
  assert.equal(graph.getResourcePoolStats().createdCount, 4);
  assert.equal(graph.getResourcePoolStats().reuseCount, 2);
});

test('invalid submission hook parameters do not advance age or acquire cached resources', () => {
  const graph = new FrameGraph(mockDevice());
  buffers(graph, [undefined]).execute();
  const before = graph.getResourcePoolStats();
  const empty = graph.beginFrame().compile();
  const withResources = buffers(graph, [undefined]);
  const work = graph.beginFrame();
  work.command({ sideEffect: true });
  const withSegment = work.compile();

  for (const name of ['beforeSubmit', 'afterSubmit'] as const) {
    for (const value of [42, null, false, 0, 'hook', {}]) {
      for (const compiled of [empty, withResources]) {
        const options = { [name]: value } as Parameters<typeof compiled.execute>[0];
        assert.throws(() => compiled.execute(options), error =>
          error instanceof FrameGraphError && error.code === 'FG2013' && error.phase === 'execute'
            && error.context?.parameter === name);
        assert.deepEqual(entries(graph).map(info => info.unusedExecutions), [0]);
        assert.deepEqual(graph.getResourcePoolStats(), before);
      }
    }
  }

  let age = 0;
  for (const name of ['beforeSubmit', 'afterSubmit'] as const) {
    const failure = new Error(name + ' callback failure');
    const callback = (): undefined => { throw failure; };
    assert.throws(() => withSegment.execute({ [name]: callback }), error => error === failure);
    assert.deepEqual(entries(graph).map(info => info.unusedExecutions), [++age]);
  }
  empty.execute(); // valid empty execution is still counted after parameter validation
  assert.deepEqual(entries(graph).map(info => info.unusedExecutions), [++age]);
});
