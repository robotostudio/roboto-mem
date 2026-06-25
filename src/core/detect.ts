import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";

export const STACK_SIGNALS: ReadonlyArray<{
  stack: string;
  deps: readonly string[];
  files: readonly string[];
}> = [
  {
    stack: "nextjs",
    deps: ["next"],
    files: ["next.config.js", "next.config.ts", "next.config.mjs"],
  },
  { stack: "react", deps: ["react"], files: [] },
  {
    stack: "sanity",
    deps: ["sanity", "@sanity/client"],
    files: ["sanity.config.ts", "sanity.config.js"],
  },
  {
    stack: "shopify",
    deps: ["@shopify/hydrogen", "@shopify/shopify-api"],
    files: [],
  },
  {
    stack: "astro",
    deps: ["astro"],
    files: ["astro.config.mjs", "astro.config.ts"],
  },
  {
    stack: "remix",
    deps: ["@remix-run/node", "react-router"],
    files: [],
  },
  { stack: "vue", deps: ["vue", "nuxt"], files: [] },
  { stack: "typescript", deps: ["typescript"], files: ["tsconfig.json"] },
];

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

async function readPkg(dir: string): Promise<PkgJson | null> {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf8");
    return JSON.parse(raw) as PkgJson;
  } catch {
    return null;
  }
}

async function detectStacks(dir: string, pkg: PkgJson): Promise<string[]> {
  const allDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  const matched = new Set<string>();

  for (const signal of STACK_SIGNALS) {
    const depHit = signal.deps.some((d) => allDeps.has(d));
    if (depHit) {
      matched.add(`stack/${signal.stack}`);
      continue;
    }
    for (const f of signal.files) {
      try {
        await readFile(join(dir, f));
        matched.add(`stack/${signal.stack}`);
        break;
      } catch {
        // file absent — try next
      }
    }
  }

  return [...matched].sort((a, b) => a.localeCompare(b));
}

async function resolveGlobs(
  root: string,
  patterns: string[],
): Promise<string[]> {
  const matches = await glob(patterns, {
    cwd: root,
    onlyDirectories: true,
    expandDirectories: false,
  });
  // strip trailing slash tinyglobby appends for directories
  const normalized = matches.map((r) => r.replace(/\/$/, ""));
  // filter to those containing a package.json
  const verified = await Promise.all(
    normalized.map(async (rel) => {
      try {
        await readFile(join(root, rel, "package.json"));
        return rel;
      } catch {
        return null;
      }
    }),
  );
  return verified.filter((r): r is string => r !== null);
}

async function readPnpmWorkspaceGlobs(root: string): Promise<string[] | null> {
  try {
    const raw = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
    const parsed = parseYaml(raw) as { packages?: string[] } | null;
    return parsed?.packages ?? null;
  } catch {
    return null;
  }
}

function extractNpmWorkspaceGlobs(pkg: PkgJson): string[] | null {
  const ws = pkg.workspaces;
  if (!ws) return null;
  return Array.isArray(ws) ? ws : (ws.packages ?? null);
}

export const detectWorkspaces = async (
  root: string,
): Promise<Record<string, string[]>> => {
  const rootPkg = await readPkg(root);

  const pnpmGlobs = await readPnpmWorkspaceGlobs(root);
  // pnpm-workspace.yaml wins over package.json#workspaces when both exist (pnpm is authoritative for pnpm repos)
  const childGlobs =
    pnpmGlobs ?? (rootPkg ? extractNpmWorkspaceGlobs(rootPkg) : null);

  const result: Record<string, string[]> = {};

  if (childGlobs && childGlobs.length > 0) {
    const childDirs = await resolveGlobs(root, childGlobs);

    await Promise.all(
      childDirs.map(async (relDir) => {
        const absDir = join(root, relDir);
        const pkg = await readPkg(absDir);
        if (!pkg) return;
        const stacks = await detectStacks(absDir, pkg);
        if (stacks.length > 0) {
          result[relDir] = stacks;
        }
      }),
    );

    if (rootPkg) {
      const rootStacks = await detectStacks(root, rootPkg);
      if (rootStacks.length > 0) {
        result["."] = rootStacks;
      }
    }

    return result;
  }

  if (!rootPkg) return {};

  const stacks = await detectStacks(root, rootPkg);
  if (stacks.length > 0) {
    result["."] = stacks;
  }
  return result;
};
