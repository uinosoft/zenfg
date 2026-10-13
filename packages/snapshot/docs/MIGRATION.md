# @zenfg/snapshot upgrade notes

<!-- generated:language:start -->
**English** | [简体中文][documentation-zh]

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

Package API versions and Snapshot wire versions are independent. The historical
changes below apply to the named releases, not to every current integration.

## Snapshot 1.2 and package 0.1.1

Snapshot 1.2 remains canonical. Package 0.1.1 fixes ancestry validation without
changing valid captures or codec APIs. Supported 1.1 inputs are validated before
migration; CPU becomes not-collected. Legacy V0 and Candidate V1 remain readable.
Canonical 1.0 and unknown versions remain rejected. Validation and serialization
alone do not migrate. Preserve provenance and extensions; never change a version
number to invent absent capture facts.

## Snapshot readers and producers

Beta.2 produces and reads canonical Snapshot 1.0. Beta.3 produces and reads
canonical Snapshot 1.1. Neither reader accepts the other canonical version.
The existing Legacy V0 and Legacy Candidate V1 migrations do not migrate
canonical 1.0 captures. Keep a beta.2 reader for archived 1.0 files, or regenerate
captures with beta.3. Do not simply replace the version number in old files:
the required root facts cannot generally be reconstructed from graph reachability.

Native resource roots must include `resourceId`, a non-empty normalized `range`,
and `resolution: { producerNodeIds, usesInitialContents }`. A `side-effect` root
instead includes `nodeId` and has no resource, range, or resolution. Update
custom producers, test fixtures, and report adapters to this discriminated model.
Only explicit legacy migration provenance permits missing resource-root facts;
missing facts mean unknown, not empty producers or `false`.

## Release history

See [component release notes](https://github.com/uinosoft/zenfg/tree/npm/snapshot/v0.1.1/docs/releases)
for package versions and historical acceptance evidence.
