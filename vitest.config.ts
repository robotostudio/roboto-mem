import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests spawn `git commit`; CI runners configure no identity and disable
    // auto-detect, so set author/committer here to keep the suite self-contained.
    env: {
      GIT_AUTHOR_NAME: "roboto-mem tests",
      GIT_AUTHOR_EMAIL: "tests@roboto.studio",
      GIT_COMMITTER_NAME: "roboto-mem tests",
      GIT_COMMITTER_EMAIL: "tests@roboto.studio",
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/cli.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      reporter: ["text", "lcov"],
    },
  },
});
