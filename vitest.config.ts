import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The source imports "cloudflare:workers" (host env access), which does not
// exist under Node — alias it to a stub so pure logic is testable.
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/stub-cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
