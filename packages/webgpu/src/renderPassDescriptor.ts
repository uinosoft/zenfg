import { FRAME_GRAPH_ERROR_CODES, FrameGraphError } from './error.ts';
import type { WebGpuRenderPassDescriptorExtras } from './types.ts';

const graphOwnedFields = ['label', 'colorAttachments', 'depthStencilAttachment', 'timestampWrites'] as const;

/** Captures native descriptor additions without cloning caller-owned GPU objects. */
export function snapshotRenderPassDescriptorExtras(
	extras: WebGpuRenderPassDescriptorExtras | undefined,
): readonly (readonly [string, unknown])[] | undefined {
	if (extras === undefined) return undefined;
	const invalid = (reason: string): never => {
		throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidArgument,
			`FrameGraph.render() webgpuDescriptor ${reason}`, { phase: 'record' });
	};
	if (extras === null || typeof extras !== 'object' || Array.isArray(extras)) {
		return invalid('must be an object containing own enumerable string data properties.');
	}
	for (const key of graphOwnedFields) {
		if (key in extras) invalid(`cannot override graph-owned field "${key}".`);
	}
	const entries: (readonly [string, unknown])[] = [];
	for (const key of Reflect.ownKeys(extras)) {
		if (typeof key !== 'string') return invalid('cannot contain symbol fields.');
		if (graphOwnedFields.some((field) => field === key)) {
			invalid(`cannot override graph-owned field "${key}".`);
		}
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			invalid(`cannot contain reserved field "${key}".`);
		}
		const property = Object.getOwnPropertyDescriptor(extras, key)!;
		if (!property.enumerable || !('value' in property)) {
			invalid(`field "${key}" must be an enumerable data property.`);
		}
		const value: unknown = property.value;
		entries.push(Object.freeze([key, value] as const));
	}
	return Object.freeze(entries);
}
