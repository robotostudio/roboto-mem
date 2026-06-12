export interface ScanFinding {
  severity: "error" | "warning";
  rule: string;
  match: string;
}

interface Rule {
  id: string;
  severity: ScanFinding["severity"];
  pattern: RegExp;
  filter?: (raw: string) => boolean;
}

// secret-assignment: exclude placeholder values that start with "<"
const isNotPlaceholder = (raw: string): boolean => {
  const valueMatch = /[:=]\s*["']([^"']*)["']/.exec(raw);
  return !valueMatch?.[1]?.startsWith("<");
};

const RULES: readonly Rule[] = [
  {
    id: "aws-access-key",
    severity: "error",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "github-token",
    severity: "error",
    pattern: /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  },
  {
    id: "api-key",
    severity: "error",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "private-key",
    severity: "error",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    id: "secret-assignment",
    severity: "error",
    pattern:
      /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/gi,
    filter: isNotPlaceholder,
  },
  {
    id: "email",
    severity: "warning",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
];

const redact = (raw: string): string => `${raw.slice(0, 6)}…`;

export const scanEntry = (text: string): ScanFinding[] => {
  const findings: Array<{
    index: number;
    length: number;
    finding: ScanFinding;
  }> = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const m of text.matchAll(re)) {
      const raw = m[0];
      if (rule.filter && !rule.filter(raw)) continue;
      findings.push({
        index: m.index ?? 0,
        length: raw.length,
        finding: { severity: rule.severity, rule: rule.id, match: redact(raw) },
      });
    }
  }

  const sorted = findings.sort((a, b) => a.index - b.index);

  // Collect error spans for containment check
  const errorSpans = sorted
    .filter((f) => f.finding.severity === "error")
    .map((f) => ({ start: f.index, end: f.index + f.length }));

  const isContainedInErrorSpan = (f: {
    index: number;
    length: number;
  }): boolean =>
    errorSpans.some(
      (span) => f.index >= span.start && f.index + f.length <= span.end,
    );

  return sorted
    .filter(
      (f) => f.finding.severity !== "warning" || !isContainedInErrorSpan(f),
    )
    .map((f) => f.finding);
};
