export interface SessionScopeInput {
  project: string;
  squads: string[];
  workspaces: Record<string, string[]>;
}

const PREFIXED_RE = /^(squad|stack|project)\/([a-z0-9][a-z0-9-]*)$/;

/** Human-readable rule text — single source for both promote's gate-1 error
 * and the interactive scope prompt's validator. */
export const SCOPE_RULE = "org, squad/<s>, stack/<k>, or project/<p>";

export const isValidScope = (scope: string): boolean =>
  scope === "org" || PREFIXED_RE.test(scope);

/** Human-readable rule text — single source for both promote's gate-1 error
 * and the interactive name/scope prompts' validators. */
export const SCOPE_ID_RULE = "/^[a-z0-9][a-z0-9-]*$/";

export const SCOPE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const sessionScopes = (input: SessionScopeInput): string[] => {
  const sortedSquads = [...input.squads]
    .map((s) => `squad/${s}`)
    .sort((a, b) => a.localeCompare(b));

  const stacks = [
    ...new Set(
      Object.values(input.workspaces)
        .flat()
        .filter((s) => s.startsWith("stack/") && isValidScope(s)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return ["org", ...sortedSquads, ...stacks, `project/${input.project}`];
};

// Global library model (Phase 2): untagged entries (no scope: frontmatter)
// always apply; `library:{name}` entries apply only if {name} is declared.
// Legacy org/squad/stack/project values fall through to the pre-existing
// exact-match check, unchanged — see docs/design-specs/2026-07-17-global-library-model.md.
export const LIBRARY_SCOPE_RE = /^library:([a-z0-9][a-z0-9-]*)$/;

export const entryApplies = (
  entryScope: string | undefined,
  scopes: string[],
): boolean => {
  if (!entryScope) return true;
  const match = LIBRARY_SCOPE_RE.exec(entryScope);
  if (!match) return scopes.includes(entryScope);
  const [, library] = match;
  return library !== undefined && scopes.includes(library);
};

export const splitSquads = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
