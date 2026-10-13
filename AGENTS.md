# Documentation

Keep English technical documentation authoritative and owned by its package or
crate. `scripts/docs/catalog.mjs` selects public pages. Their adjacent
`*.zh-CN.md` files are derived translations used by GitHub, packages and VitePress.

When changing a catalog English page, synchronize its Chinese sibling in the same
task unless the user explicitly scopes the task to scaffolding. Read
`docs/documentation.md` for status, generation and acceptance commands. Capture the
source hash before translating; preserve code, identifiers, links and marker
comments. Do not label placeholder or unreviewed prose ready.

Keep Skills and API comments in English. Keep homepage/application copy in its
application dictionary and VitePress UI in its locale configuration; these do not
use the Markdown translation cache.
