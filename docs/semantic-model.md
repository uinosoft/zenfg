# Semantic model

## Content validity

Transient resources and surface textures begin with `undefined` contents.
Imported resources begin `defined` by default and may explicitly opt into
`undefined`. A read or preserving write requires defined contents over its full
declared range. An overwrite does not consume the old value; a discard makes
the written range undefined.

Texture dependencies operate on normalized mip/layer or mip/depth-slice
regions. Buffer dependencies operate on byte ranges. Omitted buffer size means
the remainder of the resource.

## Dependencies and scheduling

RAW dependencies carry values from producers to consumers. WAR and WAW edges
preserve ordering. Value dependencies can retain producers; ordering-only work
does not become observable by itself.

Roots make work observable: presentation, explicit output, readback, side
effects, debug capture, and imported persistent state. Compilation walks those
roots, culls unreachable work, and retains a stable subsequence of recording
order. ZenFG does not reorder or merge nodes.

## Lifetimes and aliasing

Retained execution order defines transient lifetimes. Compatible allocations
whose lifetimes do not overlap may alias. Snapshot byte counts describe ZenFG's
logical descriptors and pool buckets, not driver-reported physical memory.

## Execution segments

Native render, compute, copy, clear, and command nodes are encoded into
FrameGraph-owned command segments. Opaque external submissions split those
segments and execute caller-owned queue work at a declared boundary. An opaque
segment is an ordering interval, not a claim about the exact number of native
submissions made inside it.
