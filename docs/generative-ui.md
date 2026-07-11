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

Parley advertises only the A2UI protocol versions and catalog IDs that it
fully supports (see `A2UI_SUPPORTED_VERSIONS` and
`A2UI_SUPPORTED_CATALOG_IDS` in `src/lib/a2ui.ts`). Tool providers should
include a useful textual fallback for clients that cannot render the
resource.

How it works today:

- Detection: Parley scans `function_call_output` items for A2UI resources
  encoded per the A2UI-over-MCP convention — an MCP embedded resource
  (`{type: "resource", resource: {mimeType: "application/a2ui+json",
  text}}`) among the output content parts, or a JSON string of an MCP
  `CallToolResult`. A bare A2UI message array is also accepted. Nothing
  else is sniffed (`extractA2uiResources` in `src/lib/a2ui.ts`).
- Rendering: surfaces are reduced from the standard `createSurface` /
  `updateComponents` / `updateDataModel` / `deleteSurface` messages and
  rendered with native components (`src/components/a2ui/`). Data binding is
  local and two-way; unsupported catalogs or protocol versions degrade to
  the tool's text fallback without executing anything.
- Actions: a user action becomes a new user turn whose text is a readable
  summary, plus an `a2ui` content part carrying the standard A2UI
  client -> server messages verbatim (the Open Responses analog of A2A's
  DataPart binding). The agent owns routing the action back to the tool
  that produced the surface; the built-in demo agent shows the loop
  (ask it to "book a table").

### Level 2: Custom catalog plugins

Parley may later support installed catalog plugins for domains that need more
specialized native components, such as charts, diagrams, code review, or
infrastructure visualizations.

A plugin must provide both the catalog contract and trusted renderer
implementations. Catalogs are explicitly installed and negotiated; receiving
an unknown catalog must not cause Parley to download or execute arbitrary code.

The official Basic Catalog remains the preferred option whenever it is
sufficient. Custom catalogs trade some portability for richer native
integration.

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
