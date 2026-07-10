import { describe, expect, it } from "vitest";
import {
  type AgentCard,
  OPEN_RESPONSES_PROTOCOL_BINDING,
  openResponsesInterfaceOf,
  prefillFromAgentCard,
  wellKnownAgentCardUrl,
} from "~/lib/agent-card";

describe("wellKnownAgentCardUrl", () => {
  it("appends the well-known path to a bare domain", () => {
    expect(wellKnownAgentCardUrl("example.com")).toBe(
      "https://example.com/.well-known/agent-card.json",
    );
  });

  it("resolves from the origin, dropping any path", () => {
    expect(
      wellKnownAgentCardUrl("https://agent.example.com/v1/responses"),
    ).toBe("https://agent.example.com/.well-known/agent-card.json");
  });

  it("is idempotent for the well-known URL itself", () => {
    const url = "https://agent.example.com/.well-known/agent-card.json";
    expect(wellKnownAgentCardUrl(url)).toBe(url);
  });

  it("preserves explicit http and ports", () => {
    expect(wellKnownAgentCardUrl("http://localhost:8080/foo")).toBe(
      "http://localhost:8080/.well-known/agent-card.json",
    );
  });

  it("throws on garbage input", () => {
    expect(() => wellKnownAgentCardUrl("not a url")).toThrow();
  });
});

const card = (overrides: Partial<AgentCard>): AgentCard => ({
  name: "Test Agent",
  supportedInterfaces: [],
  ...overrides,
});

describe("openResponsesInterfaceOf", () => {
  it("returns the first interface with the exact Open Responses binding", () => {
    const found = openResponsesInterfaceOf(
      card({
        supportedInterfaces: [
          { url: "https://a.example.com/a2a", protocolBinding: "JSONRPC" },
          {
            url: "https://a.example.com/v1",
            protocolBinding: OPEN_RESPONSES_PROTOCOL_BINDING,
          },
          {
            url: "https://a.example.com/v2",
            protocolBinding: OPEN_RESPONSES_PROTOCOL_BINDING,
          },
        ],
      }),
    );
    expect(found?.url).toBe("https://a.example.com/v1");
  });

  it("is strict: near-miss identifiers do not match", () => {
    const found = openResponsesInterfaceOf(
      card({
        supportedInterfaces: [
          { url: "https://a.example.com/v1", protocolBinding: "OPENRESPONSES" },
          {
            url: "https://a.example.com/v1",
            protocolBinding: `${OPEN_RESPONSES_PROTOCOL_BINDING}/`,
          },
        ],
      }),
    );
    expect(found).toBeNull();
  });
});

describe("prefillFromAgentCard", () => {
  it("maps card fields onto agent form fields", () => {
    const prefill = prefillFromAgentCard(
      card({
        name: "Recipe Agent",
        description: "Cooks things up.",
        defaultInputModes: ["text/plain", "image/png", "application/pdf"],
        supportedInterfaces: [
          {
            url: "https://recipes.example.com/v1",
            protocolBinding: OPEN_RESPONSES_PROTOCOL_BINDING,
          },
        ],
      }),
    );
    expect(prefill).toEqual({
      name: "Recipe Agent",
      description: "Cooks things up.",
      baseUrl: "https://recipes.example.com/v1",
      supportsImages: true,
      supportsFiles: true,
    });
  });

  it("leaves baseUrl null and capabilities off without matching data", () => {
    const prefill = prefillFromAgentCard(
      card({
        defaultInputModes: ["text/plain", "application/json"],
        supportedInterfaces: [
          { url: "https://a.example.com/a2a", protocolBinding: "HTTP+JSON" },
        ],
      }),
    );
    expect(prefill.baseUrl).toBeNull();
    expect(prefill.supportsImages).toBe(false);
    expect(prefill.supportsFiles).toBe(false);
  });

  it("clamps name and description to schema limits", () => {
    const prefill = prefillFromAgentCard(
      card({ name: "x".repeat(200), description: "y".repeat(1000) }),
    );
    expect(prefill.name).toHaveLength(80);
    expect(prefill.description).toHaveLength(500);
  });
});
