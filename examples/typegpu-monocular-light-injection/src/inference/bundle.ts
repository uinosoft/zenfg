import type { DepthBundle, DepthOutputPolarity, DepthWeightSection } from './types.ts';

const BUNDLE_MAGIC = 'DARTBND\0';
const BUNDLE_VERSION = 1;
const HEADER_BYTES = 48;
const PAYLOAD_ALIGNMENT = 256;

type Manifest = Omit<
  DepthBundle,
  'output' | 'tensorById' | 'weightSections' | 'weightSectionById' | 'payload'
> & {
  readonly output: Omit<DepthBundle['output'], 'polarity'> & {
    readonly polarity?: DepthOutputPolarity;
  };
  readonly weightSections: readonly Omit<DepthWeightSection, 'bytes'>[];
};

export function parseDepthBundle(buffer: ArrayBuffer): DepthBundle {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error('Not a DepthART v1 bundle.');
  }
  const view = new DataView(buffer);
  const magicMatches = BUNDLE_MAGIC.split('').every(
    (char, index) => bytes[index] === char.charCodeAt(0),
  );
  if (!magicMatches || view.getUint32(8, true) !== BUNDLE_VERSION) {
    throw new Error('Not a DepthART v1 bundle.');
  }

  const manifestByteLength = view.getUint32(24, true);
  const manifestEnd = HEADER_BYTES + manifestByteLength;
  if (manifestByteLength === 0 || manifestEnd > bytes.byteLength) {
    throw new Error('DepthART bundle manifest exceeds the bundle boundary.');
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(bytes.subarray(HEADER_BYTES, manifestEnd)),
    ) as Manifest;
  } catch (error) {
    throw new Error('DepthART bundle manifest is not valid JSON.', { cause: error });
  }
  validateManifest(manifest);

  const payloadByteOffset =
    Math.ceil(manifestEnd / PAYLOAD_ALIGNMENT) * PAYLOAD_ALIGNMENT;
  if (payloadByteOffset > bytes.byteLength) {
    throw new Error('DepthART bundle payload offset exceeds the bundle boundary.');
  }
  const payload = bytes.subarray(payloadByteOffset);
  const weightSections = manifest.weightSections.map((section) => {
    const end = section.byteOffset + section.byteLength;
    if (
      !Number.isSafeInteger(section.byteOffset) ||
      !Number.isSafeInteger(section.byteLength) ||
      section.byteOffset < 0 ||
      section.byteLength <= 0 ||
      section.byteLength % 4 !== 0 ||
      end > payload.byteLength
    ) {
      throw new Error(`DepthART weight section "${section.id}" exceeds the payload boundary.`);
    }
    return { ...section, bytes: payload.subarray(section.byteOffset, end) };
  });

  return {
    ...manifest,
    output: { ...manifest.output, polarity: manifest.output.polarity ?? 'direct' },
    tensorById: new Map(manifest.tensors.map((tensor) => [tensor.id, tensor])),
    weightSections,
    weightSectionById: new Map(weightSections.map((section) => [section.id, section])),
    payload,
  };
}
function validateManifest(manifest: Manifest): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('DepthART bundle manifest must be an object.');
  }
  if (!Array.isArray(manifest.tensors) || !Array.isArray(manifest.slots) ||
      !Array.isArray(manifest.dispatches) || !Array.isArray(manifest.weightSections)) {
    throw new Error('DepthART bundle manifest is missing required arrays.');
  }
  if (!manifest.input?.tensorId || !manifest.output?.tensorId) {
    throw new Error('DepthART bundle manifest is missing input or output metadata.');
  }
  assertUniqueIds(manifest.tensors, 'tensor');
  assertUniqueIds(manifest.slots, 'slot');
  assertUniqueIds(manifest.dispatches, 'dispatch');
  assertUniqueIds(manifest.weightSections, 'weight section');
  const tensors = new Set(manifest.tensors.map((tensor) => tensor.id));
  if (!tensors.has(manifest.input.tensorId) || !tensors.has(manifest.output.tensorId)) {
    throw new Error('DepthART input and output tensors must exist in the tensor table.');
  }
  for (const tensor of manifest.tensors) {
    if (!Number.isSafeInteger(tensor.byteLength) || tensor.byteLength <= 0) {
      throw new Error(`DepthART tensor "${tensor.id}" has an invalid byte length.`);
    }
  }
}

function assertUniqueIds(entries: readonly { readonly id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (typeof entry?.id !== 'string' || entry.id.length === 0 || ids.has(entry.id)) {
      throw new Error(`DepthART ${label} identifiers must be non-empty and unique.`);
    }
    ids.add(entry.id);
  }
}
