import { describe, expect, it } from "vitest";
import { MAX_COMPONENTS, suspiciousName, validateBundle } from "@/ingestion/engine/validate";

const ev = (url = "https://fake.example.com/docs/button") => [
  { field: "*", sourceUrl: url, retrievedAt: "2026-11-05T00:00:00.000Z", extractionMethod: "adapter:test:json", state: "verified", confidence: 0.9 },
];

const comp = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, name: slug.replace(/-/g, " "), evidence: ev(), ...extra });

const tokenSet = (tokens: unknown[], extra: Record<string, unknown> = {}) => ({
  slug: "base",
  name: "Base",
  format: "dtcg",
  sourceUrl: "https://fake.example.com/tokens/base.json",
  tokens,
  evidence: ev("https://fake.example.com/tokens/base.json"),
  ...extra,
});

const tok = (name: string, rawValue: unknown, type: string | null = "color", references: string[] = []) => ({ name, path: name.split("."), type, category: "color", rawValue, references });

const run = (bundle: Record<string, unknown>, adapterIssues = []) => validateBundle({ systemSlug: "sys", components: [], tokenSets: [], patterns: [], ...bundle }, { systemSlug: "sys", adapterIssues });
const entity = (r: ReturnType<typeof run>, kind: string, key: string) => r.entities.find((e) => e.kind === kind && e.key === key)!;

describe("validateBundle", () => {
  it("accepts a clean bundle", () => {
    const r = run({ components: [comp("button")], tokenSets: [tokenSet([tok("color.blue", "#00f")])] });
    expect(r.bundleIssues).toEqual([]);
    expect(entity(r, "component", "button").validation).toBe("valid");
    expect(entity(r, "token-set", "base").validation).toBe("valid");
    expect(r.blockRemovals).toBe(false);
  });

  it("collapses identical duplicates with a warning and quarantines conflicting ones", () => {
    const r = run({ components: [comp("button"), comp("button"), comp("menu", { description: "a" }), comp("menu", { description: "b" })] });
    expect(r.entities.filter((e) => e.kind === "component").length).toBe(2);
    const b = entity(r, "component", "button");
    expect(b.validation).toBe("warning");
    expect(b.issues[0]!.code).toBe("DUPLICATE");
    const m = entity(r, "component", "menu");
    expect(m.validation).toBe("conflict");
    expect((m.payload.candidates as unknown[]).length).toBe(2);
  });

  it("rejects contract violations and non-http URLs", () => {
    const r = run({
      components: [
        { slug: "Bad Slug", name: "x", evidence: ev() },
        comp("no-evidence", { evidence: [] }),
        comp("js-url", { docsUrl: "javascript:alert(1)" }),
        comp("ftp-variant", { variants: [{ name: "a", sourceUrl: "ftp://fake.example.com/a" }] }),
      ],
    });
    for (const k of ["Bad Slug", "no-evidence", "js-url", "ftp-variant"]) expect(entity(r, "component", k).validation).toBe("invalid");
    expect(entity(r, "component", "ftp-variant").issues.some((i) => i.code === "INVALID_URL" && i.path === "variants.0.sourceUrl")).toBe(true);
  });

  it("warns when 3+ components publish an identical keyboard table (copied fragment)", () => {
    const kb = [
      { keys: "Tab", action: "Moves focus to the button" },
      { keys: "Space", action: "Activates the button" },
    ];
    const a11y = { accessibility: { keyboard: kb } };
    const r = run({ components: [comp("button", a11y), comp("meter", a11y), comp("help-text", a11y), comp("menu", { accessibility: { keyboard: [kb[0]!, { keys: "Enter", action: "Opens" }] } })] });
    for (const k of ["button", "meter", "help-text"]) {
      const e = entity(r, "component", k);
      expect(e.validation).toBe("warning");
      expect(e.issues.some((i) => i.code === "DUPLICATE_KEYBOARD")).toBe(true);
    }
    expect(entity(r, "component", "menu").issues.some((i) => i.code === "DUPLICATE_KEYBOARD")).toBe(false);
    const two = run({ components: [comp("button", a11y), comp("meter", a11y)] });
    expect(entity(two, "component", "meter").issues.some((i) => i.code === "DUPLICATE_KEYBOARD")).toBe(false);
  });

  it("flags unknown taxonomy types and frameworks as warnings", () => {
    const r = run({ components: [comp("thing", { canonicalType: "not-a-type", frameworks: [{ slug: "react" }, { slug: "cobol-ui" }] })] });
    const e = entity(r, "component", "thing");
    expect(e.validation).toBe("warning");
    expect(e.issues.map((i) => i.code).sort()).toEqual(["FRAMEWORK_MISMATCH", "UNKNOWN_TYPE"]);
  });

  it("quarantines navigation/marketing text posing as component names", () => {
    const r = run({ components: [comp("getting-started", { name: "Getting started" }), comp("learn-more", { name: "Learn more →" }), comp("button", { name: "Button" })] });
    expect(entity(r, "component", "getting-started").validation).toBe("invalid");
    // ambiguous phrases ("Learn more", "Table of contents", "Download") are real component names in some systems: warn only
    expect(entity(r, "component", "learn-more").validation).toBe("warning");
    expect(entity(r, "component", "button").validation).toBe("valid");
  });

  it("drops invalid and conflicting tokens but keeps the set", () => {
    const r = run({
      tokenSets: [
        tokenSet([
          tok("color.ok", "#fff"),
          tok("color.bad", "16px"),
          tok("space.bad", "lots", "dimension"),
          tok("dup", "#000"),
          tok("dup", "#111"),
          tok("same", "#222"),
          tok("same", "#222"),
          tok("alias", "{color.ok}", "color", ["color.ok"]),
        ]),
      ],
    });
    const s = entity(r, "token-set", "base");
    expect(s.validation).toBe("warning");
    expect(s.droppedTokens).toEqual(["color.bad", "dup", "space.bad"]);
    expect(s.issues.filter((i) => i.code === "INVALID_TOKEN_VALUE").length).toBe(2);
    expect(s.issues.some((i) => i.code === "CONFLICT" && i.entityKey === "base:dup")).toBe(true);
    expect(s.issues.some((i) => i.code === "DUPLICATE" && i.entityKey === "base:same")).toBe(true);
  });

  it("an empty bundle is a bundle-level error that blocks removals", () => {
    const r = run({});
    expect(r.blockRemovals).toBe(true);
    expect(r.bundleIssues[0]!.code).toBe("SUSPICIOUS");
  });

  it("implausibly many components are quarantined", () => {
    const r = run({ components: Array.from({ length: MAX_COMPONENTS + 1 }, (_, i) => comp(`c-${i}`)) });
    expect(r.blockComponents).toBe(true);
    expect(r.entities.every((e) => e.validation === "invalid")).toBe(true);
  });

  it("rejects a bundle for another system", () => {
    const r = validateBundle({ systemSlug: "other", components: [comp("button")] }, { systemSlug: "sys" });
    expect(r.blockRemovals).toBe(true);
    expect(r.bundleIssues.some((i) => i.code === "CONTRACT")).toBe(true);
  });

  it("facts without evidence for a field are warned about", () => {
    const r = run({ components: [comp("button")], facts: { latestVersion: "1.0.0", philosophy: "x", evidence: [{ ...ev()[0], field: "latestVersion" }] } });
    const f = entity(r, "system-facts", "facts");
    expect(f.validation).toBe("warning");
    expect(f.issues.map((i) => i.path)).toEqual(["philosophy"]);
  });

  it("attaches adapter issues to entities and tokens", () => {
    const r = validateBundle(
      { systemSlug: "sys", components: [comp("button")], tokenSets: [tokenSet([tok("color.a", "#fff"), tok("color.b", "#000")])] },
      {
        systemSlug: "sys",
        adapterIssues: [
          { entityKind: "component", entityKey: "button", code: "CUSTOM", message: "adapter says no", severity: "error" },
          { entityKind: "token", entityKey: "base:color.b", code: "CUSTOM", message: "bad token", severity: "error" },
          { entityKind: "pattern", entityKey: "missing", code: "CUSTOM", message: "orphan", severity: "error" },
        ],
      },
    );
    expect(entity(r, "component", "button").validation).toBe("invalid");
    expect(entity(r, "token-set", "base").droppedTokens).toEqual(["color.b"]);
    expect(r.bundleIssues.find((i) => i.message.includes("orphan"))!.severity).toBe("warning");
  });

  it("content hashes ignore retrievedAt", () => {
    const a = run({ components: [comp("button")] });
    const b = run({ components: [comp("button", { evidence: [{ ...ev()[0], retrievedAt: "2030-01-01T00:00:00.000Z" }] })] });
    expect(entity(a, "component", "button").hash).toBe(entity(b, "component", "button").hash);
  });
});

describe("suspiciousName", () => {
  it.each(["Overview", "Get started", "Release notes", "Sign up for free!", "<b>Button</b>", "https://x.y"])("flags %s", (n) => {
    expect(suspiciousName(n)).not.toBeNull();
  });
  it.each(["Button", "Date Picker", "Combobox", "Navigation Rail", "Footer", "UI Shell Header"])("accepts %s", (n) => {
    expect(suspiciousName(n)).toBeNull();
  });
});
