import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tmpDirFactory = (prefix: string) => {
  const dirs: string[] = [];
  const make = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  const cleanup = async (): Promise<void> => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  };
  return { make, cleanup };
};
