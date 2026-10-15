# Phase 4 — Real Treemap, Charts & Tables

Phase 4 wires the Treemap, "Files & Folders" table, and every derivable
analytical tab on Disk Analysis and Folder Analysis to a real completed
Phase 3 scan, replacing the Phase 1 mock `FsNode` trees those widgets
rendered until now. **No backend changes** - Phase 3's `FsNode` already
carries everything these widgets need; this phase is pure frontend
data-wiring plus two significant, previously-latent bugs real data
uncovered (see [A Real Bug This Phase
Found](#a-real-bug-this-phase-found) and [The Treemap Layout Itself Was
Wrong](#the-treemap-layout-itself-was-wrong)).

## Implemented Features

- **Treemap and "Files & Folders" table** now render the real scanned
  tree once a scan completes - both components were already generic
  over `FsNode`, so no component changes were needed, only swapping
  which tree the pages hand them.
- **New analytics utility** (`src/utils/scanAnalysis.ts`) derives
  everything the remaining tabs need from a real tree in one recursive
  pass: file-type category breakdown (by extension, via the existing
  `FILE_TYPE_CATEGORIES` table), a raw-extension breakdown, top 10
  files, top 10 folders (recursive, anywhere in scope - not just direct
  children), and a Today/This week/This month/Last 6 months/This
  year/Older timeline bucketed by `lastModified`. All of it is scoped
  to the **current breadcrumb position**, not just the scan root -
  drilling into a subfolder in the Treemap re-scopes File Types/Top
  Files/Top Folders/Timeline/Extensions to it, the same way WizTree/
  TreeSize behave.
- **Chart, File Types, Top Files, Top Folders, Timeline, Extensions**
  tabs (both pages) and the Drive Usage / Top File Types / Size
  Distribution sidebar cards now show real numbers once a scan has
  completed, with their `DemoBadge` conditionally hidden.
- **Before any scan completes, both pages render exactly as they did
  before this phase** - same mock trees, same badges. The switch to
  real data is a clean transition: a completed scan resets the
  breadcrumb/selection to its own root (via React's documented
  "adjusting state during render" pattern, not a `useEffect`, so it
  can't trigger the `react-hooks/set-state-in-effect` cascading-render
  lint error), and the page's initial mount state itself checks
  `useScanStore.getState()` directly (not just the hook) so navigating
  back to an already-scanned page starts on the real root immediately
  instead of flashing mock data for a frame.
- **Deliberately still mock** (`DemoBadge` unconditional):
  - **Users/Owners tab** (Disk Analysis) - `FsNode` has no owner field;
    Phase 2 explicitly deferred owner lookup.
  - **Duplicates tab** (Folder Analysis) - real duplicate detection is
    Phase 5's job.
  - **Network Analysis page** - untouched; no real backend yet (Phase 8).
- **Deferred, not built this pass**: the roadmap's "add persistence so
  a completed scan can be reopened without rescanning" line. A
  separable feature (new Tauri cache commands, invalidation, a reopen
  affordance) roughly the size of this whole pass again - a clear
  fast-follow rather than doubling this phase's scope. `useScanStore`'s
  result already survives page navigation within a session (it's a
  global store); what's missing is surviving an app restart.

## New/Changed Frontend Files

```
src/utils/scanAnalysis.ts    NEW - analyzeTree(), topChildrenWithOthers()
src/models/common.ts         FsNode.lastModified: string -> string | null
                              (a real scan's skipped/inaccessible subtree
                              stub genuinely has no timestamp; mock data
                              never uses the null branch)
src/utils/format.ts          formatDate/formatDateShort accept null,
                              render "-" instead of the 1970 epoch
src/utils/fsFilters.ts       "old" quick filter treats a null
                              lastModified as "not old" rather than
                              coercing it to the epoch
src/components/treemap/Treemap.tsx   dropped a redundant h-full (see
                              below) - purely additive to the flex-1
                              sizing its callers already pass
src/components/cards/Card.tsx        unchanged - see the layout bug below
                              for why several *callers* now pass
                              flex-none in bodyClassName instead
src/pages/disk-analysis/DiskAnalysisPage.tsx     real Treemap/table/tabs
src/pages/folder-analysis/FolderAnalysisPage.tsx real Treemap/table/tabs
```

## A Real Bug This Phase Found

Wiring in a scan of a large real folder (`C:\`, ~750K files) made the
Treemap render completely blank ("No data to display") with the entire
sidebar column missing too - live-verified via the same `PrintWindow`-
based screenshot driver used in Phase 3, with a temporary debug overlay
narrowing it down to `useElementSize` measuring the Treemap's container
at `height: 0` (width measured fine). Mock data never had enough rows
to reveal it; this is a genuine, pre-existing layout bug, not something
this phase's data-wiring introduced.

**Root cause**: `Card`'s body `<div>` always includes `flex-1` (`flex:
1 1 0%`) in its base classes, meant to let a card's content fill
available space by default. Several pages *also* pass an explicit fixed
height through `bodyClassName` (e.g. `"h-[230px]"`) for a card meant to
scroll its own content within a fixed box - "Files & Folders" being the
one this phase actually renders through. In flexbox, an item's
`flex-basis` (here `0%`, from `flex-1`) is what the browser uses
for main-axis sizing; the `height` property is only consulted as a
fallback when `flex-basis` is `auto`. So `flex-1`'s `flex-basis: 0%`
silently wins over `h-[230px]` - the card's body never gets the fixed
height it asked for, and its `DataTable` (itself `h-full overflow-auto`,
now also unconstrained) grows to fit **every** row instead of scrolling
within a box. With mock data's handful of rows this was invisible; a
real scan can trivially return far more rows than a mock tree ever did,
and once that content got tall enough, it starved its `flex-1` sibling
(the Treemap+sidebar grid row) of essentially all the page's height -
collapsing it to zero rather than merely looking a bit crowded.

**Fix**: every affected `bodyClassName` now also sets `flex-none`
(`flex: none` = `flex-grow: 0; flex-shrink: 0; flex-basis: auto`),
which correctly hands main-axis sizing back to the explicit `height`.
Since both `flex-1` and `flex-none` compile to the same `flex`
shorthand property, this is a straightforward last-one-wins CSS
override, not a specificity fight. Fixed everywhere this pattern
existed in the codebase, not just the two pages this phase touches
(`ComparisonPage`, `SchedulerPage`, `NetworkAnalysisPage`,
`SyncPage`) - same latent bug, same fix, verified via `tsc`/`eslint`/
`vite build` for all of them (only Disk Analysis and Folder Analysis
were re-verified live, since that's this phase's actual scope).
Also added `auto-rows-fr` to the `grid-cols-[1fr_300px]` treemap/
sidebar row on the same four pages, belt-and-suspenders: it keeps the
grid's implicit row stretched to available height rather than
shrink-to-content, though the `flex-none` fix above is what actually
mattered here.

Also dropped a redundant `h-full` from `Treemap`'s own root `<div>`
(callers already pass `flex-1`, which is the more robust way to fill a
flex-column parent's height - it doesn't depend on the parent having
already resolved a percentage-relative height the way `h-full` does).
This wasn't the actual cause of the bug above, but is a safer pattern
either way and was verified not to regress anything.

## The Treemap Layout Itself Was Wrong

Reported live, by the user, after the layout fix above: real folders
were rendering as a stack of full-width horizontal bars instead of a
proper squarified treemap - large items readable, but everything past
the first two or three squeezed into thin, easy-to-miss slivers rather
than sitting next to each other as squares. Two separate causes, both
fixed:

1. **Too many tiles.** A real folder can have hundreds of direct
   children; a mock tree never had more than about a dozen. Rendering
   every single one as its own tile is what actually produced most of
   those unreadable slivers - normal disk-usage tools cap this too.
   `Treemap` now buckets anything past the 23 largest direct children
   into one synthetic "Other (N items)" tile (`src/components/treemap/
   Treemap.tsx`'s `bucketSmallest`), sized to their combined total.
   Double-clicking it drills into the real folded-away items (re-
   bucketed the same way if there are still too many) - nothing is
   actually hidden, just visually deferred one level down.
2. **The squarify algorithm's row orientation was backwards** - a real,
   pre-existing bug in `treemapLayout.ts`, not something either fix
   above introduced. A squarified treemap keeps tiles square by always
   building the current row along the container's *shorter* side: a
   wide remaining rect should get a narrow full-height *column*, a tall
   one a full-width *strip*. The code had this inverted
   (`horizontal = rw >= rh`, i.e. exactly backwards), so for the
   landscape containers this app always renders into, the "row" was
   always a full-width strip and - since large items keep the strip to
   themselves rather than share it - the remaining width was never
   subdivided into side-by-side columns at all. Every tile ended up
   alone, spanning the full width, regardless of how much of that width
   its own size actually justified. Flipped to `horizontal = rh > rw`;
   `layoutRow`'s per-orientation math and the recursive width/height
   shrinking were already correctly paired with each other, so this one
   comparison was the entire fix. Confirmed live: the same real data
   that used to render as a stack of bars now lays out as a proper
   grid of squares/rectangles sized to their actual share of the total.

## Treemap Redesign: Recursive, WizTree-Style Nesting

Even correctly squarified, a single-level-at-a-time treemap (drill in
with a double-click to see a folder's own contents) doesn't match what
"the treemap" means in WizTree/TreeSize - their default view shows the
*entire* subtree at once, folders nested inside folders down to
individual files, all in one mosaic. Requested live, after the fixes
above, and implemented as a real rework of `Treemap.tsx` rather than a
tweak:

- `layoutRecursive` (replacing the old single-level `squarify` call)
  lays out a folder's children, and for any child that's *itself* a
  folder with room to spare (`w`/`h` both past `MIN_RECURSE_SIZE`,
  depth under `MAX_DEPTH`), recurses into it immediately - a thin
  title-strip tile (`HEADER_HEIGHT`) showing its name, with its own
  children's tiles laid out in the space below, inset by 1px. This
  nests to real depth live (Program Files → Microsoft Office → root →
  Office16 → ... was visibly ~5 levels deep in one screenshot).
- Bounded two ways, since these are real DOM `<button>`s (for click/
  hover/keyboard), not a canvas mosaic the way WizTree draws:
  `MAX_TILES_PER_LEVEL` (30) keeps any *one* folder's own row legible
  via the existing `bucketSmallest` "Other (N items)" folding, applied
  at every level now rather than just the top; `MAX_TOTAL_TILES` (500)
  is a hard budget across the *entire* recursive layout, shared via a
  mutable counter threaded through the recursion so it can bail out
  mid-folder rather than only checking between top-level items.
- **File tiles are now colored by file-type category**
  (`categorizeByExtension`, exported from `scanAnalysis.ts` for this -
  same categories, same colors as the File Types donut) instead of an
  arbitrary per-tile index - with potentially hundreds of tiles on
  screen at once, index-based color was visual noise; category color
  is actually informative (confirmed live: a Pictures/Camera Roll
  subtree lit up green for video files). Folder tiles and header strips
  use their own fixed neutral tones instead, so "this is a folder" reads
  at a glance regardless of what's inside it.
- Tile chrome tightened to match (1px gaps, no rounded corners, smaller
  label thresholds) - real folders are mostly small tiles now, and
  Phase 1's original spacious styling was designed around a mock tree's
  handful of same-order-of-magnitude items.
- `onSelect`/`onDrillDown` callback shapes are unchanged, so no caller
  (`DiskAnalysisPage`, `FolderAnalysisPage`, `NetworkAnalysisPage`)
  needed to change - double-clicking a folder tile (nested or not)
  still replaces the treemap's own root with it, now mainly useful for
  going past what the recursion/budget shows inline.

## Verification

1. `npm run typecheck` / `npm run lint` / `npm run build` - all clean,
   across every file this phase touched.
2. Live, via the same `PrintWindow` + focus/click driver Phase 3 used:
   - Scanned real `C:\` (~750K files, both via MFT and via the walk
     engine on separate runs) and a real OneDrive folder; confirmed the
     Treemap renders real tiles, Drive Usage/File Types donuts show
     real category percentages, Top Files/Top Folders/Extensions/
     Timeline tabs show real entries, and `DemoBadge`s disappear from
     every now-real widget while staying on Users/Duplicates.
   - Drilled into a subfolder and confirmed the analytics tabs
     re-scoped to it.
   - Confirmed the pre-scan default view is unchanged (mock data, every
     badge present).
   - Confirmed navigating away and back to an already-scanned page
     shows the real data immediately, not a one-frame flash of mock
     data.
   - After the orientation fix, re-confirmed on two different real
     scans (a ~750K-file `C:\` and a smaller real client-data folder)
     that tiles now lay out as an actual grid instead of stacked bars.
   - After the recursive redesign, re-confirmed on the same `C:\` scan:
     visible nesting several levels deep at once (e.g. Program Files →
     Microsoft Office → root → Office16), file tiles colored by
     category (a Pictures/Camera Roll subtree read as green - videos),
     "Other (N items)" folding kicking in at multiple levels
     simultaneously, and no visible performance issue at this scale.
