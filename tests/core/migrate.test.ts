import { describe, expect, it } from "vitest";
import type { RepoConfig } from "../../src/core/config.js";
import { buildMigratedConfig } from "../../src/core/migrate.js";

const BASE_V1: RepoConfig = {
  configVersion: 1,
  commons: "https://github.com/team/commons",
  overlays: [],
  project: "my-app",
  squads: [],
  workspaces: {},
};

describe("buildMigratedConfig", () => {
  it("flattens and unions workspace stacks into libraries, deduped", () => {
    const v1: RepoConfig = {
      ...BASE_V1,
      workspaces: {
        "apps/web": ["next", "react"],
        "apps/api": ["auth0", "nodejs", "next"],
      },
    };
    const migrated = buildMigratedConfig(v1, { ...v1 });
    expect(migrated).toEqual({
      configVersion: 2,
      commons: BASE_V1.commons,
      libraries: ["next", "react", "auth0", "nodejs"],
    });
  });

  it("folds squad names into libraries verbatim, deduped against stacks", () => {
    const v1: RepoConfig = {
      ...BASE_V1,
      squads: ["auth", "growth"],
      workspaces: { ".": ["auth", "next"] },
    };
    const migrated = buildMigratedConfig(v1, { ...v1 });
    expect(migrated.libraries).toEqual(["auth", "next", "growth"]);
  });

  it("returns an empty libraries array when workspaces and squads are both empty", () => {
    const migrated = buildMigratedConfig(BASE_V1, { ...BASE_V1 });
    expect(migrated.libraries).toEqual([]);
  });

  it("preserves overlays under librariesLocal when present", () => {
    const v1: RepoConfig = {
      ...BASE_V1,
      overlays: ["git@example.com:org/shared-overlay.git"],
    };
    const migrated = buildMigratedConfig(v1, { ...v1 });
    expect(migrated.librariesLocal).toEqual([
      "git@example.com:org/shared-overlay.git",
    ]);
  });

  it("omits librariesLocal entirely when overlays is empty", () => {
    const migrated = buildMigratedConfig(BASE_V1, { ...BASE_V1 });
    expect(migrated).not.toHaveProperty("librariesLocal");
  });

  it("drops project, squads, workspaces, overlays as their own top-level keys", () => {
    const v1: RepoConfig = {
      ...BASE_V1,
      squads: ["auth"],
      workspaces: { ".": ["next"] },
    };
    const migrated = buildMigratedConfig(v1, { ...v1 });
    expect(migrated).not.toHaveProperty("project");
    expect(migrated).not.toHaveProperty("squads");
    expect(migrated).not.toHaveProperty("workspaces");
    expect(migrated).not.toHaveProperty("overlays");
  });

  it("round-trips unknown custom keys from the raw v1 JSON", () => {
    const raw = { ...BASE_V1, futureKey: { nested: true } };
    const migrated = buildMigratedConfig(BASE_V1, raw);
    expect(migrated.futureKey).toEqual({ nested: true });
  });

  it("always sets configVersion 2 on the output", () => {
    const migrated = buildMigratedConfig(BASE_V1, { ...BASE_V1 });
    expect(migrated.configVersion).toBe(2);
  });

  it("keeps commons verbatim", () => {
    const migrated = buildMigratedConfig(BASE_V1, { ...BASE_V1 });
    expect(migrated.commons).toBe(BASE_V1.commons);
  });
});
