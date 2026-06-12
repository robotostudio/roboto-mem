import { realpath } from "node:fs/promises";
import * as os from "node:os";
import { describe, expect, it } from "vitest";
import { exec } from "../../src/core/exec.js";

describe("exec", () => {
  it("returns stdout on success", async () => {
    const result = await exec("echo", ["hi"]);
    expect(result).toEqual({ ok: true, stdout: "hi" });
  });

  it("returns ok:false with real exit code on non-zero exit", async () => {
    const result = await exec("node", ["-e", "process.exit(3)"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(3);
      expect(result.reason).toBe("exit");
    }
  });

  it("captures stderr on failure", async () => {
    const result = await exec("node", [
      "-e",
      "console.error('boom'); process.exit(1)",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stderr).toContain("boom");
  });

  it("honours cwd option", async () => {
    const result = await exec("node", ["-e", "console.log(process.cwd())"], {
      cwd: os.tmpdir(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const actual = await realpath(result.stdout);
      const expected = await realpath(os.tmpdir());
      expect(actual).toBe(expected);
    }
  });

  it("resolves ok:false on timeout with stderr mentioning timeout", async () => {
    const start = Date.now();
    const result = await exec("node", ["-e", "setTimeout(()=>{},5000)"], {
      timeoutMs: 200,
    });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
      expect(result.code).toBe(-1);
      expect(result.stderr.toLowerCase()).toContain("timeout");
    }
  });

  it("returns ok:false on ENOENT without throwing", async () => {
    const result = await exec("definitely-not-a-real-binary-xyz", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("spawn");
      expect(result.code).toBe(-1);
    }
  });
});
