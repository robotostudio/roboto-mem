import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/cli.ts",
  format: "esm",
  platform: "node",
  target: "node20",
  fixedExtension: true,
  dts: false,
  // dist/cli.mjs ships inside a git-installed plugin with NO install step (ADR 0004):
  // every non-builtin import must be inlined, or the CLI crashes on user machines.
  noExternal: (id: string) => !id.startsWith("node:"),
  outputOptions: {
    banner: "#!/usr/bin/env node",
    inlineDynamicImports: true,
  },
});
