# ZenFG project site

This private workspace application owns the complete ZenFG project site. It
builds the project home, standalone Inspector, Examples, and the
private showcase sources in one Vite multi-page application. The three application pages remain separate HTML entrypoints. VitePress docs
are generated separately and merged into the same deployment under `/docs/`.

```sh
npm run dev
npm run build:site
```

For the integrated Site, Inspector, and Examples development workflow, see
the website development section in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

The build output is directly deployable: the project site is at `/`, the
standalone Inspector at `/inspector/`, and the interactive example workbench at
`/playground/`.

## Shared site shell

The three public pages share a build-time header template and pre-paint theme
bootstrap in `shared/shell/`. The Vite plugin expands explicit HTML markers in
development and production; real relative links support subdirectory deployments.
`shared/shell/header.ts` owns only navigation and theme-button interaction.
At 800px and below, navigation opens below the 60px header without resizing the
workspace. The Home language control is not exposed on the English-only tools.

`shared/theme/controller.ts` owns the document appearance and `zenfg-theme`
preference, including cross-tab and back-forward cache synchronization. Default
appearance is Dark. Existing Inspector/Examples preferences migrate once: a
single valid value or matching values are retained; conflicting values use Dark.
The pure theme tokens and Inspector component remain independent of this policy.
Both pre-paint CSS and runtime styles derive from the canonical palette.

The home entry composes language, header, theme and background controllers.
`src/background.ts` serializes background initialization and disposal: Light
uses CSS alone, Dark lazily starts the existing WebGPU showcase, and late
callbacks cannot resurrect an obsolete background. The Examples showcase
always retains its original rendering behavior regardless of shell appearance.

Validate changes with site typechecking, `npm run build:site`, and:

```sh
npm test -- apps/site/tests packages/inspector/tests apps/site/playground/tests apps/site/examples/interactive-background/tests
```

Review production output at 1440, 1024, 800, 390 and 320px in both themes,
including Home in English and Chinese, mobile navigation, keyboard focus,
back-forward navigation and the static WebGPU fallback.

Documentation development and merged builds are described in the
[documentation workflow](../../docs/documentation.md).

## Homepage content and share previews

The Home HTML contains the initial English content; `src/language.ts` supplies
English and Chinese updates. Keep both in sync, including image alt text. Home
featured links are static and must not import the Examples catalog or engines.
`shared/social.ts` supplies build-time metadata to the Site shell and VitePress.
Canonical and social image URLs identify the public deployment, even in local
previews. Query-selected examples share the Examples page metadata.

Run `npm run brand:social` for share cards and `npm run showcase:capture` against
a running development site for real Three.js captures. See the brand and showcase
asset READMEs for source provenance. Both outputs are committed, so ordinary
builds need neither browser capture nor asset generation.

After `npm run build:pages`, serve the production tree under `/zenfg/` and run:

```sh
node apps/site/tests/browser/content.mjs
```

The default test URL is `http://127.0.0.1:4183/zenfg/`; override `CONTENT_URL`
for another preview. This checks static crawler metadata, real links and anchors,
featured IDs against the catalog, bilingual theme/layout combinations, lazy images,
and readable content without WebGPU. Run the existing `tests/browser/home.mjs`
with `HOME_URL` for hardware WebGPU cover and lifecycle acceptance.
