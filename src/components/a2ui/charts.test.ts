import { describe, expect, it } from "vitest";
import {
  formatChartValue,
  parseReferenceBands,
  parseReferenceLines,
  parseSeries,
  parseYAxis,
} from "~/components/a2ui/charts";

/* -------------------------------- parseSeries ------------------------------ */

describe("parseSeries", () => {
  it("reads safe composed-series display options", () => {
    expect(
      parseSeries([
        {
          key: "actual",
          label: "Actual revenue",
          color: "chart-2",
          type: "bar",
          stack: "revenue",
          lineStyle: "dashed",
          connectNulls: true,
        },
      ]),
    ).toEqual([
      {
        key: "actual",
        label: "Actual revenue",
        color: "chart-2",
        type: "bar",
        stack: "revenue",
        lineStyle: "dashed",
        connectNulls: true,
        axis: "left",
      },
    ]);
  });

  it("defaults and rejects malformed, duplicate, or unsafe options", () => {
    expect(
      parseSeries([
        {
          key: "forecast",
          type: "invalid",
          stack: "not safe!",
          lineStyle: "wiggle",
        },
        { key: "forecast" },
        { key: "bad key" },
      ]),
    ).toEqual([
      {
        key: "forecast",
        label: "forecast",
        color: "chart-1",
        type: null,
        stack: null,
        lineStyle: "solid",
        connectNulls: false,
        axis: "left",
      },
    ]);
  });
});

/* ----------------------------- reference marks ---------------------------- */

describe("reference marks", () => {
  it("reads finite reference lines with safe color tokens", () => {
    expect(
      parseReferenceLines([
        { value: 250_000, label: "Plan", color: "chart-2" },
        { value: 0, color: "not-a-token" },
        { value: "nope" },
      ]),
    ).toEqual([
      { value: 250_000, label: "Plan", color: "chart-2" },
      { value: 0, label: "", color: "chart-3" },
    ]);
  });

  it("normalizes bands and drops zero-width or malformed ranges", () => {
    expect(
      parseReferenceBands([
        { from: 260_000, to: 230_000, label: "Target zone", color: "chart-1" },
        { from: 1, to: 1 },
        { from: 1, to: "nope" },
      ]),
    ).toEqual([
      { from: 230_000, to: 260_000, label: "Target zone", color: "chart-1" },
    ]);
  });
});

/* -------------------------------- parseYAxis ------------------------------- */

describe("parseYAxis", () => {
  it("returns null for a non-record value (malformed y)", () => {
    expect(parseYAxis(undefined)).toBeNull();
    expect(parseYAxis(null)).toBeNull();
    expect(parseYAxis("not an object")).toBeNull();
    expect(parseYAxis(["array", "not", "record"])).toBeNull();
  });

  it("defaults format to number, currency to USD, and digits to 2", () => {
    expect(parseYAxis({})).toEqual({
      label: "",
      format: "number",
      currency: "USD",
      maximumFractionDigits: 2,
      includeZero: false,
      min: null,
      max: null,
    });
  });

  it("accepts the currency and percent formats, rejecting anything else", () => {
    expect(parseYAxis({ format: "currency" })?.format).toBe("currency");
    expect(parseYAxis({ format: "percent" })?.format).toBe("percent");
    expect(parseYAxis({ format: "not-a-format" })?.format).toBe("number");
  });

  it("clamps maximumFractionDigits to the 0-6 range and floors fractions", () => {
    expect(
      parseYAxis({ maximumFractionDigits: -3 })?.maximumFractionDigits,
    ).toBe(0);
    expect(
      parseYAxis({ maximumFractionDigits: 42 })?.maximumFractionDigits,
    ).toBe(6);
    expect(
      parseYAxis({ maximumFractionDigits: 3.9 })?.maximumFractionDigits,
    ).toBe(3);
    expect(
      parseYAxis({ maximumFractionDigits: "nope" })?.maximumFractionDigits,
    ).toBe(2);
  });

  it("falls back to USD when currency is missing or not a string", () => {
    expect(parseYAxis({ currency: "" })?.currency).toBe("USD");
    expect(parseYAxis({ currency: 123 })?.currency).toBe("USD");
    expect(parseYAxis({ currency: "EUR" })?.currency).toBe("EUR");
  });

  it("reads includeZero and label only when the right shape", () => {
    expect(parseYAxis({ includeZero: true })?.includeZero).toBe(true);
    expect(parseYAxis({ includeZero: "true" })?.includeZero).toBe(false);
    expect(parseYAxis({ label: "Revenue" })?.label).toBe("Revenue");
    expect(parseYAxis({ label: 42 })?.label).toBe("");
  });

  it("accepts ordered finite domain bounds and drops invalid pairs", () => {
    expect(parseYAxis({ min: 0, max: 1 })).toMatchObject({ min: 0, max: 1 });
    expect(parseYAxis({ min: 1, max: 1 })).toMatchObject({
      min: null,
      max: null,
    });
    expect(parseYAxis({ min: 2, max: 1 })).toMatchObject({
      min: null,
      max: null,
    });
    expect(parseYAxis({ min: "nope", max: 1 })).toMatchObject({
      min: null,
      max: 1,
    });
  });
});

/* ----------------------------- formatChartValue ---------------------------- */

describe("formatChartValue", () => {
  const baseSpec = {
    label: "",
    format: "number" as const,
    currency: "USD",
    maximumFractionDigits: 2,
    includeZero: false,
    min: null,
    max: null,
  };

  it("formats plain numbers with the given fraction digits", () => {
    expect(formatChartValue(1234.5, baseSpec)).toBe(
      new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        1234.5,
      ),
    );
  });

  it("formats currency using the configured ISO code", () => {
    expect(
      formatChartValue(1234.5, {
        ...baseSpec,
        format: "currency",
        currency: "EUR",
      }),
    ).toBe(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      }).format(1234.5),
    );
  });

  it("formats percent by treating the value as a fraction", () => {
    expect(formatChartValue(0.18, { ...baseSpec, format: "percent" })).toBe(
      new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(0.18),
    );
  });

  it("falls back to String(value) when the currency code is invalid", () => {
    expect(
      formatChartValue(1234.5, {
        ...baseSpec,
        format: "currency",
        currency: "NOT-A-CODE",
      }),
    ).toBe(String(1234.5));
  });
});
