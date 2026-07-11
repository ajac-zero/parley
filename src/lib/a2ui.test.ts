/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: A2UI's
 * formatString interpolation syntax uses literal `${...}` in plain strings. */

import { describe, expect, it } from "vitest";
import {
  A2UI_MIME_TYPE,
  applyA2uiDataOps,
  buildA2uiActionPart,
  callCatalogFunction,
  extractA2uiResources,
  failedChecks,
  interpolate,
  isA2uiMessageArray,
  messageA2uiActions,
  pointerDelete,
  pointerGet,
  pointerSet,
  reduceA2uiMessages,
  reduceA2uiOutputs,
  resolveDynamic,
  resolvePath,
  summarizeA2uiAction,
} from "~/lib/a2ui";
import type { ContentPart, MessageItem } from "~/lib/openresponses";

const BASIC_CATALOG =
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json";

/* ------------------------------ JSON Pointer ------------------------------ */

describe("JSON Pointer utilities", () => {
  const model = {
    user: { name: "Ada", tags: ["a", "b"] },
    "odd/key": { "til~de": 1 },
  };

  it("reads nested values, array indices, and escaped tokens", () => {
    expect(pointerGet(model, "/user/name")).toBe("Ada");
    expect(pointerGet(model, "/user/tags/1")).toBe("b");
    expect(pointerGet(model, "/odd~1key/til~0de")).toBe(1);
    expect(pointerGet(model, "")).toBe(model);
    expect(pointerGet(model, "/missing/deep")).toBeUndefined();
  });

  it("writes immutably, creating intermediate containers", () => {
    const next = pointerSet(model, "/user/address/city", "London") as never;
    expect(pointerGet(next, "/user/address/city")).toBe("London");
    expect(pointerGet(model, "/user/address")).toBeUndefined();
    expect(pointerGet(next, "/user/name")).toBe("Ada");

    const withArray = pointerSet({}, "/items/0/label", "first");
    expect(Array.isArray(pointerGet(withArray, "/items"))).toBe(true);
    expect(pointerGet(withArray, "/items/0/label")).toBe("first");
  });

  it("replaces the whole model for the root pointer", () => {
    expect(pointerSet(model, "/", { fresh: true })).toEqual({ fresh: true });
    expect(pointerSet(model, "", 42)).toBe(42);
  });

  it("deletes keys and unsets array indices preserving length", () => {
    const next = pointerDelete(model, "/user/name") as never;
    expect(pointerGet(next, "/user/name")).toBeUndefined();
    expect(pointerGet(next, "/user/tags/0")).toBe("a");

    const array = pointerDelete(model, "/user/tags/0") as never;
    const tags = pointerGet(array, "/user/tags") as unknown[];
    expect(tags.length).toBe(2);
    expect(tags[0]).toBeUndefined();
    expect(tags[1]).toBe("b");
  });

  it("resolves relative paths against a scope base", () => {
    expect(resolvePath("/abs", "/employees/2")).toBe("/abs");
    expect(resolvePath("name", "/employees/2")).toBe("/employees/2/name");
  });
});

/* ---------------------------- surface reduction --------------------------- */

const createSurface = (surfaceId = "s1") => ({
  version: "v0.9.1",
  createSurface: { surfaceId, catalogId: BASIC_CATALOG },
});

describe("reduceA2uiMessages", () => {
  it("builds a surface from create + updateComponents + updateDataModel", () => {
    const surfaces = reduceA2uiMessages([
      createSurface(),
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Column", children: ["hello"] },
            { id: "hello", component: "Text", text: { path: "/user/name" } },
          ],
        },
      },
      {
        version: "v0.9.1",
        updateDataModel: {
          surfaceId: "s1",
          path: "/user",
          value: { name: "Ada" },
        },
      },
    ]);

    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0];
    expect(surface?.supported).toBe(true);
    expect(surface?.components.root?.component).toBe("Column");
    expect(pointerGet(surface?.dataModel, "/user/name")).toBe("Ada");
  });

  it("re-sending a component id updates it in place", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      {
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Text", text: "one" }],
        },
      },
      {
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Text", text: "two" }],
        },
      },
    ]);
    expect(surface?.components.root?.text).toBe("two");
  });

  it("updateDataModel without value deletes at path", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      {
        updateDataModel: {
          surfaceId: "s1",
          path: "/",
          value: { keep: 1, drop: 2 },
        },
      },
      { updateDataModel: { surfaceId: "s1", path: "/drop" } },
    ]);
    expect(surface?.dataModel).toEqual({ keep: 1 });
  });

  it("marks unsupported catalogs and versions, keeps the surface", () => {
    const [unknownCatalog] = reduceA2uiMessages([
      {
        version: "v0.9.1",
        createSurface: { surfaceId: "s1", catalogId: "urn:custom:catalog" },
      },
    ]);
    expect(unknownCatalog?.supported).toBe(false);

    const [futureVersion] = reduceA2uiMessages([
      {
        version: "v42.0",
        createSurface: { surfaceId: "s2", catalogId: BASIC_CATALOG },
      },
    ]);
    expect(futureVersion?.supported).toBe(false);
  });

  it("deleteSurface removes the surface; stray updates are ignored", () => {
    const surfaces = reduceA2uiMessages([
      createSurface(),
      { deleteSurface: { surfaceId: "s1" } },
      {
        updateComponents: {
          surfaceId: "ghost",
          components: [{ id: "root", component: "Text", text: "x" }],
        },
      },
    ]);
    expect(surfaces).toHaveLength(0);
  });

  it("records data ops; replaying them reproduces the model", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      {
        updateDataModel: {
          surfaceId: "s1",
          path: "/user",
          value: { name: "Ada", tmp: 1 },
        },
      },
      { updateDataModel: { surfaceId: "s1", path: "/user/tmp" } },
    ]);
    expect(surface?.dataOps).toHaveLength(2);
    expect(surface?.dataModel).toEqual({ user: { name: "Ada" } });
    expect(applyA2uiDataOps({}, surface?.dataOps ?? [])).toEqual(
      surface?.dataModel,
    );
  });

  it("re-creating a surface resets its accumulated data ops", () => {
    const [surface] = reduceA2uiMessages([
      createSurface(),
      { updateDataModel: { surfaceId: "s1", path: "/a", value: 1 } },
      createSurface(),
    ]);
    expect(surface?.dataOps).toHaveLength(0);
    expect(surface?.dataModel).toEqual({});
  });
});

/* ------------------------- conversation-level state ------------------------ */

describe("reduceA2uiOutputs", () => {
  const asOutput = (msgs: unknown[]): ContentPart[] => [
    { type: "output_text", text: "fallback" },
    {
      type: "resource",
      resource: { mimeType: A2UI_MIME_TYPE, text: JSON.stringify(msgs) },
    } as never,
  ];

  const formMessages = [
    createSurface(),
    {
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "root", component: "Text", text: "form" }],
      },
    },
    {
      updateDataModel: { surfaceId: "s1", path: "/user", value: { name: "" } },
    },
  ];

  it("anchors surfaces at the creating call; later outputs update in place", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: asOutput(formMessages) },
      {
        callId: "call_2",
        output: asOutput([
          {
            updateDataModel: {
              surfaceId: "s1",
              path: "/user/name",
              value: "Ada",
            },
          },
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "done" }],
            },
          },
        ]),
      },
    ]);

    const creator = byCall.get("call_1");
    expect(creator?.surfaces).toHaveLength(1);
    const surface = creator?.surfaces[0];
    expect(surface?.components.root?.text).toBe("done");
    expect(pointerGet(surface?.dataModel, "/user/name")).toBe("Ada");
    expect(surface?.dataOps).toHaveLength(2);

    /* The updating call renders nothing of its own — its effect is
     * visible at the surface's anchor. */
    const updater = byCall.get("call_2");
    expect(updater?.surfaces).toHaveLength(0);
    expect(updater?.showFallback).toBe(false);
  });

  it("flags update-only outputs that reference no known surface", () => {
    const byCall = reduceA2uiOutputs([
      {
        callId: "call_1",
        output: asOutput([
          { updateDataModel: { surfaceId: "ghost", path: "/x", value: 1 } },
        ]),
      },
    ]);
    expect(byCall.get("call_1")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_1")?.showFallback).toBe(true);
    expect(byCall.get("call_1")?.fallbackText).toBe("fallback");
  });

  it("a later deleteSurface removes the surface with no fallback anywhere", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: asOutput(formMessages) },
      {
        callId: "call_2",
        output: asOutput([{ deleteSurface: { surfaceId: "s1" } }]),
      },
    ]);
    expect(byCall.get("call_1")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_1")?.showFallback).toBe(false);
    expect(byCall.get("call_2")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_2")?.showFallback).toBe(false);
  });

  it("re-creating a deleted surface moves its anchor to the later call", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: asOutput(formMessages) },
      {
        callId: "call_2",
        output: asOutput([
          { deleteSurface: { surfaceId: "s1" } },
          createSurface(),
          {
            updateComponents: {
              surfaceId: "s1",
              components: [{ id: "root", component: "Text", text: "fresh" }],
            },
          },
        ]),
      },
    ]);
    expect(byCall.get("call_1")?.surfaces).toHaveLength(0);
    expect(byCall.get("call_2")?.surfaces).toHaveLength(1);
    expect(byCall.get("call_2")?.surfaces[0]?.components.root?.text).toBe(
      "fresh",
    );
  });

  it("omits outputs with no A2UI content", () => {
    const byCall = reduceA2uiOutputs([
      { callId: "call_1", output: JSON.stringify({ city: "Tokyo" }) },
      { callId: "call_2", output: null },
    ]);
    expect(byCall.size).toBe(0);
  });
});

/* ------------------------- dynamic values & checks ------------------------ */

describe("resolveDynamic and catalog functions", () => {
  const model = { user: { name: "Ada", email: "ada@example.com" }, n: 3 };

  it("passes literals through and resolves bindings", () => {
    expect(resolveDynamic("plain", model, "")).toBe("plain");
    expect(resolveDynamic(7, model, "")).toBe(7);
    expect(resolveDynamic({ path: "/user/name" }, model, "")).toBe("Ada");
    expect(resolveDynamic({ path: "name" }, model, "/user")).toBe("Ada");
  });

  it("evaluates validation functions", () => {
    const call = (name: string, args: Record<string, unknown>) =>
      callCatalogFunction(name, args, model, "");
    expect(call("required", { value: { path: "/user/name" } })).toBe(true);
    expect(call("required", { value: { path: "/user/missing" } })).toBe(false);
    expect(call("required", { value: "  " })).toBe(false);
    expect(call("regex", { value: "abc123", pattern: "^[a-z]+\\d+$" })).toBe(
      true,
    );
    expect(call("length", { value: "abcd", min: 2, max: 3 })).toBe(false);
    expect(call("numeric", { value: { path: "/n" }, min: 1, max: 5 })).toBe(
      true,
    );
    expect(call("email", { value: { path: "/user/email" } })).toBe(true);
    expect(call("email", { value: "nope" })).toBe(false);
    expect(call("and", { values: [true, { path: "/user/name" }] })).toBe(true);
    expect(call("or", { values: [false, ""] })).toBe(false);
    expect(call("not", { value: false })).toBe(true);
    expect(call("no_such_function", {})).toBeUndefined();
  });

  it("formats strings with ${path} interpolation", () => {
    expect(interpolate("Hi ${/user/name}!", model, "")).toBe("Hi Ada!");
    expect(interpolate("Hi ${name}", model, "/user")).toBe("Hi Ada");
    expect(interpolate("literal \\${notapath}", model, "")).toBe(
      "literal ${notapath}",
    );
    expect(
      callCatalogFunction("formatString", { value: "${/n} items" }, model, ""),
    ).toBe("3 items");
  });

  it("evaluates checks in both normative and shorthand shapes", () => {
    const failing = failedChecks(
      [
        {
          condition: { call: "required", args: { value: { path: "/none" } } },
          message: "Value is required.",
        },
        { call: "required", args: { value: { path: "/user/name" } } },
      ],
      model,
      "",
    );
    expect(failing).toEqual(["Value is required."]);
  });
});

/* --------------------------------- actions -------------------------------- */

describe("action envelopes", () => {
  const action = {
    name: "submit",
    surfaceId: "s1",
    sourceComponentId: "btn",
    timestamp: "2026-07-10T00:00:00.000Z",
    context: { guests: 2 },
  };

  it("builds a typed part and summary, then reads them back", () => {
    const part = buildA2uiActionPart(action);
    expect(part.type).toBe("a2ui");
    expect(part.mime_type).toBe(A2UI_MIME_TYPE);

    const item: MessageItem = {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: summarizeA2uiAction(action) },
        part as never,
      ],
    };
    const actions = messageA2uiActions(item);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.name).toBe("submit");
    expect(actions[0]?.context).toEqual({ guests: 2 });
    expect(summarizeA2uiAction(action)).toBe('UI action: submit {"guests":2}');
  });

  it("ignores messages without a2ui parts", () => {
    const item: MessageItem = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    };
    expect(messageA2uiActions(item)).toHaveLength(0);
  });
});

/* ---------------------------- resource detection --------------------------- */

describe("extractA2uiResources", () => {
  const messages = [
    createSurface(),
    {
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "root", component: "Text", text: "hi" }],
      },
    },
  ];
  const embeddedResource = {
    type: "resource",
    resource: {
      uri: "a2ui://demo/card",
      mimeType: A2UI_MIME_TYPE,
      text: JSON.stringify(messages),
    },
  };

  it("finds MCP embedded resources in content part arrays", () => {
    const extraction = extractA2uiResources([
      { type: "output_text", text: "Textual fallback." },
      embeddedResource as never,
    ]);
    expect(extraction.resources).toHaveLength(1);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/card");
    expect(extraction.resources[0]?.messages).toHaveLength(2);
    expect(extraction.fallbackText).toBe("Textual fallback.");
  });

  it("finds resources in a JSON string of an MCP CallToolResult", () => {
    const output = JSON.stringify({
      content: [{ type: "text", text: "fallback" }, embeddedResource],
    });
    const extraction = extractA2uiResources(output);
    expect(extraction.resources).toHaveLength(1);
    expect(extraction.fallbackText).toBe("fallback");
  });

  it("accepts a bare A2UI message array (string or value)", () => {
    expect(
      extractA2uiResources(JSON.stringify(messages)).resources,
    ).toHaveLength(1);
    expect(isA2uiMessageArray(messages)).toBe(true);
  });

  it("does not sniff untyped or unrelated payloads", () => {
    expect(extractA2uiResources("not json").resources).toHaveLength(0);
    expect(
      extractA2uiResources(JSON.stringify({ city: "Tokyo" })).resources,
    ).toHaveLength(0);
    expect(
      extractA2uiResources(JSON.stringify([{ foo: 1 }])).resources,
    ).toHaveLength(0);
    expect(
      extractA2uiResources([{ type: "output_text", text: "just text" }])
        .resources,
    ).toHaveLength(0);
    expect(extractA2uiResources(null).resources).toHaveLength(0);
  });

  it("ignores resources with the right mime type but invalid payloads", () => {
    const extraction = extractA2uiResources([
      {
        type: "resource",
        resource: { mimeType: A2UI_MIME_TYPE, text: "{broken" },
      } as never,
    ]);
    expect(extraction.resources).toHaveLength(0);
  });
});
