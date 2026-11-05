/** Adapter-specific sanity checks for antd bundles (the engine also runs generic validation). */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { ADAPTER_ID, PROFILES, SLUG_MOBILE } from "./constants";

interface Expectations {
  mustComponents: string[];
  minComponents: number;
  mustSets: string[];
  minTokens: Record<string, number>;
  minPatterns: number;
}

const EXPECT: Record<string, Expectations> = {
  "ant-design": {
    mustComponents: ["button", "select", "modal", "table", "form", "input", "tabs", "date-picker"],
    minComponents: 60,
    mustSets: ["seed-tokens", "map-tokens", "alias-tokens", "component-tokens"],
    minTokens: { "seed-tokens": 40, "map-tokens": 200, "alias-tokens": 60, "component-tokens": 400 },
    minPatterns: 10,
  },
  "ant-design-mobile": {
    mustComponents: ["button", "tabs", "picker", "dialog", "input", "toast"],
    minComponents: 60,
    mustSets: ["global", "theme-light", "theme-dark", "component-css-variables"],
    minTokens: { global: 5, "theme-light": 10, "theme-dark": 10, "component-css-variables": 100 },
    minPatterns: 0,
  },
};

export function validateAntdBundle(bundle: NormalizedBundle, opts: { systemSlug: string; limit?: number }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: ValidationIssue) => issues.push(i);
  const exp = EXPECT[opts.systemSlug];
  const profile = PROFILES[opts.systemSlug];
  const full = !opts.limit;

  const slugs = new Map<string, number>();
  for (const c of bundle.components) {
    slugs.set(c.slug, (slugs.get(c.slug) ?? 0) + 1);
    if (!c.name.trim()) push({ entityKind: "component", entityKey: c.slug, code: "REQUIRED_FIELD", message: "empty component name", severity: "error" });
    const props = new Set<string>();
    for (const p of c.properties) {
      const k = `${p.implementation}|${p.name}`;
      if (props.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate property ${k}`, severity: "error" });
      props.add(k);
    }
    const ex = new Set<string>();
    for (const e of c.examples) {
      if (ex.has(e.slug)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate example slug ${e.slug}`, severity: "error" });
      ex.add(e.slug);
      if (e.code && !e.attribution) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_ATTRIBUTION", message: `code example ${e.slug} without attribution`, severity: "error" });
    }
    const vs = new Set<string>();
    for (const v of c.variants) {
      const k = `${v.axis}|${v.name}`;
      if (vs.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate variant ${k}`, severity: "warning" });
      vs.add(k);
    }
    if (profile && c.docsUrl && !c.docsUrl.startsWith(`${profile.docsOrigin}/`))
      push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `docsUrl outside ${profile.docsOrigin}: ${c.docsUrl}`, severity: "warning" });
    if (profile && c.sourceCodeUrl && !c.sourceCodeUrl.startsWith(`https://github.com/${profile.repo.owner}/${profile.repo.name}/`))
      push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `sourceCodeUrl outside ${profile.repo.owner}/${profile.repo.name}: ${c.sourceCodeUrl}`, severity: "warning" });
    if (c.description && c.description.length > 280) push({ entityKind: "component", entityKey: c.slug, code: "EXCERPT_TOO_LONG", message: `description ${c.description.length} chars`, severity: "warning" });
    if (!c.properties.length) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "no properties extracted from the docs API tables", severity: "warning" });
  }
  for (const [s, n] of slugs) if (n > 1) push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `duplicate component slug (${n})`, severity: "error" });

  if (exp && full) {
    for (const m of exp.mustComponents) if (!slugs.has(m)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `well-known component missing: ${m}`, severity: "error" });
    if (bundle.components.length < exp.minComponents) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (expected >= ${exp.minComponents})`, severity: "warning" });
    if (bundle.patterns.length < exp.minPatterns) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} patterns (expected >= ${exp.minPatterns})`, severity: "warning" });
    const withProps = bundle.components.filter((c) => c.properties.length).length;
    if (bundle.components.length && withProps / bundle.components.length < 0.8)
      push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${withProps}/${bundle.components.length} components have properties`, severity: "warning" });
  }

  const setSlugs = new Set<string>();
  const tokenNames = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug", severity: "error" });
    setSlugs.add(s.slug);
    const min = exp?.minTokens[s.slug] ?? 1;
    if (full && s.tokens.length < min) push({ entityKind: "token-set", entityKey: s.slug, code: "SUSPICIOUS", message: `${s.tokens.length} tokens (< ${min})`, severity: "warning" });
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set", severity: "error" });
      names.add(t.name);
      tokenNames.add(t.name);
      if (t.rawValue === undefined || t.rawValue === null || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "error" });
    }
  }
  if (exp && full) for (const req of exp.mustSets) if (!setSlugs.has(req)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `token set missing: ${req}`, severity: "error" });

  let unresolved = 0;
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!tokenNames.has(r)) unresolved++;
  if (unresolved) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unresolved} token references do not name a token in this bundle`, severity: "warning" });
  let unknownUsages = 0;
  for (const c of bundle.components) for (const u of c.tokenUsages) if (!tokenNames.has(u.tokenName)) unknownUsages++;
  if (unknownUsages && tokenNames.size) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unknownUsages} component token usages name tokens not in the bundle`, severity: "warning" });

  const pslugs = new Set<string>();
  for (const p of bundle.patterns) {
    if (pslugs.has(p.slug)) push({ entityKind: "pattern", entityKey: p.slug, code: "DUPLICATE", message: "duplicate pattern slug", severity: "error" });
    pslugs.add(p.slug);
  }
  if (opts.systemSlug === SLUG_MOBILE && bundle.patterns.length) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: "patterns emitted for ant-design-mobile (no pattern docs expected)", severity: "warning" });
  if (!bundle.facts?.latestVersion) push({ entityKind: "system-facts", entityKey: "facts", code: "REQUIRED_FIELD", message: "latestVersion missing", severity: "warning" });
  return issues;
}
