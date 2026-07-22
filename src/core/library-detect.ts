import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SCOPE_ID_RE } from "./scopes.js";

/**
 * Hardcoded npm-scope → library-name aliases (global library model, init
 * detection step 5: "v1 bootstrap... extensible in Phase 3"). Only SCOPED
 * packages (`@scope/pkg`) need an alias — unscoped deps match a library name
 * via exact string intersection (step 6). Deliberately NOT STACK_SIGNALS
 * (src/core/detect.ts): that table emits stack names like "nextjs", not
 * library names like "next", and has no Resend/Auth0 entries — see
 * docs/design-specs/2026-07-17-global-library-model.md.
 */
export const LIBRARY_ALIASES: Readonly<Record<string, string>> = {
  "@auth0": "auth0",
  "@sanity": "sanity",
  "@shopify": "shopify",
};

export interface DetectionWarning {
  dep: string;
  message: string;
}

export interface LibraryDetectionResult {
  detected: string[];
  warnings: DetectionWarning[];
}

/**
 * Enumerates `commons/libraries/` — each subdirectory is a library (init
 * detection step 4). Returns `undefined` when the directory is entirely
 * absent (caller surfaces "Commons has no libraries. Team must create
 * v2-format commons."); an empty array means the directory exists but the
 * team hasn't added any libraries yet — not an error. Directory names that
 * fail SCOPE_ID_RE are dropped: such a name could never match a
 * `library:<name>` scope tag (LIBRARY_SCOPE_RE) or pass promote's own
 * SCOPE_ID_RE gate, so it would only be dead weight in init's selection
 * list and config.libraries.
 */
export const listCommonsLibraries = async (
  commonsDir: string,
): Promise<string[] | undefined> => {
  const entries = await readdir(join(commonsDir, "libraries"), {
    withFileTypes: true,
  }).catch(() => undefined);
  if (!entries) return undefined;
  return entries
    .filter((e) => e.isDirectory() && SCOPE_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
};

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * `package.json` `dependencies` ∪ `devDependencies` keys (init detection
 * step 5, root only, npm-only for v1). Returns `undefined` for a missing OR
 * malformed `package.json` — both cases mean "skip detection, offer an
 * empty config" per the spec, since neither yields a usable dependency list.
 */
export const scanPackageDeps = async (
  dir: string,
): Promise<string[] | undefined> => {
  const raw = await readFile(join(dir, "package.json"), "utf8").catch(
    () => null,
  );
  if (raw === null) return undefined;
  try {
    const pkg = JSON.parse(raw) as PkgJson;
    return [
      ...new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]),
    ];
  } catch {
    return undefined;
  }
};

type DepMatch = { library: string } | { warning: string } | undefined;

/** Exact-intersection matching rule (step 5): unscoped deps match a library
 * name verbatim; scoped deps (`@scope/pkg`) go through LIBRARY_ALIASES
 * first. A scoped dep with no alias entry warns rather than silently
 * dropping — the user may still need to add it manually. */
const matchDep = (dep: string, available: ReadonlySet<string>): DepMatch => {
  if (!dep.startsWith("@")) {
    return available.has(dep) ? { library: dep } : undefined;
  }
  const scope = dep.split("/")[0] ?? dep;
  const alias = LIBRARY_ALIASES[scope];
  if (!alias) {
    return {
      warning: `Couldn't map ${dep} to a known library; add manually if needed`,
    };
  }
  return available.has(alias) ? { library: alias } : undefined;
};

/** Intersects `deps` against `available` commons libraries (init detection
 * steps 5–6), applying the alias table for scoped packages. Result is
 * sorted + deduped. */
export const mapDepsToLibraries = (
  deps: string[],
  available: string[],
): LibraryDetectionResult => {
  const availableSet = new Set(available);
  const detected = new Set<string>();
  const warnings: DetectionWarning[] = [];

  for (const dep of deps) {
    const match = matchDep(dep, availableSet);
    if (!match) continue;
    if ("warning" in match) {
      warnings.push({ dep, message: match.warning });
      continue;
    }
    detected.add(match.library);
  }

  return {
    detected: [...detected].sort((a, b) => a.localeCompare(b)),
    warnings,
  };
};
