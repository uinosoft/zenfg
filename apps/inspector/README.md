# ZenFG Inspector application

This private workspace application mounts the embeddable `@zenfg/inspector`
workbench directly into a full-viewport host. The component itself provides
branding, file selection, drag-and-drop, legacy migration feedback, and
validation errors, so the page adds no duplicate header or controls.

```sh
npm run dev:inspector
npm run build --workspace @zenfg/inspector-app
```

The root development command builds the workspace packages once before Vite
starts, so it also works from a clean checkout where package `dist` directories
do not exist yet.

The `dist` directory is deployable static output. CI assembles it under
`/inspector/` alongside the project site and Playground, then deploys the
complete static tree to GitHub Pages after all TypeScript, Rust, and
cross-language jobs pass.
Browser automation frameworks and their runtime dependencies are intentionally
not part of this repository.
