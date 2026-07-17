import { describe, expect, it } from "vitest";
import type { A2uiSurface } from "~/lib/a2ui";
import { reconcileSurfaceLocalState } from "./surface";

const surface = (overrides: Partial<A2uiSurface> = {}): A2uiSurface => ({
  surfaceId: "shared",
  generation: "turn-a:create-1",
  catalogId: "catalog",
  theme: null,
  components: {},
  dataModel: {},
  dataOps: [],
  supported: true,
  ...overrides,
});

describe("reconcileSurfaceLocalState", () => {
  it("replaces local edits when a surface is recreated with equal op count", () => {
    const next = reconcileSurfaceLocalState(
      {
        dataModel: { stale: true },
        appliedOps: 0,
        appliedOpsKey: "[]",
        generation: "turn-a:create-1",
        stateKey: "conversation-a:shared",
      },
      surface({ dataModel: { fresh: true }, generation: "turn-b:create-1" }),
    );

    expect(next).toEqual({
      dataModel: { fresh: true },
      appliedOps: 0,
      appliedOpsKey: "[]",
      generation: "turn-b:create-1",
      stateKey: "conversation-a:shared",
    });
  });

  it("preserves local edits while applying later server operations", () => {
    const next = reconcileSurfaceLocalState(
      {
        dataModel: { local: true },
        appliedOps: 0,
        appliedOpsKey: "[]",
        generation: "turn-a:create-1",
        stateKey: "conversation-a:shared",
      },
      surface({
        dataOps: [{ path: "/server", value: true }],
        dataModel: { server: true },
      }),
    );

    expect(next?.dataModel).toEqual({ local: true, server: true });
  });

  it("replaces local state when the conversation scope changes", () => {
    const next = reconcileSurfaceLocalState(
      {
        dataModel: { fromA: true },
        appliedOps: 0,
        appliedOpsKey: "[]",
        generation: "turn-a:create-1",
        stateKey: "conversation-a:shared",
      },
      surface({ dataModel: { fromB: true } }),
      "conversation-b:shared",
    );

    expect(next?.dataModel).toEqual({ fromB: true });
    expect(next?.stateKey).toBe("conversation-b:shared");
  });

  it("reseeds when server operations are rewritten at the same length", () => {
    const next = reconcileSurfaceLocalState(
      {
        dataModel: { stale: true },
        appliedOps: 1,
        appliedOpsKey: '[{"path":"/value","value":"old"}]',
        generation: "turn-a:create-1",
        stateKey: "conversation-a:shared",
      },
      surface({
        dataModel: { value: "new" },
        dataOps: [{ path: "/value", value: "new" }],
      }),
    );

    expect(next?.dataModel).toEqual({ value: "new" });
  });
});
