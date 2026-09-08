# Debug panel optimization validation

Validated on 2026-09-08 with Windows, Node.js 24.19 and a real Chromium-based
in-app browser. No browser automation dependency was added to the repository.

## Review and acceptance sequence

Each intermediate commit was assembled and checked independently, in order.
The final worktree was then checked with the entire repository test suite.

| Stage | Scope | Independent validation |
| --- | --- | --- |
| 1 — `90db010` | Information correctness, diagnostics, stable culled IDs, Memory geometry and estimate availability | Package build, Inspector typecheck, 111/111 Inspector and Snapshot tests |
| 2 — `0efbcd1` | Overview, searchable lists, independent group tree, diagnostic disclosures and Graph search | Package build, Inspector typecheck, 123/123 Inspector and Snapshot tests |
| 3 — `1cfa98e` | Dock/drawer, canonical details, explicit navigation, capture feedback and keyboard behavior | Package build, Inspector typecheck, 146/146 Inspector, Snapshot and related Playground tests |
| 4 — `perf(inspector): defer inactive views and cache capture details` | Deferred page rendering, per-capture Memory and Raw caches, integration tests and documentation | 451/451 repository tests; all workspace and example typechecks; production Pages build; documentation check |

Memory filters accompany the Stage 1 axis replacement so both filtered and
unfiltered rows use the same geometry. The minimal explicit navigation plumbing
accompanies Stage 2 actions so intermediate buttons remain usable. Stage 3 keeps
page refreshes and Raw regeneration synchronous; Stage 4 introduces caching and
deferred rendering. The unused pairwise alias speculation was removed with the
Stage 1 information corrections.

## Browser acceptance record

The standalone application and Playground were served from production builds.
Stage 1, 2 and 3 also used separately built intermediate Inspector packages.
Screenshots and read-only DOM measurements were inspected during the run.

| Surface / dimensions | Observed result |
| --- | --- |
| Standalone, 1440×900 | Initial Graph with no selection or details; collapsed legend; all six main tabs available |
| Standalone, 1280×720 | Passes starts with 4/4 rows, retained execution order followed by culled; detail defaults to 340px; resizing to 480px keeps a 772px main area |
| Standalone, 1000×720 | Detail clamps to 332px, main remains 640px and the separator is 8px; document width remains 1000px |
| Standalone, 700×720 | Modal drawer constrains keyboard focus; explicit Graph reveal closes it and focuses the Graph tab; document width remains 700px |
| Standalone, 500×720 | Long diagnostics wrap in one scrolling content area; auxiliary resource columns collapse; document width remains 500px |
| Playground, 1440×900 | Real WebGPU capture reports five passes; ungrouped capture hides Graph grouping controls; pointer drag changes detail width from 340px to approximately 444px |
| Playground, 1280×720 | Host width approximately 1099px; document width 1280px; resource list and commands remain contained |
| Playground, 1000×720 | Host width 858px uses drawer; document width 1000px; Escape closes details before the outer Playground overlay |
| Playground, 500×720 | Host width 482px; filters wrap and auxiliary columns move out of the list; document width 500px; Escape returns focus to the initiating resource |

Specific browser checks:

- Diagnostics: six messages, two per severity, five with the same code; stable
  severity ordering preserved every message. A 2959-character message remained
  complete. Warning filtering reported 2/6. Culled and node/resource associations
  remained independently accessible. Missing capture time was explicit.
- Lists: All showed 4/4 passes; Culled showed 1/4. The group tree initially showed
  both Main and PostFX, with its own path search and measured-pass coverage.
  A 486-character resource name stayed contained and accessible through details.
- Memory: two aliased single-slot resources occupied adjacent halves of the same
  747.640625px track. Their bars measured 373.8125px each; axis and row tracks had
  identical left edges and widths. Searching for the second resource preserved
  the track and bar coordinates. Internal timeline scrolling remained available.
- Details: canonical Raw displayed `$.graph.resources[2]`; field search and full
  object copy worked. A missing Graph representation closed the drawer, focused
  the fallback action, and allowed navigation to Resources. Successful recovery
  cleared the obsolete failure message.
- Keyboard: main/detail tabs, export-menu Escape, drawer focus wrapping and
  focus restoration were exercised. The Playground overlay remained open after
  its Inspector handled Escape, and closed on a subsequent unhandled Escape.
- Large capture: a validated 5001-pass Snapshot showed the 5000-element budget
  notice. The inactive Passes page initially had zero rendered rows; opening it
  rendered the list, and searching `Pass 5000` returned 1/5001.

## Automated coverage and commands

```sh
node scripts/run-tests.mjs
npm run typecheck:examples
npm run typecheck --workspaces --if-present
npm run build:pages
npm run docs:check
git diff --check
```

The test runner also builds all packages. Coverage includes canonical and Legacy
round trips, invalid and stale captures/imports, retained↔culled ID transitions,
all canonical Raw object kinds, complete-object copy under search, diagnostic
duplicates, unavailable/partial/zero timing and allocations, nonzero and missing
lifetimes, adjacent/overlapping slots, independent expansion, async Graph reveal
cancellation, drawer geometry/focus, and large-capture deferred rendering.

Snapshot 1.1, Inspector public exports and export format are unchanged. There is
no cross-session UI persistence, virtual scrolling, new UI framework or new JSON
editor dependency. Production builds retain the existing large-chunk advisory
for ELK and other heavy dependencies; builds complete successfully.
