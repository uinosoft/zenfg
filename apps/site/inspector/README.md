# ZenFG Inspector application

This private Site page mounts the embeddable `@zenfg/inspector`
workbench directly into a full-viewport host. The component itself provides
branding, file selection, drag-and-drop, legacy migration feedback, and
validation errors, so the page adds no duplicate header or controls.

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

The 60px host header matches Examples: a linked ZenFG brand, an Inspector label,
and moon/sun buttons selecting Dark (Tokyo Night Storm) or Light. The app stores
its own preference under `zenfg-inspector-theme`; first use defaults to Dark.
The embedded component neither reads browser storage nor changes global appearance.

See [Inspector theming](../../../packages/inspector/THEMING.md) for the component API.

The Canvas/DOM acceptance script `node apps/site/inspector/tests/browser/themes.mjs`
(ran from the repository root) uses a synthetic compiler-produced Snapshot and
requires no WebGPU adapter. Set `PLAYWRIGHT_MODULE` to an existing Playwright
installation when needed. Screenshots and its report are written beneath
`.test-dist/inspector-theme-qa`.
