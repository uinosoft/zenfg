import { FRAME_GRAPH_ERROR_CODES, FrameGraphError } from './error.ts';
import type { ResourcePoolScope } from './types.ts';

const scopes = new WeakMap<ResourcePoolScope, { readonly owner: object; readonly index: number }>();

export function createResourcePoolScope(owner: object, index: number): ResourcePoolScope {
  const scope = Object.freeze({}) as ResourcePoolScope;
  scopes.set(scope, { owner, index });
  return scope;
}

export function assertResourcePoolScope(scope: ResourcePoolScope, owner: object): void {
  if (scopes.get(scope)?.owner !== owner) {
    throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.ForeignResourcePoolScope,
      'Resource pool scope does not belong to this FrameGraph runtime.', { phase: 'record' });
  }
}

export function scopedPoolKey(key: string, scope: ResourcePoolScope | undefined): string {
  return scope === undefined ? key : 'scope:' + scopes.get(scope)!.index + '|' + key;
}
