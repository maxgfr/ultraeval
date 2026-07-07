import { defineConfig } from "tsup";

// One committed, dependency-free ESM bundle at scripts/ultraeval.mjs (mirrored
// byte-for-byte into skills/ultraeval/scripts/ by copy-bundle.mjs). The skill
// ships standalone, so the engine must be a single self-contained file.
export default defineConfig({
  entry: { ultraeval: "src/cli.ts" },
  outDir: "scripts",
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  target: "node18",
  platform: "node",
  bundle: true,
  clean: false,
  minify: false,
  splitting: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
});
