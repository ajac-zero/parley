/**
 * Guards the manifest ↔ renderer coupling. The registry in catalog.tsx
 * throws at module load if a plugin manifest lacks its renderer views;
 * importing it here surfaces that mismatch in CI instead of crashing the
 * client bundle (or SSR) at first render after a deploy.
 */

import { describe, expect, it } from "vitest";
import { catalogComponentViews } from "~/components/a2ui/catalog";
import { A2UI_CATALOG_PLUGINS } from "~/lib/a2ui-catalog-plugins";

describe("catalog renderer registry", () => {
  it("resolves component views for every installed catalog ID", () => {
    for (const plugin of A2UI_CATALOG_PLUGINS) {
      for (const catalogId of plugin.catalogIds) {
        expect(
          catalogComponentViews(catalogId),
          `plugin "${plugin.key}" registered catalog ${catalogId} without renderer views`,
        ).toBeDefined();
      }
    }
  });

  it("fails closed for catalog IDs that are not installed", () => {
    expect(
      catalogComponentViews("https://example.com/unknown/catalog.json"),
    ).toBeUndefined();
  });
});
