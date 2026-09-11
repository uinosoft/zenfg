# ZenFG project site

This private workspace application owns the complete ZenFG project site. It
builds the project home, standalone Inspector, Playground, Visual Lab, and the
private showcase sources in one Vite multi-page application. The three public
pages remain separate HTML entrypoints and are deployed together.

```sh
npm run dev
npm run build:site
```

For the integrated Site, Inspector, and Playground development workflow, see
the website development section in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

The build output is directly deployable: the project site is at `/`, the
standalone Inspector at `/inspector/`, and the interactive example workbench at
`/playground/`. Visual Lab is a separate local-only build.
