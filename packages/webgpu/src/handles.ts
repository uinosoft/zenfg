import type {
	BufferHandle,
	ResourceHandle,
	TextureHandle,
	TextureViewHandle,
} from './types.ts';

const handleOwner = Symbol('FrameGraphRecordingOwner');

type OwnedHandle = { readonly [handleOwner]: object };

function withOwner<T extends object>(handle: T, owner: object): T {
	Object.defineProperty(handle, handleOwner, { value: owner });
	return handle;
}

export function makeTextureHandle(id: number, label: string | undefined, owner: object): TextureHandle {
	return withOwner({ id, kind: 'texture', label, __brand: 'TextureHandle' } as TextureHandle, owner);
}

export function makeBufferHandle(id: number, label: string | undefined, owner: object): BufferHandle {
	return withOwner({ id, kind: 'buffer', label, __brand: 'BufferHandle' } as BufferHandle, owner);
}

export function makeTextureViewHandle(id: number, label: string | undefined, owner: object): TextureViewHandle {
	return withOwner({ id, kind: 'texture-view', label, __brand: 'TextureViewHandle' } as TextureViewHandle, owner);
}

export function isHandleOwnedBy(handle: ResourceHandle | TextureViewHandle, owner: object): boolean {
	return (handle as unknown as Partial<OwnedHandle>)[handleOwner] === owner;
}

export function sameResource(a: ResourceHandle, b: ResourceHandle): boolean {
	return a === b;
}
