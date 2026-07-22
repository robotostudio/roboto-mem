import type { Entry } from "./entry.js";
import { entryApplies } from "./scopes.js";

export interface DigestMeta {
  toolVersion: string;
  formatVersion: number;
  syncedDate: string;
  nag?: string;
  stale?: string;
}

export interface DigestInput {
  entries: Entry[];
  sessionScopes: string[];
  budgets: Record<string, number>;
  meta: DigestMeta;
}

export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

// ─── Scope ordering ───────────────────────────────────────────────────────────

// Global library model: untagged (scope undefined) entries rank first —
// see docs/design-specs/2026-07-17-global-library-model.md.
const scopeRank = (scope: string | undefined): [number, string] => {
  if (!scope) return [0, ""];
  if (scope === "org") return [1, ""];
  if (scope.startsWith("squad/")) return [2, scope];
  if (scope.startsWith("stack/")) return [3, scope];
  return [4, scope]; // project/*, library:*, etc.
};

const compareScopes = (
  a: string | undefined,
  b: string | undefined,
): number => {
  const [ra, sa] = scopeRank(a);
  const [rb, sb] = scopeRank(b);
  return ra !== rb ? ra - rb : sa.localeCompare(sb);
};

// ─── Sorting entries deterministically ───────────────────────────────────────

const sortEntries = (entries: Entry[]): Entry[] =>
  [...entries].sort((a, b) => {
    const sc = compareScopes(a.scope, b.scope);
    return sc !== 0 ? sc : a.name.localeCompare(b.name);
  });

// ─── Scope/ref helpers (global library model) ─────────────────────────────────
// Untagged entries use a bare `{name}` override ref (no prefix) and render
// under a "global" label — see docs/design-specs/2026-07-17-global-library-model.md.

export const entryRef = (e: Entry): string =>
  e.scope ? `${e.scope}/${e.name}` : e.name;

export const scopeKey = (scope: string | undefined): string =>
  scope ?? "global";

// ─── Override resolution ──────────────────────────────────────────────────────
// Only Standards can be override targets (lessons are excluded).
// overrideMap: ref ("scope/name") → the overriding Entry
// suppressedRefs: set of refs whose body must be replaced by a pointer line

interface OverrideResolution {
  overrideMap: Map<string, Entry>;
  suppressedRefs: Set<string>;
  warningRefs: Set<string>; // overrides refs that matched nothing
}

const resolveOverrides = (standards: Entry[]): OverrideResolution => {
  // Build lookup: entry ref ("scope/name", or bare "name" if untagged) → entry (standards only)
  const lookup = new Map<string, Entry>(standards.map((e) => [entryRef(e), e]));

  const overrideMap = new Map<string, Entry>();
  const suppressedRefs = new Set<string>();
  const warningRefs = new Set<string>();

  for (const e of standards) {
    if (!e.overrides) continue;
    if (lookup.has(e.overrides)) {
      overrideMap.set(e.overrides, e);
      suppressedRefs.add(e.overrides);
    } else {
      warningRefs.add(e.overrides);
    }
  }

  return { overrideMap, suppressedRefs, warningRefs };
};

// ─── Section renderers ────────────────────────────────────────────────────────

const renderStandards = (
  standards: Entry[],
  resolution: OverrideResolution,
): string => {
  const { suppressedRefs, warningRefs } = resolution;
  const lines: string[] = [];

  for (const e of standards) {
    const ref = entryRef(e);

    if (suppressedRefs.has(ref)) {
      const overrider = resolution.overrideMap.get(ref);
      lines.push(`### [${scopeKey(e.scope)}] ${e.name}`);
      lines.push("");
      lines.push(
        `> ${ref} is overridden for this repo by ${overrider ? entryRef(overrider) : "unknown"}.`,
      );
      lines.push("");
      continue;
    }

    // Normal (possibly overriding) entry
    const overridesLabel = e.overrides ? ` — overrides ${e.overrides}` : "";
    lines.push(`### [${scopeKey(e.scope)}] ${e.name}${overridesLabel}`);
    lines.push("");
    lines.push(e.body);
    lines.push("");

    // Append warning if this entry's overrides ref matched nothing
    if (e.overrides && warningRefs.has(e.overrides)) {
      lines.push(
        `> WARNING: declared override target ${e.overrides} not found.`,
      );
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
};

const renderLesson = (e: Entry): string =>
  `- [${scopeKey(e.scope)}] ${e.name} — ${e.description} (${e.file}, ${e.date})`;

// ─── Budget warnings ──────────────────────────────────────────────────────────

const budgetWarnings = (
  scopeTexts: Map<string, string>,
  budgets: Record<string, number>,
  orderedScopes: (string | undefined)[],
): string => {
  const warnings: string[] = [];
  for (const scope of orderedScopes) {
    const key = scopeKey(scope);
    const text = scopeTexts.get(key) ?? "";
    if (!text) continue;
    const tokens = estimateTokens(text);
    const cap = budgets[key] ?? budgets.default ?? 2000;
    if (tokens > cap) {
      warnings.push(
        `> WARNING: scope ${key} exceeds its budget (${tokens} > ${cap} tokens). Prune or split entries.`,
      );
    }
  }
  return warnings.join("\n");
};

// ─── Main compiler ────────────────────────────────────────────────────────────

export const compileDigest = (input: DigestInput): string => {
  const { entries, sessionScopes, budgets, meta } = input;

  // Filter applying entries, then sort deterministically
  const applying = sortEntries(
    entries.filter((e) => entryApplies(e.scope, sessionScopes)),
  );

  const standards = applying.filter((e) => e.type === "standard");
  const lessons = applying.filter((e) => e.type === "lesson");

  const resolution = resolveOverrides(standards);

  // Collect per-scope rendered text for budget accounting
  // We need the scopes in canonical order
  const scopeOrder = [...new Set(applying.map((e) => e.scope))].sort(
    compareScopes,
  );

  const renderSection = (title: string, content: string): string =>
    content ? `## ${title}\n\n${content}` : "";

  // Build standards section text
  const standardsSectionText = renderSection(
    "Standards",
    standards.length ? renderStandards(standards, resolution) : "",
  );

  // Build lessons section text
  const lessonsSectionText = renderSection(
    "Lessons (read the file before relying on one)",
    lessons.length ? lessons.map(renderLesson).join("\n") : "",
  );

  // Per-scope text accumulation for budget warnings
  // Standards: only the body text (and pointer lines) per scope
  const scopeChunks = new Map<string, string[]>();

  for (const e of standards) {
    const ref = entryRef(e);
    const overrider = resolution.overrideMap.get(ref);
    const contribution = resolution.suppressedRefs.has(ref)
      ? `> ${ref} is overridden for this repo by ${overrider ? entryRef(overrider) : "unknown"}.`
      : e.body;
    const key = scopeKey(e.scope);
    const chunks = scopeChunks.get(key) ?? [];
    chunks.push(contribution);
    scopeChunks.set(key, chunks);
  }

  for (const e of lessons) {
    const key = scopeKey(e.scope);
    const chunks = scopeChunks.get(key) ?? [];
    chunks.push(renderLesson(e));
    scopeChunks.set(key, chunks);
  }

  const scopeTextMap = new Map<string, string>(
    [...scopeChunks.entries()].map(([scope, chunks]) => [
      scope,
      chunks.join(""),
    ]),
  );

  const warnings = budgetWarnings(scopeTextMap, budgets, scopeOrder);

  // Assemble header
  const header = `# Team Memory (roboto-mem v${meta.toolVersion} · format ${meta.formatVersion} · synced ${meta.syncedDate})`;

  // Body sections
  const bodySections = [standardsSectionText, lessonsSectionText]
    .filter(Boolean)
    .join("\n\n");

  const bodyContent =
    bodySections || "No Team Memory entries apply to this repo's scopes.";

  // Assemble parts
  const parts: string[] = [];

  if (meta.stale) parts.push(`> STALE: ${meta.stale}`);
  parts.push(header);
  if (meta.nag) parts.push(`> ${meta.nag}`);
  parts.push("");
  parts.push(bodyContent);

  if (warnings) {
    parts.push("");
    parts.push(warnings);
  }

  return parts.join("\n");
};
