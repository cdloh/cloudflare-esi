import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.spec.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      // v8 coverage is not supported inside workerd
      provider: "istanbul",
      include: ["src/**/*.ts"],
    },
  },
});
