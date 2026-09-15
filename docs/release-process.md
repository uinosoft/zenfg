# Release process

ZenFG packages have independent versions. A release selects one or more of
the three npm packages and two Cargo crates from a single committed source.
The publishing workflow is `publish.yml`; the trusted GitHub environment is
`release`. Ordinary pushes and pull requests never publish packages.

## One-time setup

Configure Trusted Publishing separately for each npm package and crate:

| Field | Value |
| --- | --- |
| GitHub owner | uinosoft |
| Repository | zenfg |
| Workflow filename | publish.yml |
| Environment | release |

On npm, enable **Allow npm publish**. The workflow publishes directly after
GitHub approval; it does not use npm staged publishing. Beta versions use
`next`; versions without a prerelease suffix use `latest` immediately.
There is no later automatic dist-tag promotion. After a successful OIDC
release, disable traditional npm publishing tokens and revoke obsolete tokens.

Create the `release` GitHub Environment with `shawn0326` as required reviewer,
self-review allowed, administrator bypass disabled, and only the `main`
branch permitted. Keep it separate from `github-pages`.

Require pull requests and the four checks from `checks.yml` on `main`:
TypeScript, Rust, cross-language, and release-preflight. Use the actual check
names reported by GitHub after the shared workflow first runs. Do not require
another person's PR approval for this single-maintainer repository.
Prevent updates/deletion of component tags and enable immutable releases.

Only the protected publish job receives `id-token: write`. Only the final
GitHub Release job receives `contents: write`. The workflow uses GitHub-hosted
Ubuntu runners, fixed Node/npm/Rust versions and SHA-pinned actions. Release
builds do not restore PR caches. No npm token, Cargo token, or PAT is stored
as a repository secret. The Cargo auth action obtains its temporary token
immediately before Cargo publication.

## Decide which packages to release

Compare each package with its own most recent component tag. For example:

~~~sh
git log npm/webgpu/v0.1.0-beta.3..HEAD -- packages/webgpu
git diff npm/webgpu/v0.1.0-beta.3 HEAD -- packages/webgpu
~~~

- Release when shipped implementation, public types, assets, packaged examples,
  required metadata or dependency declarations change in a way consumers need.
- Review shared build scripts and configuration too: changes outside the package
  directory can change the resulting archive.
- CI-only, test-only and website-only changes usually do not require a package
  release. A changed file count is an investigation aid, not the release decision.
- If a dependent needs a newer internal dependency, update its exact dependency
  and release the dependent as well. A compatible dependency fix does not by itself
  require releasing every other package.
- For Snapshot wire changes, check the producer/reader migration together and
  document any coordinated upgrade. Package versions remain independent.

For beta.4 all five packages have consumer-visible changes since their own beta.3
tags: Snapshot 1.2 readers, unified runtime timing, and Inspector features/fixes.

## Prepare a release PR

1. Decide which packages need a release. Do not change versions during the
   publishing workflow.
2. Bump their manifests. Update exact internal dependency versions as needed;
   an internal dependency's version does not have to equal the dependent's version.
3. Explicitly update `package-lock.json` and `Cargo.lock`. Regenerate public
   version documentation with `npm run docs:generate`.
4. Add one dated note per selected package under `docs/releases/`:
   `npm-snapshot-VERSION.md`, `npm-webgpu-VERSION.md`,
   `npm-inspector-VERSION.md`, `cargo-zenfg-snapshot-VERSION.md`, or
   `cargo-zenfg-VERSION.md`. Include beta suffixes literally. For example:

   ~~~markdown
   # @zenfg/snapshot 0.1.0-beta.4

   Date: 2026-09-15

   Describe the actual changes and link any migration instructions.
   ~~~

   Replace this example with the package version selected for the release.
   Record corresponding component/version changes in `CHANGELOG.md`;
   keep exactly one Unreleased section. Keep historical checklists intact.
5. Review Snapshot compatibility. Current source produces Snapshot 1.2,
   while released beta.3 used 1.1. Reader migrations and producer changes
   may require a coordinated subset even though versions are independent.
6. Merge the PR after all quality checks pass.

The five existing beta.3 versions are occupied and cannot be republished.
Building the CI infrastructure does not itself cut a new version.

## Validate a candidate

Open Actions → Publish → Run workflow, choose `main`, select the packages,
and leave `dry_run` enabled for the first run.

The workflow freezes the dispatch SHA and repeats the full quality checks.
Selected versions must be unoccupied; each exact internal dependency must
already be available in its registry or be selected at the required version.
Missing dependencies are reported rather than automatically added.

Candidate npm consumers install only selected tarballs; unselected dependencies
come from npm. Export imports, CSS, README Quick Starts, packaged examples,
TypeScript declarations, runtime-produced Snapshots and the Snapshot corpus
are checked outside the workspace.

Cargo 1.98 supports native multi-package dry-runs:

~~~sh
cargo publish --dry-run --locked --all-features \
  -p zenfg-snapshot -p zenfg --registry crates-io
~~~

Cargo's own temporary registry verifies the selected archives together,
including unpublished internal dependencies. For a runtime-only release,
its exact Snapshot dependency must already be available. Candidate publication
never uses `--allow-dirty`, `--no-verify`, `--exclude-lockfile`, or a local patch.
Additional archive consumer checks may patch only the verified selected
archives into a temporary consumer; these do not replace the native dry-run.
Registry consumers use no patches.

Review the `release-candidate` artifact and run summary: names, versions,
channels, dependencies, commit SHA, file lists, archive checksums, notes,
logs and consumer results. Artifacts are retained for 90 days.

## Publish and verify

Start a **new** workflow run with the intended source and selection, turning
`dry_run` off. That run builds its own candidate. Review it and approve the
`release` Environment. A dry-run run cannot be changed into a publishing run.

The selected subset is published in this order:

1. npm Snapshot.
2. Cargo crates in Cargo's dependency order.
3. npm WebGPU.
4. npm Inspector.

npm uploads the exact checked `.tgz`, without running lifecycle scripts.
Cargo repackages from the fixed checkout with `--locked --all-features`.
Its final dry-run archive must match the approved checksum before upload;
the actual published archive is checked again afterward.

The registry verification job downloads public archives, compares SHA-256,
checks npm dist-tags and provenance metadata, and runs clean exact-version
consumers. Rust consumers execute CPU-only examples and Snapshot decoding.
When both ecosystems are selected, npm readers decode Rust output and Rust
readers decode TypeScript runtime output.

After verification, the final job creates component Releases with
`npm/SLUG/vVERSION` or `cargo/CRATE/vVERSION` tags at the original commit.
Artifacts and manifest/verification reports are attached to drafts before
publication. Prerelease versions are marked prerelease. Component releases
do not claim a single repository-wide "latest" version.

## Failure and recovery

Registries cannot commit a multi-package release atomically. Stable npm
packages enter `latest` as each upload completes.

- A fresh run rejects occupied versions. On partial failure, use
  **Re-run failed jobs** on the original workflow run.
- A full rerun restores the original candidate artifact from the same run.
  It never silently rebuilds a partially published candidate.
- Existing versions are skipped only if registry checksums match the approved
  candidate. Mismatches and yanked crates block recovery.
- After an upload error/timeout, check registry acceptance before retrying.
  HTTP 401/403, rate limits, server errors and network errors are failures,
  not evidence that a version is unused.
- Missing/expired original artifacts block automatic recovery. Investigate
  retained evidence; do not force an occupied version through.
- If verification or Release creation fails after upload, rerun failed jobs.
  Finalization uses the verification job's artifact ID even when it came
  from an earlier attempt.
- OIDC does not repair npm dist-tags. Inspect and correct channel mismatches
  interactively with npm 2FA when appropriate.
- Faulty immutable packages require a new version; use npm deprecation or
  Cargo yank when necessary. Never move existing component tags.

## Local and PR checks

~~~sh
npm run release:check
npm run release:test
npm run release:smoke:npm
npm run release:smoke:cargo
~~~

These commands never upload. Smoke checks allow dirty local Cargo sources for
development, while actual release candidates enforce a clean checkout.
Daily CI does not require unoccupied versions or new release notes.

`npm run cargo:release-check` remains a manual runtime-only gate against an
already-published Snapshot dependency, with evidence under
`target/release-validation/`. The publishing workflow uses its own selected
package dry-run and does not depend on that manual gate.

Dry-runs prove packaging and compatibility, not registry authorization.
The first actual beta release must verify all Trusted Publishers and npm provenance.
