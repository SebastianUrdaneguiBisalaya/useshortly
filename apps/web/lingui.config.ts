import { defineConfig } from "@lingui/cli";

export default defineConfig({
  locales: ["en", "es"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["<rootDir>/src/app", "<rootDir>/src/features", "<rootDir>/src/hooks"],
    },
  ],
});
