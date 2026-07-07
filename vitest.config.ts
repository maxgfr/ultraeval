import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never run *.test.ts that live inside fixtures or generated eval run dirs.
    exclude: [...configDefaults.exclude, "**/tests/fixtures/**", "**/.ultraeval/**"],
  },
});
