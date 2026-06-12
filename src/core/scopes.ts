export interface SessionScopeInput {
  project: string;
  squads: string[];
  workspaces: Record<string, string[]>;
}

const PREFIXED_RE = /^(squad|stack|project)\/([a-z0-9][a-z0-9-]*)$/;

export const SCOPE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const isValidScope = (scope: string): boolean =>
  scope === "org" || PREFIXED_RE.test(scope);

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
