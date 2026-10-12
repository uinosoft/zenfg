# zenfg-snapshot upgrade notes

Package API versions and Snapshot wire versions are independent. The historical
changes below apply to the named releases, not to every current integration.

## Snapshot 1.2 and package 0.1.1

Snapshot 1.2 remains canonical. Package 0.1.1 fixes ancestry validation without
changing valid captures or codec APIs. Supported 1.1 inputs are validated before
migration; CPU becomes not-collected. Legacy V0 and Candidate V1 remain readable.
Canonical 1.0 and unknown versions remain rejected. Validation and serialization
alone do not migrate. Preserve provenance and extensions; never change a version
number to invent absent capture facts.

## Release history

See [component release notes](https://github.com/uinosoft/zenfg/tree/cargo/zenfg-snapshot/v0.1.1/docs/releases)
for package versions and historical acceptance evidence.
