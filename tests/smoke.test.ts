import { describe, expect, it } from "vitest";
import type { CommandResult } from "../src/core/types.js";

describe("toolchain", () => {
  it("compiles and runs a typed test", () => {
    const result: CommandResult = { exitCode: 0, output: "" };
    expect(result.exitCode).toBe(0);
  });
});
