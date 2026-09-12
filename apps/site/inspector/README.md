# ZenFG Inspector application

This private Site page mounts the embeddable `@zenfg/inspector`
workbench directly into a full-viewport host. The component itself provides
file selection, drag-and-drop, legacy migration feedback, and validation errors.
The page hides component branding and supplies the shared site navigation header.

```sh
npm run dev
npm run build:site
```

For the integrated Site, Inspector, and Playground development workflow, see
the website development section in [`CONTRIBUTING.md`](../../../CONTRIBUTING.md).

The Site `dist` directory is deployable static output. The MPA build emits this
page under `/inspector/` alongside the project site and Playground, then CI
deploys the complete static tree to GitHub Pages after all TypeScript, Rust, and
cross-language jobs pass.
Browser automation frameworks and their runtime dependencies are intentionally
not part of this repository.

## Appearance

The shared 60px site header links Home, Inspector and Playground and selects
Dark (Tokyo Night Storm) or Light. Appearance uses the site-wide `zenfg-theme`
preference, defaulting to Dark. See the [Site shell documentation](../README.md#shared-site-shell)
for migration, mobile navigation and cross-tab synchronization. The embedded
component neither reads browser storage nor changes global appearance.

See [Inspector theming](../../../packages/inspector/THEMING.md) for the component API.

The Canvas/DOM acceptance script `node apps/site/inspector/tests/browser/themes.mjs`
(ran from the repository root) uses a synthetic compiler-produced Snapshot and
requires no WebGPU adapter. Set `PLAYWRIGHT_MODULE` to an existing Playwright
installation when needed. Screenshots and its report are written beneath
`.test-dist/inspector-theme-qa`.
