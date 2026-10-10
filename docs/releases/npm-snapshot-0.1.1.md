# @zenfg/snapshot 0.1.1

Date: 2026-10-10

### Fixed

- Validate group ancestry with a linear iterative traversal, avoiding recursion
  and repeated parent-chain scans in deeply nested captures.
- Preserve existing issue messages, issue ordering and first-match references
  when duplicate group IDs are present.
- Extend the shipped conformance corpus with parent-chain cases and aligned
  producer projections for contiguous and padded texture-buffer copies.

### Compatibility

This is a compatible validator fix. Public codec APIs and the portable
Snapshot wire format remain unchanged at 1.2. Canonical 1.1 still requires the
explicit existing migration; canonical 1.0 remains rejected. No capture rewrite
is required when upgrading from 0.1.0.

The runtime and Inspector releases select this exact dependency version; see
[the migration guide](../migration-0.2.0.md) for the independent package versions.

### References

[PR #25](https://github.com/uinosoft/zenfg/pull/25), especially
[the iterative ancestry fix](https://github.com/uinosoft/zenfg/commit/060b3b0).
