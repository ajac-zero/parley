---
title: "Charts Catalog v1 Expansion"
status: in_progress
kind: design
created: 2026-07-31T23:57:21+00:00
---

# Charts Catalog v1 Expansion

## Goals

- Expand the built-in A2UI Charts catalog beyond the current cartesian
  line, bar, area, and KPI-stat primitives.
- Keep the contract practical for Parley, its current sole consumer, while
  retaining a clear path to future independent host interoperability.
- Support common agent-generated analytics: actuals versus targets,
  time-series monitoring, composition, correlations, KPI context, and
  interactive filtering.
- Keep host rendering safe: resources select semantic options and approved
  theme tokens, never arbitrary CSS, scripts, or raw colors.

## Non-goals

- Supporting every chart family immediately. Radar, treemap, funnel, and
  specialized financial charts are deferred until concrete product cases
  establish their data and interaction contracts.
- Downloading catalog schemas or renderer code at runtime. Catalog IDs remain
  negotiated, trusted identifiers.
- Replacing the A2UI Basic Catalog. The charts catalog continues to inherit
  its components and functions unchanged.

## Design

### Versioning

Keep the catalog at `charts/v1`; do not rename it to `v1beta`.

Parley currently owns both the catalog repository and the only renderer, so a
beta rename would create catalog-ID churn without protecting a real external
compatibility boundary. Additive fields, variants, and leaf components can
evolve under v1. A `charts/v2` catalog ID is required when an existing field's
shape or meaning changes incompatibly, or if an independent consumer requires
an immutable published v1 contract.

The repository documentation currently describes version directories as
immutable. Update that statement to distinguish the actively co-developed v1
contract from a later stable-public compatibility promise, or adopt stricter
versioning before third-party adoption.

### Current baseline

`Chart` supports `line`, `bar`, and `area` variants over data-model records.
It supports multiple series, optional stack mode, an optional formatted Y axis,
height, and two-way point or range selection. `Stat` supports a labeled value,
currency or percentage formatting, and an optional relative delta.

### Capability roadmap

#### 1. Improve the current Cartesian Chart

Implemented:

- [x] Per-series rendering: `series[].type` (`line`, `bar`, `area`) while
  retaining chart-level `variant` as the default.
- [x] Named stack groups, semantic line styles, and `connectNulls` behavior.
- [x] Reference lines and shaded bands using approved theme tokens.
- [x] Bar selections include `seriesKey` and `seriesLabel`.
- [x] Independent left and right Y axes with per-series axis assignment.
- [x] Optional Y-axis domain bounds.
- [x] ISO-8601 time-axis tick and tooltip formatting.

Remaining:

- Per-series presentation: add named `stack` groups, left/right `axis`, initial
  visibility. Replace the chart-wide `stacked` Boolean only after existing
  authored resources have been migrated or its compatibility behavior is
  explicitly documented.
- The `y` field remains a left-axis shorthand.
- Numeric X-axis scaling and interval-aware time ticks. Time values use
  ISO-8601 with explicit compact date formatting.
- Normalization and ordering: add percent/stacked-percent normalization and
  deterministic category ordering for composition and bar charts.
- Rich interactions: add optional legend toggling and a series-selection mode,
  with interaction state stored in the surface-local data model.
- Accessibility: require usable title, description, axis, and series labels;
  provide an expandable or visually-hidden tabular data fallback.

#### 2. Add composition charts

Implemented:

- [x] `pie` and `donut` variants for one numeric series over x-axis categories.

Remaining:

- Add optional centered donut summary content and semantic category ordering.
- Use for category share and composition with a small number of categories;
  favor a bar chart when labels or category count are large.

#### 3. Add relationship charts

Implemented:

- [x] `scatter` and `bubble` variants, using numeric `x.key`, one numeric
  `series[].key` Y field, and optional `size.key` bubble magnitude.

Remaining:

- Preserve point selection and include the selected record values in its bound
  payload.
- Use for correlation, distribution, clusters, and outlier analysis.

#### 4. Expand Stat

- Add `description` and `comparisonLabel`, such as "vs. prior month".
- Add explicit `trend` (`up`, `down`, `neutral`) independent of delta sign.
  This supports metrics where decreases are positive, including latency, cost,
  and error rate.
- Add an optional compact sparkline binding for recent context.
- Add semantic status/emphasis (`neutral`, `positive`, `negative`, `warning`).

#### 5. Add focused visualization leaves

- `Sparkline`: a small standalone line or bar trend for dense tables and KPI
  rows.
- `Progress`: current value, maximum, label, and optional target.
- `Gauge`: a bounded single-value status display with a small, explicit set of
  threshold bands.

These remain leaf components so all Basic Catalog resources continue to be
valid under the charts catalog.

### Delivery order

Progress: the first delivery item is partially implemented in `charts/v1` and Parley's
renderer. It adds per-series `type`, named `stack`, `lineStyle`, and
`connectNulls`; preserves the legacy chart-level `stacked` shorthand; and adds
series identity to bar point-selection values. It also adds safe, theme-token
reference lines and shaded reference bands for targets and thresholds. Line and
area chart clicks remain chart-level selections because Recharts does not expose
an individual series identity for curve click events.

1. Per-series cartesian controls, reference marks, missing-data semantics, and
   richer selection payloads.
2. Time axes, dual Y axes, and composed charts.
3. Pie/donut charts with category sorting.
4. Stat comparison context, direction semantics, and sparklines.
5. Scatter/bubble, then standalone Sparkline, Progress, Gauge, and the
   accessible data-table fallback.

Each capability should land in the catalog schema and Parley's trusted renderer
together, with schema/renderer tests and representative A2UI surface fixtures.

## Alternatives considered

- Rename the catalog to `v1beta`: rejected for now because Parley controls both
  producer and renderer, and changing the opaque ID introduces unnecessary
  migration work. Reconsider when third-party hosts or producers need a stable
  published contract.
- Create v2 before any work: rejected because the proposed capabilities are
  primarily additive and do not require breaking existing authored resources.
- Add all Recharts-supported chart types: rejected because each visualization
  needs a deliberate portable data model, accessibility behavior, selection
  semantics, and renderer test coverage.

## Risks

- A permissive v1 contract can become difficult to stabilize once external
  consumers adopt it. Establish release discipline before public promotion.
- Dual axes, normalization, and composed charts can mislead users if defaults
  are unclear. The schema descriptions and agent examples should favor
  interpretable configurations.
- Large datasets can cause rendering and interaction regressions. Renderer
  limits, data downsampling guidance, and an accessible table fallback need
  explicit validation.
- Pie, gauge, and stacked-percent visualizations are easy to misuse. Agent
  authoring guidance should state when a bar or line chart is preferable.
