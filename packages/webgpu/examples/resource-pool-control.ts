/**
 * Source: Original ZenFG package recipe.
 * Demonstrates: Scoped resize cleanup and application-controlled idle eviction.
 * Flow: Execute one size, stop its plan, clear its scope, execute another size, evict idle cache.
 * The caller owns the device; ZenFG owns transient allocation and submission.
 * Read next: README.md and Core Concepts for pool ownership and execution counts.
 */
import { FrameGraph, type FrameGraphRecording, type ResourcePoolScope } from '@zenfg/webgpu';

/** Records a scoped clear-only target; no application pipelines are required. */
export function recordScopedTarget(frame: FrameGraphRecording, scope: ResourcePoolScope, width: number): void {
  const target = frame.createTexture({ label: 'viewport', format: 'rgba8unorm', size: [width, 4] }, { scope });
  frame.render({ label: 'clear viewport', colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }], sideEffect: true });
}

/** Demonstrates cleanup between synchronous executions, without waiting for GPU completion. */
export function runResourcePoolControl(device: GPUDevice): void {
  const graph = new FrameGraph(device);
  try {
    const scope = graph.createResourcePoolScope();
    const oldFrame = graph.beginFrame();
    recordScopedTarget(oldFrame, scope, 4);
    oldFrame.compile().execute();
    // Stop executing the old-size plan before clearing: old plans remain re-executable.
    graph.clearResourcePool(scope);
    const newFrame = graph.beginFrame();
    recordScopedTarget(newFrame, scope, 8);
    newFrame.compile().execute();
    graph.evictResourcePool(info => info.scope === scope && info.unusedExecutions > 60);
  } finally {
    graph.destroy();
  }
}
