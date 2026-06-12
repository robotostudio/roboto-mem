import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExecResult } from "./exec.js";

export interface UpdateCheckInput {
  home: string;
  repoUrl: string;
  currentVersion: string;
  now: () => Date;
  lsRemote: (url: string) => Promise<ExecResult>;
}

interface StateFile {
  lastUpdateCheck?: string;
  latestSeen?: string;
}

const STATE_FILE = "state.json";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const semverParts = (tag: string): [number, number, number] | undefined => {
  const m = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

const isNewer = (candidate: string, current: string): boolean => {
  const a = semverParts(candidate);
  const b = semverParts(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
};

const parseMaxTag = (stdout: string): string | undefined => {
  const tags = stdout
    .split("\n")
    .map((line) => {
      const ref = line.split("\t")[1]?.trim();
      return ref?.replace(/^refs\/tags\//, "");
    })
    .filter((t): t is string => !!t && !t.endsWith("^{}") && !!semverParts(t));

  return tags.reduce<string | undefined>((max, t) => {
    if (!max) return t;
    return isNewer(t, max) ? t : max;
  }, undefined);
};

const readState = async (statePath: string): Promise<StateFile> => {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StateFile;
    }
    return {};
  } catch {
    return {};
  }
};

const writeState = async (
  statePath: string,
  state: StateFile,
): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state), "utf8");
  } catch {
    // best-effort; never throw
  }
};

const nagMessage = (latest: string, current: string): string =>
  `roboto-mem ${latest} available (you have v${current}) — run /mem-upgrade`;

export const checkForUpdate = async (
  input: UpdateCheckInput,
): Promise<string | undefined> => {
  const { home, repoUrl, currentVersion, now, lsRemote } = input;
  const statePath = path.join(home, STATE_FILE);
  const state = await readState(statePath);
  const nowMs = now().getTime();

  const lastCheckMs = state.lastUpdateCheck
    ? new Date(state.lastUpdateCheck).getTime()
    : 0;

  const throttled =
    state.lastUpdateCheck && nowMs - lastCheckMs < TWENTY_FOUR_HOURS_MS;

  if (throttled) {
    return state.latestSeen && isNewer(state.latestSeen, currentVersion)
      ? nagMessage(state.latestSeen, currentVersion)
      : undefined;
  }

  const result = await lsRemote(repoUrl);
  const nowIso = now().toISOString();

  if (!result.ok) {
    await writeState(statePath, {
      ...state,
      lastUpdateCheck: nowIso,
    });
    return undefined;
  }

  const latestSeen = parseMaxTag(result.stdout);
  await writeState(statePath, { lastUpdateCheck: nowIso, latestSeen });

  return latestSeen && isNewer(latestSeen, currentVersion)
    ? nagMessage(latestSeen, currentVersion)
    : undefined;
};
