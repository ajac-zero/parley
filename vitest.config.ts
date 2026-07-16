import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "examples/**/*.test.ts"],
    environment: "node",
  },
});
