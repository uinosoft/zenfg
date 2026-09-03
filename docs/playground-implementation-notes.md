# Playground implementation notes

> Temporary implementation document. Delete this file after the Playground has
> shipped and its durable contracts have been moved to the relevant package and
> application READMEs. This file is not a normative source of ZenFG behavior.

## Outcome

Build the Playground as a third, independently built static application next
to the project site and the standalone Inspector. It presents runnable demos,
the exact source used by those demos, and an embedded FrameGraph Inspector.

Do not use Storybook for this surface. The Playground is organized around
rendering applications, source files, GPU lifecycle, and FrameGraph inspection,
not isolated UI components.

## Non-negotiable boundaries

1. Example code belongs to the package or repository domain that explains it.
   It must not import Playground modules or know about Playground routing,
   panels, source display, controls, or Inspector embedding.
2. Playground catalog adapters own all presentation integration: metadata,
   routing, mounting into the preview canvas, source tabs, and attaching a
   running graph to the Inspector.
3. The code displayed in the Playground must be imported from the same source
   files that are built and executed. Do not maintain copied code snippets.
4. Production publication is decided by the production import graph. Merely
   hiding an example at runtime is not a publication boundary.
5. The project site must not depend on the Playground application or its syntax
   highlighting dependencies.

The dependency direction is:

```text
example implementation  <-  Playground catalog adapter  ->  Playground UI
                                      |
                                      +--------------------> Inspector adapter
```

An example can expose ordinary runtime state such as its `FrameGraph`, resize
hook, and disposer. Those are useful application-level capabilities and are not
Playground concepts.

## Repository layout

Use the following ownership model:

```text
packages/<package>/examples/recipes/
    Self-contained package recipes that can ship in the npm package.

packages/<package>/examples/integrations/<name>/
    Integration examples that are conceptually owned by the package but are
    hosted and executed only by the repository Playground.

examples/<name>/
    Private workspaces for cross-package demos, cover stories, and larger
    application-like examples that do not naturally belong to one package.

apps/playground/src/catalog/public/
    Production adapters for examples published on the website.

apps/playground/src/catalog/local/
    Development-only adapters that are absent from the production import graph.
```

Add `examples/*` to the root workspace patterns when the first repository-level
example is introduced. Each such example workspace must be marked `private`.

Choose an example home by the following rules:

- Put a focused demonstration of one package's supported API in that package's
  `examples/recipes` directory.
- Put an integration with a third-party renderer or abstraction in the owning
  package's `examples/integrations` directory when proximity helps explain the
  package and assists code/AI navigation.
- Put a demo in the root `examples` directory when it combines several ZenFG
  packages, represents a visual story or complete application, or has no single
  natural package owner.
- Put only Playground-specific adaptation in `apps/playground/src/catalog`.

## Example interface and Playground adapter

Keep the implementation API small and host-neutral. For example:

```ts
export async function createExample(options: {
  canvas: HTMLCanvasElement;
}) {
  // Create the device, resources, and FrameGraph passes.

  return {
    frameGraph,
    resize(width: number, height: number) {},
    dispose() {},
  };
}
```

The catalog adapter performs the Playground integration:

```ts
import exampleSource from "../../path/to/example.ts?raw";

export default {
  id: "example-id",
  title: "Example title",
  files: [
    {
      name: "example.ts",
      language: "typescript",
      source: exampleSource,
    },
  ],
  async mount(context) {
    const { createExample } = await import("../../path/to/example");
    const running = await createExample({ canvas: context.canvas });
    context.inspector.attach(running.frameGraph);
    return () => running.dispose();
  },
};
```

This adapter is allowed to depend on Playground APIs. The example implementation
is not.

Prefer explicit adapters over injecting Playground metadata into example source.
This keeps example code useful in documentation, copyable into applications,
and unambiguous to automated coding tools.

## Third-party integration dependencies

An integration example may live under a package without making its third-party
library a production dependency of that package.

For example, a TypeGPU integration can live at:

```text
packages/webgpu/examples/integrations/typegpu/
```

If the example directly imports TypeGPU, declare TypeGPU in
`packages/webgpu/package.json` as a `devDependency`. Do not add it to
`dependencies`, `peerDependencies`, or `optionalDependencies` solely for the
hosted example. Repository installation, example type-checking, and the
Playground build can use the development dependency, while consumers of
`@zenfg/webgpu` do not receive it transitively.

Treat repository location and npm publication as separate decisions. Package
the self-contained recipes, but exclude hosted integrations from the npm
tarball by narrowing the package `files` list, for example from all of
`examples` to `examples/recipes`. The integration remains adjacent to the
WebGPU package in the repository and remains runnable in the Playground.

The package build should compile only the library source. A separate examples
type-check should cover both recipes and integrations. The Playground build is
the build that produces the runnable browser artifact and bundles the
third-party integration into a lazy example chunk.

## Discovery and publication

Use separate production and local catalogs:

```ts
// Production catalog
const publicExamples = import.meta.glob("./catalog/public/*.ts");

// Local development catalog
const localExamples = import.meta.glob("./catalog/{public,local}/*.ts");
```

Only the production catalog may be reachable from the production entry point.
Do not rely on `published: false`, CSS hiding, or an unlisted route to exclude
code that has already been statically imported.

Example modules should be dynamically imported so Vite produces per-example
chunks. Loading one demo must not initialize every demo or download every
third-party integration.

## Source display and highlighting

Import displayed TypeScript, GLSL, and WGSL source with Vite's `?raw` imports.
Use Shiki for read-only highlighting with only these languages and the selected
theme included. Create one highlighter instance and lazy-load it when the user
first opens the Code panel.

Do not load Shiki on the project homepage. Do not add Monaco or CodeMirror for
the initial read-only experience. CodeMirror can be evaluated later if examples
become editable.

The initial source viewer should provide:

- file tabs or a file list;
- TypeScript, GLSL, and WGSL highlighting;
- line numbers and a copy action;
- horizontal scrolling without affecting the page layout;
- a compact file selector on narrow screens.

## Static build and deployment

Create `apps/playground` as a private Vite and TypeScript workspace. Extend the
root build and Pages assembly so the result is:

```text
.pages/
  index.html
  assets/
  inspector/
    index.html
  playground/
    index.html
```

The existing GitHub Pages workflow already uploads the complete `.pages`
directory, so it should not need a separate deployment job. Update the Pages
assembly script to require `apps/playground/dist`, copy it to
`.pages/playground`, and validate `.pages/playground/index.html`.

Use one static Playground entry point initially. Select examples with a URL that
works without a history fallback:

```text
/playground/?example=interactive-background
```

A hash route is also acceptable. Do not introduce clean nested routes until
there is a concrete need for generated per-example HTML or a reliable history
fallback.

The homepage cover-story badge should link to the corresponding Playground
example with a relative URL. The Playground and Inspector should be lazy-loaded
and must not increase the homepage application bundle.

## Cover story requirements

The existing interactive homepage background becomes the first cover story and
the first end-to-end Playground example. Its reusable rendering implementation
should be separated from homepage presentation without adding Playground imports
to that implementation.

The Playground presentation must show:

- the live WebGPU result;
- the exact TypeScript and WGSL source used by the running example;
- the actual multi-pass FrameGraph and resource dependencies in the embedded
  Inspector;
- an understandable unsupported-WebGPU state.

The project homepage remains responsible for its own text, links, language
switching, responsive behavior, pointer interaction, reduced-motion behavior,
and non-WebGPU fallback.

## Implementation sequence

1. Create the private `apps/playground` workspace and static shell.
2. Define the catalog adapter contract and separate public/local registries.
3. Extract or expose the cover-story implementation through a host-neutral API.
4. Add live preview lifecycle and resource cleanup.
5. Add exact-source loading and lazy Shiki highlighting.
6. Embed the FrameGraph Inspector through the catalog adapter.
7. Add the homepage badge and static-safe example URL.
8. Add Playground build output to Pages assembly and CI validation.
9. Add tests for catalog uniqueness, production exclusion, mount/dispose, and
   Pages assembly.
10. Replace the obsolete Storybook note in `docs/README.md` with the durable
    Playground documentation.
11. Move lasting conventions to the appropriate READMEs and delete this file.

## Completion and deletion checklist

Delete this temporary document only after:

- the cover-story link, preview, source viewer, and Inspector work in production;
- public and local examples are separated at build time;
- package recipes, hosted integrations, and root examples have documented
  ownership rules;
- third-party integration dependencies do not leak into library runtime or peer
  dependencies;
- npm package validation confirms hosted integrations are excluded as intended;
- the project site remains independently built and usable without WebGPU;
- durable commands and contribution rules are documented in application/package
  READMEs;
- the Storybook placeholder in `docs/README.md` has been removed or replaced.
