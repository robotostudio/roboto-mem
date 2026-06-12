import { parse, stringify } from "yaml";

export interface Entry {
  name: string;
  description: string;
  type: "standard" | "lesson";
  scope: string;
  author: string;
  date: string;
  overrides?: string;
  body: string;
  file: string;
}

export type EntryResult =
  | { ok: true; entry: Entry }
  | { ok: false; file: string; error: string };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = new Set(["standard", "lesson"]);

// Pattern: entries/<segment>/<name>.md (org)
// Pattern: entries/<dir>/<sub>/<name>.md (squads/stacks/projects)
const SCOPE_RE =
  /^entries\/(org|squads|stacks|projects)\/(?:([^/]+)\/)?([^/]+)\.md$/;

export const scopeFromPath = (file: string): string | undefined => {
  const m = SCOPE_RE.exec(file);
  if (!m) return undefined;

  const [, dir, sub, name] = m;

  // org: must be entries/org/<name>.md — sub must be absent
  if (dir === "org") {
    return sub === undefined ? "org" : undefined;
  }

  // squads/stacks/projects: must be entries/<dir>/<sub>/<name>.md — sub must be present
  if (!sub) return undefined;

  // name must be present (always true via regex but guard noUncheckedIndexedAccess)
  if (!name) return undefined;

  const prefix =
    dir === "squads" ? "squad" : dir === "stacks" ? "stack" : "project";
  return `${prefix}/${sub}`;
};

export const entryPathForScope = (scope: string, name: string): string => {
  if (scope === "org") return `entries/org/${name}.md`;
  const [prefix, sub] = scope.split("/");
  const dir =
    prefix === "squad" ? "squads" : prefix === "stack" ? "stacks" : "projects";
  return `entries/${dir}/${sub}/${name}.md`;
};

interface RawFrontmatter {
  description?: unknown;
  type?: unknown;
  author?: unknown;
  date?: unknown;
  overrides?: unknown;
  scope?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

const fail = (file: string, error: string): EntryResult => ({
  ok: false,
  file,
  error,
});

const parseFrontmatter = (yamlBlock: string): RawFrontmatter | null => {
  try {
    const parsed: unknown = parse(yamlBlock);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as RawFrontmatter)
      : {};
  } catch {
    return null;
  }
};

export const parseEntry = (raw: string, file: string): EntryResult => {
  if (!raw.startsWith("---\n")) {
    return fail(file, "Missing YAML frontmatter: file must start with ---");
  }

  const closeIdx = raw.indexOf("\n---\n", 4);
  if (closeIdx === -1) {
    return fail(file, "Unclosed YAML frontmatter: missing closing ---");
  }

  const yamlBlock = raw.slice(4, closeIdx);
  const body = raw.slice(closeIdx + 5).trim();

  const fm = parseFrontmatter(yamlBlock);
  if (!fm) {
    return fail(file, "Malformed YAML frontmatter");
  }

  if ("scope" in fm) {
    return fail(file, "scope comes from the file path, not frontmatter");
  }
  if ("name" in fm) {
    return fail(file, "name comes from the file path, not frontmatter");
  }

  const scope = scopeFromPath(file);
  if (!scope) {
    return fail(file, `unknown scope directory: ${file}`);
  }

  if (typeof fm.description !== "string" || !fm.description) {
    return fail(
      file,
      `required field "description" is missing or not a string in ${file}`,
    );
  }
  if (typeof fm.type !== "string" || !VALID_TYPES.has(fm.type)) {
    return fail(
      file,
      `required field "type" must be "standard" or "lesson" in ${file}`,
    );
  }
  if (typeof fm.author !== "string" || !fm.author) {
    return fail(
      file,
      `required field "author" is missing or not a string in ${file}`,
    );
  }
  if (typeof fm.date !== "string" || !DATE_RE.test(fm.date)) {
    return fail(file, `required field "date" must be YYYY-MM-DD in ${file}`);
  }
  if (fm.overrides !== undefined && typeof fm.overrides !== "string") {
    return fail(file, `optional field "overrides" must be a string in ${file}`);
  }

  const name = file.split("/").pop()?.replace(/\.md$/, "") ?? "";

  const entry: Entry = {
    name,
    description: fm.description,
    type: fm.type as "standard" | "lesson",
    scope,
    author: fm.author,
    date: fm.date,
    body,
    file,
    ...(fm.overrides !== undefined
      ? { overrides: fm.overrides as string }
      : {}),
  };

  return { ok: true, entry };
};

export const serializeEntry = (entry: Entry): string => {
  const fm: Record<string, string> = {
    description: entry.description,
    type: entry.type,
    author: entry.author,
    date: entry.date,
    ...(entry.overrides !== undefined ? { overrides: entry.overrides } : {}),
  };

  return `---\n${stringify(fm).trimEnd()}\n---\n${entry.body}`;
};
