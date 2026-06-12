import { describe, expect, it } from "vitest";
import { scanEntry } from "../../src/core/scan.js";

describe("scanEntry", () => {
  // ---- MUST FLAG ----

  it("flags AWS access key", () => {
    const findings = scanEntry("key is AKIAIOSFODNN7EXAMPLE");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      rule: "aws-access-key",
    });
    expect(findings[0]?.match).toBe("AKIAIO…");
    expect(findings[0]?.match).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("flags GitHub token (ghp_ variant)", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const findings = scanEntry(`token is ${token}`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      rule: "github-token",
    });
    expect(findings[0]?.match).toBe("ghp_aa…");
  });

  it("flags generic API key (sk- prefix)", () => {
    const key = `sk-${"a".repeat(24)}`;
    const findings = scanEntry(`use ${key} to auth`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "error", rule: "api-key" });
    expect(findings[0]?.match).toBe("sk-aaa…");
  });

  it("flags private key block", () => {
    const findings = scanEntry("-----BEGIN RSA PRIVATE KEY-----");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      rule: "private-key",
    });
    expect(findings[0]?.match).toBe("-----B…");
  });

  it("flags secret assignments (two findings)", () => {
    const text = `api_key: "abcd1234efgh"\npassword = 'hunter22222'`;
    const findings = scanEntry(text);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: "error",
      rule: "secret-assignment",
    });
    expect(findings[1]).toMatchObject({
      severity: "error",
      rule: "secret-assignment",
    });
  });

  it("flags email address with warning severity", () => {
    const findings = scanEntry("ping hrithik.lead@gmail.com about this");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      rule: "email",
    });
    expect(findings[0]?.match).toBe("hrithi…");
  });

  // ---- MUST NOT FLAG ----

  it("does not flag 'token' in plain prose", () => {
    expect(scanEntry("rotate the token after deploys")).toHaveLength(0);
  });

  it("does not flag env reference", () => {
    expect(scanEntry("read it from process.env.API_KEY")).toHaveLength(0);
  });

  it("does not flag placeholder value starting with '<'", () => {
    expect(scanEntry('api_key: "<your-api-key>"')).toHaveLength(0);
  });

  it("does not flag short AKIA (too short)", () => {
    expect(scanEntry("AKIA1234")).toHaveLength(0);
  });

  // ---- MULTI / CLEAN ----

  it("returns multiple findings in document order", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const ghToken = `ghp_${"b".repeat(36)}`;
    const findings = scanEntry(`${awsKey} and ${ghToken}`);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.rule).toBe("aws-access-key");
    expect(findings[1]?.rule).toBe("github-token");
  });

  it("returns empty array for clean text", () => {
    expect(scanEntry("nothing sensitive here")).toHaveLength(0);
  });

  // ---- SPAN SUPPRESSION: warning inside error span ----

  it("token with embedded email yields exactly one finding (error wins)", () => {
    // secret-assignment matches the entire token: "ops@team.io"
    // email rule also matches ops@team.io — but it's inside the error span, so suppressed
    const findings = scanEntry('contact_token: "ops@team.io"');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      rule: "secret-assignment",
    });
  });

  it("email in prose + separate AKIA key: both findings survive", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    // email is at a completely different offset from the AKIA key span
    const findings = scanEntry(`ping alice@example.com and use ${awsKey}`);
    expect(findings).toHaveLength(2);
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain("email");
    expect(rules).toContain("aws-access-key");
  });
});
