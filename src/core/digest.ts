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

const scopeRank = (scope: string): [number, string] => {
  if (scope === "org") return [0, ""];
  if (scope.startsWith("squad/")) return [1, scope];
  if (scope.startsWith("stack/")) return [2, scope];
  return [3, scope]; // project/*
};

const compareScopes = (a: string, b: string): number => {
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
  // Build lookup: "scope/name" → entry (standards only)
  const lookup = new Map<string, Entry>(
    standards.map((e) => [`${e.scope}/${e.name}`, e]),
  );

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
    const ref = `${e.scope}/${e.name}`;

    if (suppressedRefs.has(ref)) {
      const overrider = resolution.overrideMap.get(ref);
      lines.push(`### [${e.scope}] ${e.name}`);
      lines.push("");
      lines.push(
        `> ${ref} is overridden for this repo by ${overrider?.scope}/${overrider?.name}.`,
      );
      lines.push("");
      continue;
    }

    // Normal (possibly overriding) entry
    const overridesLabel = e.overrides ? ` — overrides ${e.overrides}` : "";
    lines.push(`### [${e.scope}] ${e.name}${overridesLabel}`);
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
  `- [${e.scope}] ${e.name} — ${e.description} (${e.file}, ${e.date})`;

// ─── Budget warnings ──────────────────────────────────────────────────────────

const budgetWarnings = (
  scopeTexts: Map<string, string>,
  budgets: Record<string, number>,
  orderedScopes: string[],
): string => {
  const warnings: string[] = [];
  for (const scope of orderedScopes) {
    const text = scopeTexts.get(scope) ?? "";
    if (!text) continue;
    const tokens = estimateTokens(text);
    const cap = budgets[scope] ?? budgets.default ?? 2000;
    if (tokens > cap) {
      warnings.push(
        `> WARNING: scope ${scope} exceeds its budget (${tokens} > ${cap} tokens). Prune or split entries.`,
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
    const ref = `${e.scope}/${e.name}`;
    const contribution = resolution.suppressedRefs.has(ref)
      ? `> ${ref} is overridden for this repo by ${resolution.overrideMap.get(ref)?.scope}/${resolution.overrideMap.get(ref)?.name}.`
      : e.body;
    const chunks = scopeChunks.get(e.scope) ?? [];
    chunks.push(contribution);
    scopeChunks.set(e.scope, chunks);
  }

  for (const e of lessons) {
    const chunks = scopeChunks.get(e.scope) ?? [];
    chunks.push(renderLesson(e));
    scopeChunks.set(e.scope, chunks);
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
