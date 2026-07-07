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

export const entryApplies = (entryScope: string, scopes: string[]): boolean =>
  scopes.includes(entryScope);

export const splitSquads = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
