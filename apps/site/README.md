# ZenFG project site

This private workspace application owns the root of the ZenFG project site.
It intentionally stays small: package documentation and the standalone
Inspector remain independently built surfaces.

```sh
npm run dev:site
npm run build --workspace @zenfg/site-app
```

The Pages assembly script places this output at the site root and the
standalone Inspector at `/inspector/`.
