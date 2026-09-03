# ZenFG project site

This private workspace application owns the root of the ZenFG project site.
It intentionally stays small: package documentation, the Playground, and the
standalone Inspector remain independently built surfaces. The cover background
is shared from the private `@zenfg-example/interactive-background` workspace.

```sh
npm run dev:site
npm run build --workspace @zenfg/site-app
```

For the integrated Site, Inspector, and Playground development workflow, see
the website development section in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

The Pages assembly script places this output at the site root, the standalone
Inspector at `/inspector/`, and the interactive example workbench at
`/playground/`.
