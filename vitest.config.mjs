import { fileURLToPath } from "node:url";
import { configDefaults } from "vitest/config";

export default {
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The server-only marker is empty in Next's server environment.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs}"],
    exclude: [
      ...configDefaults.exclude,
      "**/.production-backups/**",
      "**/output/**",
      "src/components/hosted/hosted-organization-administration.test.mjs",
      "src/services/komocontrol-game-officials.test.mjs",
      "src/services/supporters.organization.test.mjs",
    ],
  },
};
