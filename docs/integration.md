# Integration levels

ZenFG supports three depths of integration.

1. **Opaque external submission** — a renderer declares resource access and
   performs its own encoding and submission. ZenFG treats it as an ordered,
   opaque boundary.
2. **Command integration** — a subsystem records commands into a
   FrameGraph-owned encoder while retaining its own pipelines and resource
   binding policy.
3. **Native render/compute/copy** — work uses ZenFG's structured pass and copy
   declarations, enabling the richest validation and diagnostics.

Different levels may be mixed in one frame. Cross-renderer composition still
requires a shared device/queue and accurate declarations for every
graph-visible access. ZenFG does not make unrelated engine resource models
interoperable automatically.
