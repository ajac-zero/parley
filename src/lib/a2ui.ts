/**
 * Client-safe A2UI (a2ui.org) support — Level 1 of the generative UI
 * roadmap (docs/generative-ui.md).
 *
 * Tools return typed `application/a2ui+json` resources (per the
 * A2UI-over-MCP convention), agents preserve them in Open Responses
 * `function_call_output` items, and Parley renders the official Basic
 * Catalog with native components. This module owns the protocol model:
 *
 *  - detecting A2UI resources inside tool outputs,
 *  - reducing A2UI messages into surface state,
 *  - JSON Pointer data binding and catalog function evaluation,
 *  - building client -> server action envelopes.
 *
 * Rendering lives in ~/components/a2ui. Everything here is pure and shared
 * by the browser, the server, and tests.
 */

import type { ContentPart, MessageItem } from "~/lib/openresponses";

/* ------------------------------- constants ------------------------------- */

export const A2UI_MIME_TYPE = "application/a2ui+json";
/** Pre-v0.9.1 alias still emitted by some servers. */
const A2UI_LEGACY_MIME_TYPE = "application/json+a2ui";

/** Protocol versions Parley fully supports (and advertises). */
export const A2UI_SUPPORTED_VERSIONS: readonly string[] = ["v0.9", "v0.9.1"];

/**
 * The official A2UI Basic Catalog (both spec revisions Parley renders).
 * Catalog IDs are opaque identifiers agreed out-of-band, not fetched URLs.
 */
export const A2UI_BASIC_CATALOG_IDS: readonly string[] = [
  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
];

/**
 * Built-in renderer support for the ajac-zero charts catalog: the Basic
 * Catalog plus `Chart` and `Stat` leaf components. The independently owned
 * contract is never fetched at runtime.
 */
export const A2UI_CHARTS_CATALOG_ID =
  "https://github.com/ajac-zero/a2ui-catalogs/blob/main/catalogs/charts/v1/catalog.json";

/** Catalog IDs Parley fully supports (and advertises). */
export const A2UI_SUPPORTED_CATALOG_IDS: readonly string[] = [
  ...A2UI_BASIC_CATALOG_IDS,
  A2UI_CHARTS_CATALOG_ID,
];

/** Version Parley stamps on the client -> server messages it emits. */
export const A2UI_CLIENT_VERSION = "v0.9.1";

/* --------------------------------- types --------------------------------- */

/** One flat component from an `updateComponents` message. */
export interface A2uiComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

/** A server -> client A2UI envelope (exactly one message key is set). */
export interface A2uiMessage {
  version?: string;
  createSurface?: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
    sendDataModel?: boolean;
  };
  updateComponents?: {
    surfaceId: string;
    components: A2uiComponent[];
  };
  updateDataModel?: {
    surfaceId: string;
    path?: string;
    value?: unknown;
  };
  deleteSurface?: { surfaceId: string };
  [key: string]: unknown;
}

/** One server-issued data model write (`remove` unsets the path). */
export interface A2uiDataOp {
  path: string;
  value?: unknown;
  remove?: boolean;
}

/** Accumulated state of one surface after reducing a message list. */
export interface A2uiSurface {
  surfaceId: string;
  catalogId: string;
  theme: Record<string, unknown> | null;
  /** Flat component map (adjacency list); the tree hangs off id "root". */
  components: Record<string, A2uiComponent>;
  dataModel: unknown;
  /**
   * Ordered server data-model operations since the surface was (re)created;
   * `dataModel` equals replaying them onto `{}`. Renderers track how many
   * they have applied so later ops merge into local edits instead of
   * clobbering them.
   */
  dataOps: A2uiDataOp[];
  /** False when the catalog or protocol version is not supported. */
  supported: boolean;
}

/** Replays server data operations onto a model (see `A2uiSurface.dataOps`). */
export function applyA2uiDataOps(model: unknown, ops: A2uiDataOp[]): unknown {
  let next = model;
  for (const op of ops) {
    next = op.remove
      ? pointerDelete(next, op.path)
      : pointerSet(next, op.path, op.value);
  }
  return next;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/* ------------------------------ JSON Pointer ------------------------------ */

/** RFC 6901 pointer -> path segments ("" and "/" address the whole model). */
export function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  const body = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return body
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

const escapeToken = (token: string): string =>
  token.replaceAll("~", "~0").replaceAll("/", "~1");

/** Reads the value at a JSON Pointer; undefined when the path is absent. */
export function pointerGet(model: unknown, pointer: string): unknown {
  let current: unknown = model;
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(token, 10);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      const record = asRecord(current);
      if (!record) return undefined;
      current = record[token];
    }
  }
  return current;
}

/**
 * Immutably writes `value` at a JSON Pointer, creating intermediate
 * objects/arrays (numeric tokens create arrays) along the way.
 */
export function pointerSet(
  model: unknown,
  pointer: string,
  value: unknown,
): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value;

  const setAt = (current: unknown, depth: number): unknown => {
    const token = tokens[depth] as string;
    const isLast = depth === tokens.length - 1;
    const nextToken = tokens[depth + 1];
    const makeChild = () =>
      nextToken !== undefined && /^\d+$/.test(nextToken) ? [] : {};

    if (Array.isArray(current)) {
      const index = Number.parseInt(token, 10);
      if (!Number.isInteger(index) || index < 0) return current;
      const copy = current.slice();
      copy[index] = isLast
        ? value
        : setAt(copy[index] ?? makeChild(), depth + 1);
      return copy;
    }

    const record = asRecord(current) ?? {};
    if (/^\d+$/.test(token) && asRecord(current) === null) {
      const array: unknown[] = [];
      array[Number.parseInt(token, 10)] = isLast
        ? value
        : setAt(makeChild(), depth + 1);
      return array;
    }
    return {
      ...record,
      [token]: isLast ? value : setAt(record[token] ?? makeChild(), depth + 1),
    };
  };

  return setAt(model, 0);
}

/** Immutably removes the key addressed by a JSON Pointer. */
export function pointerDelete(model: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return undefined;
  const parentPointer = `/${tokens.slice(0, -1).map(escapeToken).join("/")}`;
  const leaf = tokens[tokens.length - 1] as string;
  const parent = tokens.length === 1 ? model : pointerGet(model, parentPointer);

  let nextParent: unknown = parent;
  if (Array.isArray(parent)) {
    const index = Number.parseInt(leaf, 10);
    if (Number.isInteger(index) && index >= 0 && index < parent.length) {
      // Per spec: array deletions unset the index but preserve length.
      const copy = parent.slice();
      copy[index] = undefined;
      nextParent = copy;
    }
  } else {
    const record = asRecord(parent);
    if (!record || !(leaf in record)) return model;
    const { [leaf]: _removed, ...rest } = record;
    nextParent = rest;
  }

  return tokens.length === 1
    ? nextParent
    : pointerSet(model, parentPointer, nextParent);
}

/** Resolves a (possibly relative) binding path against a scope base. */
export function resolvePath(path: string, base: string): string {
  if (path.startsWith("/")) return path;
  if (path.length === 0) return base;
  return `${base}/${path}`;
}

/* ---------------------------- surface reduction --------------------------- */

const messageVersionSupported = (message: A2uiMessage): boolean =>
  message.version === undefined ||
  A2UI_SUPPORTED_VERSIONS.includes(message.version);

/**
 * Reduces an ordered A2UI message list into surface states. Lenient by
 * design: malformed messages are skipped (log-and-continue per spec), and
 * surfaces with unsupported catalogs/versions are kept but marked
 * unsupported so the renderer can degrade to the text fallback.
 */
export function reduceA2uiMessages(messages: A2uiMessage[]): A2uiSurface[] {
  const surfaces = new Map<string, A2uiSurface>();

  for (const raw of messages) {
    const message = asRecord(raw) as A2uiMessage | null;
    if (!message) continue;
    const versionOk = messageVersionSupported(message);

    const create = asRecord(message.createSurface);
    if (create && typeof create.surfaceId === "string") {
      const catalogId =
        typeof create.catalogId === "string" ? create.catalogId : "";
      surfaces.set(create.surfaceId, {
        surfaceId: create.surfaceId,
        catalogId,
        theme: asRecord(create.theme),
        components: {},
        dataModel: {},
        dataOps: [],
        supported: versionOk && A2UI_SUPPORTED_CATALOG_IDS.includes(catalogId),
      });
      continue;
    }

    const update = asRecord(message.updateComponents);
    if (update && typeof update.surfaceId === "string") {
      const surface = surfaces.get(update.surfaceId);
      if (!surface || !Array.isArray(update.components)) continue;
      const components = { ...surface.components };
      for (const entry of update.components) {
        const component = asRecord(entry);
        if (
          component &&
          typeof component.id === "string" &&
          typeof component.component === "string"
        ) {
          components[component.id] = component as A2uiComponent;
        }
      }
      surfaces.set(update.surfaceId, { ...surface, components });
      continue;
    }

    const data = asRecord(message.updateDataModel);
    if (data && typeof data.surfaceId === "string") {
      const surface = surfaces.get(data.surfaceId);
      if (!surface) continue;
      const path = typeof data.path === "string" ? data.path : "/";
      const op: A2uiDataOp =
        "value" in data ? { path, value: data.value } : { path, remove: true };
      surfaces.set(data.surfaceId, {
        ...surface,
        dataModel: applyA2uiDataOps(surface.dataModel, [op]),
        dataOps: [...surface.dataOps, op],
      });
      continue;
    }

    const del = asRecord(message.deleteSurface);
    if (del && typeof del.surfaceId === "string") {
      surfaces.delete(del.surfaceId);
    }
  }

  return [...surfaces.values()];
}

/* ---------------------------- dynamic values ------------------------------ */

/**
 * Resolves a bindable value (literal | {path} | {call, args}) against the
 * data model. `base` is the collection scope for relative paths.
 */
export function resolveDynamic(
  value: unknown,
  model: unknown,
  base: string,
): unknown {
  const record = asRecord(value);
  if (!record) return value ?? undefined;
  if (typeof record.call === "string") {
    return callCatalogFunction(
      record.call,
      asRecord(record.args) ?? {},
      model,
      base,
    );
  }
  if (typeof record.path === "string") {
    return pointerGet(model, resolvePath(record.path, base));
  }
  return value;
}

/** A2UI's string conversion rules for interpolated/displayed values. */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export const resolveString = (
  value: unknown,
  model: unknown,
  base: string,
): string => toDisplayString(resolveDynamic(value, model, base));

const truthy = (value: unknown): boolean => Boolean(value);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * `${...}` interpolation used by formatString. Supports absolute and
 * relative data-model paths; `\${` escapes a literal `${`.
 */
export function interpolate(
  template: string,
  model: unknown,
  base: string,
): string {
  return template
    .replace(/\\\$\{/g, "\u0000")
    .replace(/\$\{([^}]*)\}/g, (_all, inner: string) =>
      toDisplayString(pointerGet(model, resolvePath(inner.trim(), base))),
    )
    .replaceAll("\u0000", "${");
}

/**
 * Evaluates a Basic Catalog function. Unknown functions resolve to
 * undefined — never executed content. `openUrl` is a renderer-side effect
 * and returns undefined here.
 */
export function callCatalogFunction(
  name: string,
  args: Record<string, unknown>,
  model: unknown,
  base: string,
): unknown {
  const arg = (key: string): unknown => resolveDynamic(args[key], model, base);

  switch (name) {
    case "required": {
      const value = arg("value");
      if (value === undefined || value === null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }
    case "regex": {
      const value = toDisplayString(arg("value"));
      const pattern = toDisplayString(arg("pattern"));
      try {
        return new RegExp(pattern).test(value);
      } catch {
        return false;
      }
    }
    case "length": {
      const value = arg("value");
      const length =
        typeof value === "string" || Array.isArray(value)
          ? value.length
          : toDisplayString(value).length;
      const min = toNumber(arg("min"));
      const max = toNumber(arg("max"));
      if (min !== null && length < min) return false;
      if (max !== null && length > max) return false;
      return true;
    }
    case "numeric": {
      const value = toNumber(arg("value"));
      if (value === null) return false;
      const min = toNumber(arg("min"));
      const max = toNumber(arg("max"));
      if (min !== null && value < min) return false;
      if (max !== null && value > max) return false;
      return true;
    }
    case "email": {
      const value = toDisplayString(arg("value"));
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    case "and": {
      const values = Array.isArray(args.values) ? args.values : [];
      return values.every((entry) =>
        truthy(resolveDynamic(entry, model, base)),
      );
    }
    case "or": {
      const values = Array.isArray(args.values) ? args.values : [];
      return values.some((entry) => truthy(resolveDynamic(entry, model, base)));
    }
    case "not":
      return !truthy(arg("value"));
    case "formatString": {
      const template =
        typeof args.value === "string"
          ? args.value
          : toDisplayString(arg("value"));
      return interpolate(template, model, base);
    }
    case "formatNumber": {
      const value = toNumber(arg("value"));
      if (value === null) return "";
      const decimals = toNumber(arg("decimals"));
      const grouping = arg("grouping");
      try {
        return new Intl.NumberFormat(undefined, {
          minimumFractionDigits: decimals ?? undefined,
          maximumFractionDigits: decimals ?? undefined,
          useGrouping: grouping === undefined ? true : truthy(grouping),
        }).format(value);
      } catch {
        return String(value);
      }
    }
    case "formatCurrency": {
      const value = toNumber(arg("value"));
      if (value === null) return "";
      const currency = toDisplayString(arg("currency")) || "USD";
      const decimals = toNumber(arg("decimals"));
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
          minimumFractionDigits: decimals ?? undefined,
          maximumFractionDigits: decimals ?? undefined,
        }).format(value);
      } catch {
        return `${currency} ${value}`;
      }
    }
    case "formatDate": {
      const value = arg("value");
      const date =
        typeof value === "number"
          ? new Date(value)
          : new Date(toDisplayString(value));
      if (Number.isNaN(date.getTime())) return "";
      const format = toDisplayString(arg("format"));
      return formatDatePattern(date, format);
    }
    case "pluralize": {
      const count = toNumber(arg("value")) ?? 0;
      let category = "other";
      try {
        category = new Intl.PluralRules().select(count);
      } catch {
        category = count === 1 ? "one" : "other";
      }
      const chosen = args[category] ?? args.other;
      return toDisplayString(resolveDynamic(chosen, model, base));
    }
    default:
      return undefined;
  }
}

/** Minimal TR35-style date pattern support (common tokens only). */
function formatDatePattern(date: Date, format: string): string {
  if (!format) return date.toLocaleString();
  const pad = (value: number, width: number) =>
    String(value).padStart(width, "0");
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    yy: pad(date.getFullYear() % 100, 2),
    MMMM: date.toLocaleString(undefined, { month: "long" }),
    MMM: date.toLocaleString(undefined, { month: "short" }),
    MM: pad(date.getMonth() + 1, 2),
    M: String(date.getMonth() + 1),
    dd: pad(date.getDate(), 2),
    d: String(date.getDate()),
    EEEE: date.toLocaleString(undefined, { weekday: "long" }),
    EEE: date.toLocaleString(undefined, { weekday: "short" }),
    HH: pad(date.getHours(), 2),
    H: String(date.getHours()),
    hh: pad(((date.getHours() + 11) % 12) + 1, 2),
    h: String(((date.getHours() + 11) % 12) + 1),
    mm: pad(date.getMinutes(), 2),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds(), 2),
    s: String(date.getSeconds()),
    a: date.getHours() < 12 ? "AM" : "PM",
  };
  return format.replace(
    /yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|m|ss|s|a/g,
    (token) => tokens[token] ?? token,
  );
}

/* --------------------------------- checks -------------------------------- */

/**
 * Evaluates a component's `checks` and returns the failure messages.
 * Accepts the normative `{condition, message}` shape plus the
 * `{call, args, message}` shorthand seen in spec examples.
 */
export function failedChecks(
  checks: unknown,
  model: unknown,
  base: string,
): string[] {
  if (!Array.isArray(checks)) return [];
  const failures: string[] = [];
  for (const entry of checks) {
    const rule = asRecord(entry);
    if (!rule) continue;
    const condition =
      rule.condition !== undefined
        ? rule.condition
        : typeof rule.call === "string"
          ? { call: rule.call, args: rule.args }
          : undefined;
    if (condition === undefined) continue;
    if (!truthy(resolveDynamic(condition, model, base))) {
      failures.push(
        typeof rule.message === "string" ? rule.message : "Invalid value.",
      );
    }
  }
  return failures;
}

/* --------------------------------- actions -------------------------------- */

/** A resolved user action, matching the A2UI client -> server `action`. */
export interface A2uiAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

/** Wraps an action in versioned client -> server envelope(s). */
export function buildA2uiClientMessages(
  action: A2uiAction,
): Array<Record<string, unknown>> {
  return [{ version: A2UI_CLIENT_VERSION, action }];
}

/**
 * Text fallback describing an action, sent alongside the typed part so
 * agents that only read text still see what happened.
 */
export function summarizeA2uiAction(action: A2uiAction): string {
  const context = JSON.stringify(action.context ?? {});
  return context === "{}"
    ? `UI action: ${action.name}`
    : `UI action: ${action.name} ${context}`;
}

/**
 * The Open Responses content part Parley uses to route an A2UI action back
 * through the agent — the analog of A2A's DataPart binding: the standard
 * client -> server messages, tagged with the A2UI media type.
 */
export interface A2uiActionPart {
  type: "a2ui";
  mime_type: typeof A2UI_MIME_TYPE;
  data: Array<Record<string, unknown>>;
}

export function buildA2uiActionPart(action: A2uiAction): A2uiActionPart {
  return {
    type: "a2ui",
    mime_type: A2UI_MIME_TYPE,
    data: buildA2uiClientMessages(action),
  };
}

/** Extracts A2UI actions carried in a user message's content parts. */
export function messageA2uiActions(item: MessageItem): A2uiAction[] {
  if (typeof item.content === "string") return [];
  const actions: A2uiAction[] = [];
  for (const part of item.content) {
    const record = asRecord(part);
    if (record?.type !== "a2ui" || !Array.isArray(record.data)) {
      continue;
    }
    for (const message of record.data) {
      const envelope = asRecord(message);
      const action = envelope ? asRecord(envelope.action) : null;
      if (action && typeof action.name === "string") {
        actions.push({
          name: action.name,
          surfaceId: toDisplayString(action.surfaceId),
          sourceComponentId: toDisplayString(action.sourceComponentId),
          timestamp: toDisplayString(action.timestamp),
          context: asRecord(action.context) ?? {},
        });
      }
    }
  }
  return actions;
}

/* ---------------------------- resource detection --------------------------- */

/** One A2UI resource found in a tool output. */
export interface A2uiResourcePayload {
  uri: string | null;
  messages: A2uiMessage[];
}

export interface A2uiExtraction {
  resources: A2uiResourcePayload[];
  /** Plain-text fallback found alongside the resources, if any. */
  fallbackText: string | null;
}

const isA2uiMimeType = (value: unknown): boolean =>
  value === A2UI_MIME_TYPE || value === A2UI_LEGACY_MIME_TYPE;

const MESSAGE_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

/** True for a non-empty array where every entry looks like an envelope. */
export function isA2uiMessageArray(value: unknown): value is A2uiMessage[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    const record = asRecord(entry);
    return record !== null && MESSAGE_KEYS.some((key) => key in record);
  });
}

const parseMessages = (value: unknown): A2uiMessage[] | null => {
  if (isA2uiMessageArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isA2uiMessageArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

/** Reads an MCP-style content entry / OR content part for A2UI payloads. */
function resourceFromPart(part: unknown): A2uiResourcePayload | null {
  const record = asRecord(part);
  if (!record) return null;

  // MCP EmbeddedResource: { type: "resource", resource: { mimeType, text } }
  const resource = asRecord(record.resource);
  if (resource && isA2uiMimeType(resource.mimeType ?? resource.mime_type)) {
    const messages =
      parseMessages(resource.text) ??
      parseMessages(resource.data) ??
      parseMessages(resource.json);
    if (messages) {
      return {
        uri: typeof resource.uri === "string" ? resource.uri : null,
        messages,
      };
    }
    return null;
  }

  // Inline part tagged with the media type: { mime_type, text | data }
  if (isA2uiMimeType(record.mime_type ?? record.mimeType)) {
    const messages =
      parseMessages(record.text) ??
      parseMessages(record.data) ??
      parseMessages(record.a2ui);
    if (messages) {
      return {
        uri: typeof record.uri === "string" ? record.uri : null,
        messages,
      };
    }
  }

  return null;
}

const textFromPart = (part: unknown): string | null => {
  const record = asRecord(part);
  if (!record) return null;
  if (
    (record.type === "text" || record.type === "output_text") &&
    typeof record.text === "string"
  ) {
    return record.text;
  }
  return null;
};

function extractFromParts(parts: unknown[]): A2uiExtraction {
  const resources: A2uiResourcePayload[] = [];
  const texts: string[] = [];
  for (const part of parts) {
    const resource = resourceFromPart(part);
    if (resource) {
      resources.push(resource);
      continue;
    }
    const text = textFromPart(part);
    if (text) texts.push(text);
  }
  return {
    resources,
    fallbackText: texts.length > 0 ? texts.join("\n\n") : null,
  };
}

const EMPTY_EXTRACTION: A2uiExtraction = { resources: [], fallbackText: null };

/**
 * Finds A2UI resources inside a `function_call_output`'s output. Supported
 * encodings, most to least typed:
 *
 *  1. content parts embedding an MCP resource
 *     (`{type: "resource", resource: {mimeType: "application/a2ui+json", text}}`),
 *  2. a JSON string of an MCP CallToolResult (`{content: [...]}`) whose
 *     content embeds such a resource,
 *  3. a JSON string or value that is directly an A2UI message array.
 *
 * Anything else yields no resources — Parley never sniffs untyped content
 * beyond the unambiguous A2UI envelope signature.
 */
export function extractA2uiResources(
  output: string | ContentPart[] | null | undefined,
): A2uiExtraction {
  if (!output) return EMPTY_EXTRACTION;

  if (Array.isArray(output)) return extractFromParts(output);

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return EMPTY_EXTRACTION;
  }

  if (isA2uiMessageArray(parsed)) {
    return {
      resources: [{ uri: null, messages: parsed }],
      fallbackText: null,
    };
  }

  const record = asRecord(parsed);
  if (record && Array.isArray(record.content)) {
    return extractFromParts(record.content);
  }
  const single = resourceFromPart(parsed);
  if (single) return { resources: [single], fallbackText: null };

  return EMPTY_EXTRACTION;
}

/* ------------------------- conversation-level state ------------------------ */

/** One tool output in conversation order, keyed by its `call_id`. */
export interface A2uiOutputRef {
  callId: string;
  output: string | ContentPart[] | null | undefined;
}

/** The A2UI state a host should render at one tool call. */
export interface A2uiCallSurfaces {
  /** Surfaces whose latest `createSurface` arrived in this output. */
  surfaces: A2uiSurface[];
  /** Text fallback found alongside this output's resources, if any. */
  fallbackText: string | null;
  /**
   * True when this output carried A2UI resources that applied to nothing —
   * no surface created here and no reference to any surface created
   * elsewhere — so the host should show the unsupported/fallback treatment.
   */
  showFallback: boolean;
}

/**
 * Reduces A2UI resources across a whole conversation's tool outputs.
 *
 * Surfaces are shared state: a later output may `updateComponents` /
 * `updateDataModel` / `deleteSurface` a surface created by an earlier tool
 * call (that is how an agent morphs a form into its result in place). Each
 * surviving surface is anchored to — and should be rendered at — the output
 * containing its latest `createSurface`; outputs that merely update an
 * existing surface render nothing themselves.
 */
export function reduceA2uiOutputs(
  outputs: A2uiOutputRef[],
): Map<string, A2uiCallSurfaces> {
  interface CallScan {
    callId: string;
    hasResources: boolean;
    fallbackText: string | null;
    referencedIds: Set<string>;
  }

  const scans: CallScan[] = [];
  const allMessages: A2uiMessage[] = [];
  /** surfaceId -> callId of the latest createSurface (the render anchor). */
  const anchors = new Map<string, string>();
  /** Every surfaceId a createSurface was seen for, live or not. */
  const createdIds = new Set<string>();

  for (const { callId, output } of outputs) {
    const extraction = extractA2uiResources(output);
    const referencedIds = new Set<string>();
    for (const resource of extraction.resources) {
      for (const message of resource.messages) {
        allMessages.push(message);
        const record = asRecord(message);
        if (!record) continue;
        for (const key of MESSAGE_KEYS) {
          const body = asRecord(record[key]);
          if (body && typeof body.surfaceId === "string") {
            referencedIds.add(body.surfaceId);
            if (key === "createSurface") {
              anchors.set(body.surfaceId, callId);
              createdIds.add(body.surfaceId);
            }
          }
        }
      }
    }
    scans.push({
      callId,
      hasResources: extraction.resources.length > 0,
      fallbackText: extraction.fallbackText,
      referencedIds,
    });
  }

  const reduced = reduceA2uiMessages(allMessages);
  const result = new Map<string, A2uiCallSurfaces>();
  for (const scan of scans) {
    const surfaces = reduced.filter(
      (surface) => anchors.get(surface.surfaceId) === scan.callId,
    );
    if (!scan.hasResources && surfaces.length === 0) continue;
    const touchesKnownSurface = [...scan.referencedIds].some((id) =>
      createdIds.has(id),
    );
    result.set(scan.callId, {
      surfaces,
      fallbackText: scan.fallbackText,
      showFallback:
        scan.hasResources && surfaces.length === 0 && !touchesKnownSurface,
    });
  }
  return result;
}
