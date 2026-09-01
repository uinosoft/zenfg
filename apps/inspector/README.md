# ZenFG Inspector application

This private workspace application builds the embeddable `@zenfg/inspector`
package into a backend-free static workbench. It supports file selection,
drag-and-drop, legacy migration feedback, and validation errors.

```sh
npm run dev:inspector
npm run build --workspace @zenfg/inspector-app
```

The root development command builds the workspace packages once before Vite
starts, so it also works from a clean checkout where package `dist` directories
do not exist yet.

The `dist` directory is deployable static output. CI assembles it under
`/inspector/` alongside the project site and deploys the complete static tree
to GitHub Pages after all TypeScript, Rust, and cross-language jobs pass.
Browser automation frameworks and their runtime dependencies are intentionally
not part of this repository.
