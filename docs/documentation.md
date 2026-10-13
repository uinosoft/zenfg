# Documentation maintenance

Each responsibility has one editable source. Package READMEs own installation
and navigation. Simple packages keep usage in README, complex
packages use their own guides, and concepts/migrations belong to the implementing
package or crate. Root docs own project maintenance. API contracts live in source
comments; complete workflows live
in compile-checked package examples. The root README owns the project introduction.

## Commands

- `pnpm run docs:generate`: update README metadata and package Skills from their authoritative sources.
- `pnpm run docs:check`: check metadata/Skill drift, public API comments and Markdown links.
- `pnpm run docs:test`: run documentation pipeline regression tests.
- `pnpm run docs:test:browser`: check the merged build in headless Chromium (Edge on Windows); screenshots go to `.test-dist/docs-browser`. Install Chromium with `pnpm exec playwright install chromium` on other systems.
- `pnpm run dev`: serve the whole project at `http://127.0.0.1:5173/`, including `/docs/`.
- `pnpm run dev:docs`: serve docs independently at `http://127.0.0.1:5174/docs/`.
- `pnpm run docs:build`: build the VitePress site independently.
- `pnpm run build:pages`: build and merge both sites into `apps/site/dist`.
- `pnpm run preview:pages`: build and preview at `http://127.0.0.1:4173/zenfg/`.

`SITE_BASE` selects the deploy prefix and defaults to `/zenfg/` for builds and
`/` for development. `SITE_DEV_PORT` and `DOCS_DEV_PORT` override the default
5173 and 5174 ports. Development and production generation use separate ignored
directories, so a build does not overwrite a running docs session. Source changes
regenerate documentation and restart the docs server with a fresh search index;
the existing application server stays available. Fetch Git tags when checking out CI sources: Rust API links
identify the latest tagged release of each crate independently. The website
version panel separates manifest-derived development source versions from
published component releases identified by those tags. A checkout with no
release tags reports that limitation rather than inventing a published version.

## Editing sources

`scripts/docs/catalog.mjs` is the public content allowlist and source-to-route map.
Add a guide there to include it in the website, navigation, search and Markdown
export. Maintenance documents are deliberately excluded. Edit existing Markdown
files, never `apps/docs/.generated` or built output. The page's edit link points
back to its source. TypeDoc discovers all public TypeScript entries through the
same function as the public documentation checker.

After changing a public workflow, update its source comment and affected example.
Quick starts are extracted from each installed npm package usage source for TypeScript
checking; Rust usage guides remain crate-level rustdoc and doctest inputs. Markdown
links inside a package must resolve inside its packed artifact. Explicit repository
revisions retain their historical meaning; new cross-package guidance can use
clearly labeled development links. Only generated release entries follow manifest
tags. The website projects guidance onto current internal routes and labels itself
as development documentation. Rustdoc includes the same Rust usage source with
reference-link overrides to accessible development pages; the packaged guide keeps
its local references. After cargo doc, CI checks the actual HTML links with
`node scripts/docs/check.mjs --rustdoc`.

`scripts/docs/legacy-anchors.json` records the pre-migration GitHub and VitePress anchors separately. Source and
built-site checks preserve them, including aliases after a heading changes.
Built checks also reject an old HEAD or changed page/recipe sources, so stale
artifacts cannot stand in for final-source acceptance.

## Generated metadata and formats

Do not edit `generated:*` blocks. Versions, install commands, badges, release
links and compatibility rows come from their original metadata. Run
`pnpm run docs:generate` after version changes and commit the resulting README
changes with the release. Package Skills are also generated and committed;
prepack checks drift without
rewriting tracked sources. API Markdown, website pages, search and llms.txt are
build artifacts and are not committed.

Every public page has a plain Markdown alternative. `/docs/llms.txt` is generated
from the same page metadata and links to focused documents rather than duplicating
an API catalog. These standard derived formats are allowed; a manually maintained
AI.md or second machine-specific corpus is not. Installed package READMEs and
source remain the foundation for offline or version-specific use.

## Language, layout and badges

English is the authoritative source for technical prose and API comments.
Public Markdown pages in the catalog have adjacent `*.zh-CN.md` derivatives;
the same files serve GitHub, installed packages and VitePress. English docs keep
their existing routes; Chinese pages use `/docs/zh-CN/`. API reference and code
remain English. Package Skills are generated exclusively from English sources.
Maintenance documents and non-catalog READMEs are not translated.

The homepage keeps its own application dictionary. VitePress interface strings
use its locale configuration. Neither is part of the Markdown translation cache;
the applications share only the `zenfg-language` preference. A documentation
URL determines its language, while homepage links follow the chosen language.
Docs share the project navigation, palette and `zenfg-theme` preference.

### Translation workflow

- `pnpm run docs:i18n:status --json` lists source paths, sibling translations,
  current source hashes and missing/pending/stale/invalid/ready states.
- `pnpm run docs:i18n:seed` creates missing pending files using English placeholder
  content. Existing Chinese prose is preserved, and existing metadata is never refreshed.
- Translate or review only affected siblings. Preserve heading order, code blocks,
  inline code, explicit anchor IDs, marker comments and link destinations. Local
  links may point to the catalog's Chinese siblings. Do not edit generated blocks.
- Run `pnpm run docs:generate`, then
  `pnpm run docs:i18n:accept SOURCE --source-hash=HASH` using the hash captured when
  reading the English source. Acceptance checks the expected source version,
  localizes links and adds English heading aliases. Review the translation diff;
  structural checks cannot prove semantic equivalence or translation completeness.
- Run `pnpm run docs:check`. Missing, pending, stale, invalid and orphan translations
  fail checks and production documentation builds. Model calls never run during builds.

The invisible translation comment records format version, English source, source
hash and pending/ready state. Hashes normalize BOM/line endings and ignore generated
block values; metadata synchronization checks those blocks separately. Update the
English facts first and synchronize affected translations in the same task. Wording
improvements may edit Chinese alone. Source and translation hashes both participate
in built-output freshness checks.

During initial scaffolding only, set `DOCS_I18N_ALLOW_PENDING=1` to preview pending
files locally (PowerShell: `$env:DOCS_I18N_ALLOW_PENDING='1'`). This permits pending
files, never missing, stale or invalid ones, and is disabled whenever `CI` is set.
HTML and raw Markdown display a pending notice. Unset the variable before final
acceptance; do not configure it in publishing or CI. The initial root Chinese README
is also pending until its existing prose has been reconciled with the English source.

Root READMEs show project CI, docs, license and beta status; the package table
shows independent registry versions. npm READMEs show their registry version,
API docs and license. Cargo READMEs show their registry version, versioned docs.rs
and license. Private apps, examples and maintenance guides need no badges.
Registry badges are live channel indicators, not installed-version evidence.
The website removes the top badge block and uses its own navigation and version panel.

VitePress 1.6.4 uses a scoped Vite 6.4.3 override to receive the development-server
security fixes while retaining the stable documentation framework. Build and browser
checks cover this combination. The project site keeps its existing Vite version.

Project navigation connects the homepage, Inspector, Examples and docs; the documentation sidebar navigates technical content. The brand always links to the project homepage. Cross-application links use native same-tab navigation. Keep documentation customization within public VitePress configuration and slots.

The browser suite can also target a running development server: set `SITE_BASE=/` and `DOCS_TEST_ORIGIN=http://127.0.0.1:5173` before running `pnpm run docs:test:browser`. This exercises Vite Markdown module loading as well as the raw Markdown endpoints.

## Package Skills

A complex package declares its authoritative usage file with a usage-source HTML
comment in README; without one, README is authoritative. This one source feeds
Quick Start validation, website projection and Skills. Mark the applicability
paragraph and focused operation/constraint regions with paired skill:id:start/end
HTML comments. The generator derives identity from package.json and rebases prose
links while preserving code. Do not mark a whole specification or copy the website.

Run docs:generate after metadata or marked text changes and commit the generated
skills/<package-identity>/SKILL.md. docs:check and prepack reject drift. Docs and
Skills ship in the same package; read relative links from the real SKILL.md path.
There is no installer or postinstall configuration. pnpm 12.11.2 discovers approved
direct dependencies; permission is a consumer decision. pack:check verifies this
in temporary projects, including revocation, without global agent configuration.
See [pnpm Agent Skills](https://pnpm.io/agent-skills) for discovery and permissions.
Cargo guides stay in their crates; Rust Skill distribution is deferred.
