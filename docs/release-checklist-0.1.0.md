# ZenFG 0.1.0 release checklist

- Date: 2026-08-31
- Initial public commit: the commit containing this checklist
  (`feat: initialize ZenFG monorepo`)
- Status: developer/AI hardening committed and locally verified; registry
  credential recheck remains pending

This checklist defines and records the local `0.1.0` release candidate. Rows
1-13 and 15-22 contain the fresh 2026-08-31 hardening rerun. Registry login and
token permissions still require their manual release-session check in row 14. The
public GitHub repository was created separately and the local `origin` is
configured, but this checklist does not push commits, create tags, publish
packages, or switch downstream consumers. The frozen migration manifest is not
regenerated during release preparation.

## Repository and registry identities

- npm organization and scope: `@zenfg`
- GitHub owner and repository: `uinosoft/zenfg`
- public repository URL: `https://github.com/uinosoft/zenfg`
- SSH remote: `git@github.com:uinosoft/zenfg.git`
- npm registry: `https://registry.npmjs.org/`
- Cargo registry: `crates-io`

Before publishing, create and verify the npm organization, verify npm login and
2FA, verify crates.io email and token permissions, and recheck that all five
package names remain available. The first npm publication is an interactive
local 2FA release and therefore does not claim GitHub provenance.

## Candidate verification

Run the checks in this order and replace each pending result with the observed
result before committing the candidate.

| # | Check | Result |
| ---: | --- | --- |
| 1 | `npm run typecheck` | Passed: all four TypeScript workspaces and all seven public recipes |
| 2 | `npm test` | Passed: 294/294 tests |
| 3 | `npm run test:cross-language` | Passed: seven mirrored producer cases and the Rust integration test |
| 4 | `npm run build` | Passed: three packages and the static Inspector app; only the existing Vite chunk-size advisory was emitted |
| 5 | Remove all package `dist/` directories, then `npm run pack:check` | Passed: all `prepack` rebuilds, runtime imports, packaged Quick Starts and recipes, source-backed declaration maps, and a strict TypeScript 6.0.3 consumer |
| 6 | `npm publish --dry-run --access public --tag next` for each of the three npm packages | Passed: Snapshot 86 files, WebGPU 88 files, Inspector 133 files |
| 7 | `cargo fmt --all --check` | Passed |
| 8 | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | Passed |
| 9 | `cargo test --workspace --all-features` | Passed: 100 `zenfg` test functions, seven trybuild cases, five `zenfg-snapshot` tests, and four README doctests |
| 10 | `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --all-features --no-deps` | Passed for both crates |
| 11 | `npm run cargo:package-check` | Passed: Snapshot 13 files/147.6 KiB (28.0 KiB compressed); runtime 52 files/527.9 KiB (95.3 KiB compressed); both extracted archives and their examples compile externally |
| 12 | `cargo publish --dry-run -p zenfg-snapshot --locked --allow-dirty` | Passed with the single accepted warning below |
| 13 | Confirm no obsolete organization-owned repository URLs remain | Passed |
| 14 | Recheck credentials, licenses, package contents, and downstream coupling | Partially complete: no embedded credential or forbidden dependency hits, LICENSE copies are identical, and all five archives were inspected; npm login/2FA and crates.io token permissions remain a manual release-session check |
| 15 | `git diff --cached --check`; commit; clean status with the expected remote and no tag | Passed: staged diff validation completed before the hardening commit; branch is `main`, `origin` points to `uinosoft/zenfg`, the post-commit worktree is clean, and there are zero tags |

The counts and sizes in rows 2, 6, 9, 11, and 22 are observed results from the
fresh 2026-08-31 rerun. Re-run and update them again if the candidate changes
before the release commit.

### Developer and AI friendliness acceptance

These additions passed locally in the final hardening rerun. They do not
authorize publishing or tagging on their own.

| # | Check | Result |
| ---: | --- | --- |
| 16 | `npm run docs:check` validates package-root public documentation and internal documentation links | Passed: five TypeScript entrypoints, 118 exports, 39 public methods, 68 deferred Rust top-level types, and 49 local Markdown links |
| 17 | `npx tsc --project packages/webgpu/examples/tsconfig.json --noEmit` checks all seven public-entrypoint TypeScript recipes | Passed: all seven recipes compile under the package-local strict consumer config |
| 18 | `cargo test --workspace --all-features --doc` and `cargo check --workspace --all-features --examples` check README doctests and all seven Rust recipes | Passed: four README doctests, seven mirrored runtime recipes, and the Snapshot `basic` example |
| 19 | Run `minimal-frame`, `snapshot-export` with feature `snapshot`, and `zenfg-snapshot`'s `basic` example; GPU-dependent recipes require compile checks only | Passed: all three CPU-only examples executed successfully; every GPU-dependent recipe compiled |
| 20 | From actual npm tarballs, compile the documented package Quick Starts and recipes with TypeScript 6, `skipLibCheck: false`, and no workspace path aliases | Passed: Snapshot, WebGPU, and Inspector Quick Starts plus all seven packaged recipes under TypeScript 6.0.3 |
| 21 | Verify every published `.d.ts.map` uses relative sources that exist in the same tarball; reject absolute paths and workspace leakage | Passed: every declaration map resolves only to packaged `src/` files |
| 22 | Inspect all five package archives, then replace historical file counts and sizes in this checklist with observed values | Passed: npm Snapshot 86 files/90.7 KiB (510.0 KiB unpacked), WebGPU 88/213.6 KiB (1065.8 KiB unpacked), Inspector 133/206.2 KiB (1049.8 KiB unpacked); Cargo Snapshot 13/147.6 KiB and runtime 52/527.9 KiB |

Step 5 must start without generated package output. The package-level `prepack`
scripts must rebuild the required artifacts, and the tarball smoke test must
typecheck a clean TypeScript 6 consumer with DOM and ES2022 libraries,
`types: []`, and `skipLibCheck: false`.

The only accepted Cargo packaging warning is emitted for `zenfg-snapshot`
because its workspace-level cross-language conformance test intentionally uses
the shared npm corpus outside the crate package. The packaged library, unit
tests, and validation corpus remain covered by the workspace and archive
checks.

Before `zenfg-snapshot@0.1.0` is visible in the crates.io index, a normal
`cargo publish --dry-run -p zenfg` cannot resolve its optional registry
dependency. For this bootstrap only, the workspace-external archive check in
`npm run cargo:package-check` is the release-candidate acceptance test for
`zenfg`. Run the ordinary Cargo dry-run after publishing `zenfg-snapshot` and
before publishing `zenfg`.

## Future component tags

The release candidate creates no tag. After publishing and clean-consumer
verification, create these annotated tags at the same release commit:

- `npm/snapshot/v0.1.0`
- `npm/webgpu/v0.1.0`
- `npm/inspector/v0.1.0`
- `cargo/zenfg-snapshot/v0.1.0`
- `cargo/zenfg/v0.1.0`

## Publication handoff

1. Use the empty public GitHub repository at `uinosoft/zenfg` without generated
   README, license, or ignore files. The local `origin` is already configured as
   `git@github.com:uinosoft/zenfg.git`.
2. Push `main` and wait for the `typescript`, `rust`, and `cross-language` CI
   jobs to pass.
3. Configure branch protection to prevent force-push and deletion.
4. Publish `@zenfg/snapshot@0.1.0` under the npm `next` tag.
5. Publish `zenfg-snapshot@0.1.0`, then wait until it is resolvable from the
   crates.io index.
6. Publish `@zenfg/webgpu@0.1.0` under `next`, then publish `zenfg@0.1.0`.
7. Publish `@zenfg/inspector@0.1.0` under `next`.
8. Validate exact versions from new npm and Cargo consumers, promote the three
   npm packages to `latest`, remove `next`, and create the five annotated tags
   and matching GitHub Releases.

If npm Trusted Publishing is adopted later, configure GitHub owner
`uinosoft` and repository `zenfg`; the npm scope and GitHub owner do not need
to match.

## Failure recovery

- After a registry timeout, query the registry before retrying so an already
  accepted upload is not repeated.
- npm versions should be deprecated if a faulty immutable tarball escaped;
  publish the fix as `0.1.1`.
- Cargo versions cannot be overwritten. Yank a faulty crate version and
  publish `0.1.1`.
- Do not delete the t3d-next or zen-proto implementations until registry
  publication and downstream replacement are both complete.
