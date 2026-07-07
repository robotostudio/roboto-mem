import { describe, expect, it } from "vitest";
import {
  DATE_RE,
  entryPathForScope,
  isValidDate,
  parseEntry,
  scopeFromPath,
  serializeEntry,
  todayYMD,
} from "../../src/core/entry.js";

const STACK_FILE = "entries/stacks/sanity/typegen.md";
const STACK_RAW = `---
description: TypeGen v3 flag breaks our client wrapper
type: lesson
author: hrithik
date: 2026-05-30
---
Running \`sanity typegen generate\` with --experimental flag breaks createClient typing. Pin to v2 syntax until #123 lands.`;

const ORG_FILE = "entries/org/never-use-let.md";
const ORG_RAW = `---
description: Never use let in TypeScript
type: standard
author: hrithik
date: 2026-01-01
---
Prefer const. Restructure with ternary, reduce, or early returns.`;

const SQUAD_FILE = "entries/squads/web/let-hotpaths.md";
const SQUAD_RAW = `---
description: Let in hot paths is fine
type: standard
author: hrithik
date: 2026-03-15
overrides: org/never-use-let
---
In tight loops where reducing allocations matters, mutable accumulators are acceptable.`;

// 1. Valid lesson at entries/stacks/sanity/typegen.md
describe("parseEntry — valid lesson", () => {
  it("returns ok:true with correct scope, name, and trimmed body", () => {
    const result = parseEntry(STACK_RAW, STACK_FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.scope).toBe("stack/sanity");
    expect(result.entry.name).toBe("typegen");
    expect(result.entry.type).toBe("lesson");
    expect(result.entry.author).toBe("hrithik");
    expect(result.entry.date).toBe("2026-05-30");
    expect(result.entry.file).toBe(STACK_FILE);
    expect(result.entry.body).toBe(
      "Running `sanity typegen generate` with --experimental flag breaks createClient typing. Pin to v2 syntax until #123 lands.",
    );
  });
});

// 2. Valid standard at entries/org/never-use-let.md
describe("parseEntry — valid org standard", () => {
  it("returns ok:true with scope org and type standard", () => {
    const result = parseEntry(ORG_RAW, ORG_FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.scope).toBe("org");
    expect(result.entry.name).toBe("never-use-let");
    expect(result.entry.type).toBe("standard");
  });
});

// 3. Squad entry with overrides
describe("parseEntry — squad entry with overrides", () => {
  it("sets entry.overrides correctly", () => {
    const result = parseEntry(SQUAD_RAW, SQUAD_FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.scope).toBe("squad/web");
    expect(result.entry.overrides).toBe("org/never-use-let");
  });
});

// 4. Missing description
describe("parseEntry — missing description", () => {
  it("returns ok:false with error mentioning description and file", () => {
    const raw = `---
type: standard
author: hrithik
date: 2026-01-01
---
body`;
    const result = parseEntry(raw, ORG_FILE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain("description");
    expect(result.file).toBe(ORG_FILE);
  });
});

// 5. type: rule (invalid)
describe("parseEntry — invalid type value", () => {
  it("returns ok:false", () => {
    const raw = `---
description: something
type: rule
author: hrithik
date: 2026-01-01
---
body`;
    const result = parseEntry(raw, ORG_FILE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(ORG_FILE);
  });
});

// 6. date: yesterday (invalid format)
describe("parseEntry — invalid date", () => {
  it("returns ok:false when date is not YYYY-MM-DD", () => {
    const raw = `---
description: something
type: standard
author: hrithik
date: yesterday
---
body`;
    const result = parseEntry(raw, ORG_FILE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(ORG_FILE);
  });
});

// 7. Unknown scope directory
describe("parseEntry — unknown scope path", () => {
  it("returns ok:false for entries/weird/x.md", () => {
    const raw = `---
description: something
type: standard
author: hrithik
date: 2026-01-01
---
body`;
    const result = parseEntry(raw, "entries/weird/x.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain("scope");
    expect(result.file).toBe("entries/weird/x.md");
  });
});

// 8. Frontmatter with scope key
describe("parseEntry — scope in frontmatter", () => {
  it("returns ok:false when scope is set in frontmatter", () => {
    const raw = `---
description: something
type: standard
author: hrithik
date: 2026-01-01
scope: org
---
body`;
    const result = parseEntry(raw, ORG_FILE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain("scope");
  });
});

// 9. No frontmatter at all
describe("parseEntry — no frontmatter", () => {
  it("returns ok:false when raw does not start with ---", () => {
    const raw = "just some markdown without frontmatter";
    const result = parseEntry(raw, ORG_FILE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(ORG_FILE);
  });
});

// 10. Malformed YAML — does not throw
describe("parseEntry — malformed YAML", () => {
  it("returns ok:false and does not throw", () => {
    const raw = `---
description: [unclosed
type: standard
author: hrithik
date: 2026-01-01
---
body`;
    expect(() => parseEntry(raw, ORG_FILE)).not.toThrow();
    const result = parseEntry(raw, ORG_FILE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.file).toBe(ORG_FILE);
  });
});

// 11. Roundtrip: serializeEntry re-parses deep-equal
describe("serializeEntry — roundtrip", () => {
  it("serialized output re-parses to an equivalent entry", () => {
    const first = parseEntry(STACK_RAW, STACK_FILE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const serialized = serializeEntry(first.entry);
    const second = parseEntry(serialized, STACK_FILE);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entry).toEqual(first.entry);
  });
});

// 12. scopeFromPath unit cases
describe("scopeFromPath", () => {
  it("maps entries/org/<name>.md → org", () => {
    expect(scopeFromPath("entries/org/foo.md")).toBe("org");
  });

  it("maps entries/squads/<s>/<name>.md → squad/<s>", () => {
    expect(scopeFromPath("entries/squads/web/bar.md")).toBe("squad/web");
  });

  it("maps entries/stacks/<k>/<name>.md → stack/<k>", () => {
    expect(scopeFromPath("entries/stacks/sanity/baz.md")).toBe("stack/sanity");
  });

  it("maps entries/projects/<p>/<name>.md → project/<p>", () => {
    expect(scopeFromPath("entries/projects/loggle/qux.md")).toBe(
      "project/loggle",
    );
  });

  it("returns undefined for entries/org/nested/x.md (too deep)", () => {
    expect(scopeFromPath("entries/org/nested/x.md")).toBeUndefined();
  });

  it("returns undefined for other/org/x.md (wrong prefix)", () => {
    expect(scopeFromPath("other/org/x.md")).toBeUndefined();
  });
});

// 13. entryPathForScope ↔ scopeFromPath round-trip
describe("entryPathForScope — round-trip with scopeFromPath", () => {
  it("scopeFromPath(entryPathForScope(scope, name)) === scope for all scope types", () => {
    const scopes = ["org", "squad/web", "stack/sanity", "project/loggle"];
    for (const scope of scopes) {
      expect(scopeFromPath(entryPathForScope(scope, "some-name"))).toBe(scope);
    }
  });
});

describe("todayYMD", () => {
  it("returns a DATE_RE-matching YYYY-MM-DD string", () => {
    expect(todayYMD()).toMatch(DATE_RE);
  });
});

describe("isValidDate", () => {
  it("rejects a month out of range", () => {
    expect(isValidDate("2026-13-99")).toBe(false);
  });

  it("rejects a day out of range for the given month", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
  });

  it("rejects Feb 29 in a non-leap year", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
  });

  it("accepts Feb 29 in a leap year", () => {
    expect(isValidDate("2028-02-29")).toBe(true);
  });

  it("accepts a normal valid date", () => {
    expect(isValidDate("2026-07-06")).toBe(true);
  });

  it("accepts today's date", () => {
    expect(isValidDate(todayYMD())).toBe(true);
  });

  it("rejects anything that fails DATE_RE's format first", () => {
    expect(isValidDate("07/06/2026")).toBe(false);
    expect(isValidDate("not-a-date")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});
