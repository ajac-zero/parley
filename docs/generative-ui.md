# Generative UI roadmap

Parley aims to support richer agent workflows without taking ownership of an
agent's tools. Open Responses remains the conversation protocol, while agents
continue to select, execute, and authorize their tools internally.

The UI strategy is standards-first and progressive. Parley should consume
typed, user-visible resources produced by tools rather than introduce a
Parley-specific UI protocol.

## Architecture

The preferred flow follows the A2UI-over-MCP resource model:

```text
MCP server
  returns a typed UI resource in a tool result
        |
        v
Agent
  executes the tool and preserves its typed result
        |
        v
Open Responses
  carries the tool result to Parley
        |
        v
Parley
  dispatches the resource to a compatible renderer
```

In this model, UI resources are normally constructed deterministically by the
tool or MCP server, just like the rest of the tool result. They do not require
the model to emit JSON inside a text response. Agents may still generate UI
dynamically when their runtime provides schema-constrained generation and
validation, but that is an agent implementation concern rather than a Parley
requirement.

Parley remains responsible for safe rendering, user interaction, and host
policy. The agent remains responsible for tool execution and for routing UI
actions back to the service that owns the workflow.

## Progressive support

### Level 1: Official A2UI Basic Catalog (implemented)

Parley supports the official A2UI Basic Catalog and renders
`application/a2ui+json` resources using native Parley components.

This is the portable baseline. Tool providers can describe layouts, forms,
lists, media, and actions using a shared catalog without depending on
Parley-specific components. Different hosts may render the same resource in
their own visual language while preserving its structure and behavior.

Parley advertises only the A2UI protocol versions it fully supports
(`A2UI_SUPPORTED_VERSIONS` in `src/lib/a2ui.ts`) and renders only catalog
IDs that are both installed in the build (`A2UI_INSTALLED_CATALOG_IDS`) and
enabled by a deployment administrator. Tool providers should include a
useful textual fallback for clients that cannot render the resource.

How it works today:

- Detection: Parley scans `function_call_output` items for A2UI resources
  encoded per the A2UI-over-MCP convention — an MCP embedded resource
  (`{type: "resource", resource: {mimeType: "application/a2ui+json",
  text}}`) among the output content parts, or a JSON string of an MCP
  `CallToolResult`. A bare A2UI message array is also accepted. Nothing
  else is sniffed (`extractA2uiResources` in `src/lib/a2ui.ts`).
- Presentation sidecars: providers may alternatively emit an
  [`ajac-zero:a2ui`](https://github.com/ajac-zero/openresponses-extensions)
  output item linked to the canonical `function_call` / `function_call_output`
  pair by `call_id`. The sidecar is optional presentation metadata: Parley
  keeps the canonical tool result unchanged, excludes the sidecar from
  provider replay, and reduces its A2UI messages at the linked call. If both
  forms describe the same surface, the explicit presentation sidecar takes
  precedence.
- Rendering: surfaces are reduced from the standard `createSurface` /
  `updateComponents` / `updateDataModel` / `deleteSurface` messages and
  rendered with native components (`src/components/a2ui/`). Data binding is
  local and two-way; unsupported catalogs or protocol versions degrade to
  the tool's text fallback without executing anything.
- Surface lifecycle: surfaces are conversation-wide state
  (`reduceA2uiOutputs` in `src/lib/a2ui.ts`). Every tool output is reduced
  in order, so a later tool result can update or delete a surface created
  by an earlier call — this is how an agent reflects an action's outcome by
  morphing the original UI in place rather than rendering a new surface.
  Each surface renders anchored at the call whose `createSurface` produced
  it; server data-model updates that arrive after the user has started
  editing merge into the local model instead of clobbering it.
- Placement: where a surface renders is host policy, not protocol — A2UI
  carries no placement hints and tools cannot request one. By default
  surfaces render inline at their anchor; the user may pin a surface to a
  side canvas to keep interacting with it while the conversation continues
  (agent-driven updates keep landing on it there). Pinning is a client-side
  preference, moves are lossless for local edits, and on viewports too
  narrow for the canvas pins lie dormant and surfaces render inline.
- Actions: a user action becomes a new user turn whose text is a readable
  summary, plus an `a2ui` content part carrying the standard A2UI
  client -> server messages verbatim (the Open Responses analog of A2A's
  DataPart binding). The agent owns routing the action back to the tool
  that produced the surface; the standalone demo agent shows the loop
  (ask it to "book a table" — submitting the form updates it in place
  into a confirmation).
- Message emptiness: a user message needs non-blank text, an attachment, or
  an `a2ui` payload — never all three empty. This applies identically to the
  first turn of a conversation and to every later turn, so an A2UI-only
  message (built-in surface actions with no readable text, or a direct API
  client submitting one) is valid in both places. Starting a conversation
  with an A2UI-only message uses the `New chat` fallback title.

### Built-in charts catalog (implemented)

Custom catalogs are the A2UI-sanctioned path for domains that need more
specialized native components than the Basic Catalog provides. A custom
catalog is a contract (a standalone JSON Schema) plus trusted renderer
implementations on the host; receiving an unknown catalog must not cause
Parley to download or execute anything.

Parley ships a renderer for the independently owned
[ajac-zero Charts v1 catalog](https://github.com/ajac-zero/a2ui-catalogs/blob/main/catalogs/charts/v1/catalog.json),
which composes the official Basic Catalog v0.9.1 with two leaf components —
`Chart` (line/bar/area series
over data-model rows, with optional point/range selection written back
through two-way binding) and `Stat` (a labeled headline number with an
optional delta). Because both extensions are leaves, every Basic Catalog
resource remains valid under the charts catalog unchanged; adding a new
container component would be a breaking change and would require a new
versioned catalog ID.

How it works today:

- Contract: the external schema's `$id` is the catalog ID
  (`A2UI_CHARTS_CATALOG_ID` in `src/lib/a2ui.ts`). Catalog IDs are opaque,
  versioned identifiers agreed out-of-band — never fetched at runtime; the
  independently published file documents the contract for tool authors.
- Rendering: a registry in `src/components/a2ui/catalog.tsx` maps each
  supported `catalogId` to its component views. The charts views
  (`src/components/a2ui/charts.tsx`) lazy-load so the charting library
  stays out of the main bundle until a chart actually renders. Series
  colors are restricted to the host theme's chart tokens and series keys
  are validated, so resources cannot inject styles or colors. An unknown
  component type within a supported catalog renders a labeled, inert
  placeholder (per spec); unknown catalogs still degrade to the tool's
  text fallback.
- Negotiation: A2A advertises supported catalogs via
  `metadata.a2uiClientCapabilities.supportedCatalogIds`; Open Responses has
  no equivalent yet, so catalog support is agreed out-of-band (this repo's
  supported IDs are the contract). The standalone demo agent shows both
  selection loops: ask for a "revenue chart" and click a bar (point
  selection), or a "traffic trend" and drag across the chart (range
  selection) — either way the analysis lands on the same surface in place.

The charts catalog is built in and enabled by default, but participates in the
same Level 2 registration and enablement system described below. The official
Basic Catalog stays the preferred option whenever it is sufficient; custom
catalogs trade some portability for richer native integration.

### Level 2: Custom catalog plugins (implemented)

Parley supports installed catalog plugins for domains that need more specialized
native components, such as charts, diagrams, code review, or infrastructure
visualizations.

A plugin must provide both the catalog contract and trusted renderer
implementations. Catalogs are explicitly installed and negotiated; receiving
an unknown catalog must not cause Parley to download or execute arbitrary code.

Built-in catalogs, including the official Basic Catalog and Parley's charts
catalog, use the same registration system as externally installed catalogs.
They are enabled by default, and deployment administrators can disable them or
enable other installed catalog plugins.

Installation and enablement are separate trust boundaries. Plugins are trusted
code installed at build time through the static manifest and renderer registries;
catalog IDs never cause Parley to fetch or execute code. Runtime settings store
only the enabled plugin keys. The effective catalog IDs are the intersection of
those settings and the plugins installed in the current build, and are supplied
to both server-side and browser rendering through the root app configuration.

The initial installed plugins are `basic` and `charts`. Self-hosters can add a
trusted plugin module to the build-time registries, rebuild Parley, and then let
an administrator enable it from the Catalogs tab. A future packaging API can
make that installation seam more convenient without changing the runtime trust
model.

### Level 3: MCP Apps

When a workflow cannot reasonably be expressed through a shared declarative
catalog, Parley may host standards-compliant MCP Apps in a sandboxed
environment.

MCP Apps provide the escape hatch for arbitrary, highly specialized
interfaces. They remain isolated from Parley's authenticated application and
interact with their owning MCP server through the standard host bridge and
explicitly granted capabilities.

This level favors application portability and expressiveness over native
component rendering. It must not turn Parley into the owner of agent tool
selection or domain authorization.

## Selection order

Tool and agent authors should choose the least privileged interoperable level
that satisfies the workflow:

1. Use the official A2UI Basic Catalog when possible.
2. Use a mutually supported custom catalog when specialized native components
   are needed.
3. Use an MCP App when the workflow requires an arbitrary application.

Parley should degrade gracefully when it cannot render a resource: show its
text fallback when available, preserve the tool result, and avoid executing
unknown content.

## Protocol boundaries

This roadmap deliberately avoids defining a new Parley wire protocol. Before
each level is implemented, its integration should be checked against the
current Open Responses, MCP, A2UI, and MCP Apps specifications and SDKs.

One interoperability boundary requires particular attention: an agent that
executes tools internally must preserve typed MCP resources when exposing tool
results through Open Responses. Likewise, actions from a rendered resource
must be routed back through the agent to the originating tool service without
moving tool ownership into Parley. Where the standards do not yet define this
bridge, Parley should prefer contributing a narrow upstream convention over
creating a broader proprietary protocol.

Detailed transport, persistence, rendering, sandboxing, and action-routing
decisions are intentionally deferred until work begins on each level.
