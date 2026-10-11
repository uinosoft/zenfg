# pnpm migration validation

Local observations from 2026-10-11, starting at commit
`b8404b4a3891bb5bd39e855dd0d4425b4ddbc4ef`.

## Scope

The JavaScript workspace uses pnpm 12.11.2 for installation, dependency-ordered
builds and packing. The separately pinned npm 11.11.0 CLI handles registry uploads
and isolated npm consumers. Node 24.19.0 and TypeScript 6.0.3 were used locally.

Internal dependencies use exact `workspace:VERSION` references. Public package
versions remain independent and unchanged. Cargo retains its lockfile, rustup
configuration, compilation and publication; pnpm Cargo integration and pipeline
caching remain disabled.

## Observed Windows checks

| Check | Result |
| --- | --- |
| Full typecheck | Passed for script tests, examples and all five JavaScript workspaces |
| Aggregated Node tests | 830 passed, 0 failed |
| Release tests | 36 passed, 0 failed |
| Documentation tests | 9 passed, 0 failed |
| Cross-language producer conformance | 9 mirrored TS/Rust cases passed |
| Package packing and external consumers | Three real tgz archives passed content, rewritten manifest, exports, declaration-map, runtime and TypeScript checks in empty npm and pnpm projects |
| Site/documentation production build | 196 HTML pages passed deep-link, prefix and Markdown checks |
| Documentation browser checks | Headless Edge passed navigation, search, theme and 1440/800/390/320px layouts |
| Review documentation fixes | Glyph/Examples command passed 48 tests; filtered Site typecheck passed; current-documentation command scan found no remaining invalid entry |
| Frozen-lock drift fixture | Copied complete workspace passed frozen validation; an unsynchronized Docs dependency change was rejected |

The full typecheck and Node-test logs are retained in the ignored
`target/pnpm-validation/typecheck.log` and `tests.log`. Other local logs and
machine-readable summaries remain under that ignored evidence directory; large
dependency stores and temporary consumers are not repository artifacts.

## Cold installation and publication-tool smoke

Two fresh, isolated dependency stores and metadata caches on Windows were used.
Each install selected 263 packages for the current platform, reported
`reused 0`, and downloaded all 263. This is dependency cold-install evidence;
the Node and pnpm executables were already available.

- `pnpm install --frozen-lockfile` passed in about 61 seconds and ran the two
  approved esbuild installation scripts.
- A separate `pnpm install --frozen-lockfile --ignore-scripts` passed in about
  95 seconds and ran no dependency installation scripts.
- After the second install, npm 11.11.0, esbuild 0.28.2 and VitePress's esbuild
  0.25.12 worked. Release static checks passed, and the existing three candidate
  archives passed hash/manifest checks and the npm release consumer, including
  declarations, documented examples, runtime imports and Snapshot producer/codec
  checks. The archives were reused without rebuilding or uploading them.
- The pnpm lock SHA-256 stayed
  `c1bed1e0873bd071882cc72393aaa001ceaa850c33fd704087da5627f38a58f9`.

Validation data stayed on a separate local output tree with a 2 GiB logical-file
budget; the measured total was 1,868 MiB. These timings are observations, not a
package-manager benchmark.

## Checked local npm archives

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `zenfg-snapshot-0.1.1.tgz` | 130021 | `11e70cd3d304edaca4dd0fb00b0fcf83c78df69cb9a46502d8f66bde24976197` |
| `zenfg-webgpu-0.2.0.tgz` | 242718 | `f8b6b403812dc7fa8c43ff7ebfa3bd6018869fcc4a1f3af6e108e64866a4ab4a` |
| `zenfg-inspector-0.2.0.tgz` | 428426 | `5b6e4213a523ec25592dd5efaadefb16555fa6623d378fb5496b08f75be130e2` |

## Remaining boundaries

Linux/GitHub Actions and actual remote OIDC publication were not exercised by
these local Windows checks. The normal pull-request CI is intended to cover the
Linux workflow; actual trusted publication remains a formal release operation.

All three npm publication dry-runs exited with failure because those versions
were already published. This confirms existing-version rejection and is not a
successful publication dry-run. No version was bumped to bypass that protection.
The pre-existing optional React peer warning was not resolved by upgrading React.
