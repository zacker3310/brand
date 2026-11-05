/** Primer-specific sanity checks (the engine runs generic contract validation separately). */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";

export interface ValidateOptions {
  limit?: number;
}

export function validatePrimerBundle(bundle: NormalizedBundle, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const full = !opts.limit;
  const push = (i: ValidationIssue) => issues.push(i);

  // Components
  const slugs = new Map<string, number>();
  for (const c of bundle.components) {
    slugs.set(c.slug, (slugs.get(c.slug) ?? 0) + 1);
    if (!c.name.trim()) push({ entityKind: "component", entityKey: c.slug, code: "REQUIRED_FIELD", message: "empty component name", severity: "error" });
    if (!c.evidence.length) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_EVIDENCE", message: "component has no evidence", severity: "error" });
    const propNames = new Map<string, number>();
    for (const p of c.properties) propNames.set(`${p.implementation}|${p.name}`, (propNames.get(`${p.implementation}|${p.name}`) ?? 0) + 1);
    for (const [k, n] of propNames) if (n > 1) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `property ${k} listed ${n} times`, severity: "warning" });
    for (const r of c.relationships) {
      if (r.targetSlug && !bundle.components.some((x) => x.slug === r.targetSlug)) push({ entityKind: "component", entityKey: c.slug, code: "CONFLICT", message: `relationship target ${r.targetSlug} not in bundle`, severity: "error" });
    }
    if (c.classification?.state === "verified" && !c.classification.method.includes("apg-link")) {
      push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "verified classification without explicit source naming", severity: "warning" });
    }
  }
  for (const [s, n] of slugs) if (n > 1) push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `component slug used ${n} times`, severity: "error" });

  if (full) {
    const button = bundle.components.find((c) => c.slug === "button");
    if (!button) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: "well-known component Button missing", severity: "error" });
    else {
      if (!button.variants.some((v) => v.name === "primary")) push({ entityKind: "component", entityKey: "button", code: "SUSPICIOUS", message: "Button has no 'primary' variant", severity: "warning" });
      if (!button.properties.length) push({ entityKind: "component", entityKey: "button", code: "SUSPICIOUS", message: "Button has no properties", severity: "warning" });
    }
    for (const name of ["ActionMenu", "Dialog", "TextInput", "TreeView"]) {
      if (!bundle.components.some((c) => c.name === name)) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `well-known component ${name} missing`, severity: "warning" });
    }
    if (bundle.components.length < 50) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (expected 50+)`, severity: "warning" });
    const withDocs = bundle.components.filter((c) => c.docsUrl).length;
    if (withDocs < 40) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${withDocs} components matched to primer.style docs pages`, severity: "warning" });
  }

  // Tokens
  const setSlugs = new Set<string>();
  let total = 0;
  const allNames = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug", severity: "error" });
    setSlugs.add(s.slug);
    total += s.tokens.length;
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (!t.name.trim()) push({ entityKind: "token", entityKey: `${s.slug}:?`, code: "REQUIRED_FIELD", message: "empty token name", severity: "error" });
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set", severity: "error" });
      names.add(t.name);
      allNames.add(t.name);
      if (t.rawValue === undefined || t.rawValue === null || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "error" });
    }
    if (!s.tokens.length) push({ entityKind: "token-set", entityKey: s.slug, code: "SUSPICIOUS", message: "token set is empty", severity: "warning" });
  }
  // Every alias should resolve to a token somewhere in the system (theme-aware resolution is the engine's job).
  const unresolved = new Set<string>();
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!allNames.has(r)) unresolved.add(r);
  if (unresolved.size) {
    push({
      entityKind: "bundle",
      entityKey: bundle.systemSlug,
      code: "SUSPICIOUS",
      message: `${unresolved.size} token references do not resolve within the bundle: ${[...unresolved].slice(0, 10).join(", ")}`,
      severity: "warning",
    });
  }
  if (full) {
    for (const theme of ["light", "dark"]) {
      const set = bundle.tokenSets.find((s) => s.theme === theme && s.slug.startsWith("primitives-theme-"));
      if (!set) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `functional ${theme} theme token set missing`, severity: "error" });
      else if (set.tokens.length < 300) push({ entityKind: "token-set", entityKey: set.slug, code: "SUSPICIOUS", message: `only ${set.tokens.length} tokens in ${theme} theme`, severity: "warning" });
    }
    if (total < 1000) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${total} tokens (expected 1000+)`, severity: "warning" });
    if (!allNames.has("fgColor.default") || !allNames.has("bgColor.default")) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: "core functional color tokens (fgColor.default/bgColor.default) missing", severity: "warning" });
  }

  // Patterns
  const pslugs = new Set<string>();
  for (const p of bundle.patterns) {
    if (pslugs.has(p.slug)) push({ entityKind: "pattern", entityKey: p.slug, code: "DUPLICATE", message: "duplicate pattern slug", severity: "error" });
    pslugs.add(p.slug);
    if (!p.name.trim()) push({ entityKind: "pattern", entityKey: p.slug, code: "REQUIRED_FIELD", message: "empty pattern name", severity: "error" });
  }
  if (full && bundle.patterns.length < 10) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} patterns`, severity: "warning" });

  // Facts
  if (!bundle.facts?.latestVersion) push({ entityKind: "system-facts", entityKey: bundle.systemSlug, code: "REQUIRED_FIELD", message: "latestVersion not resolved", severity: "warning" });
  if (bundle.facts?.philosophy && !bundle.facts.evidence.some((e) => e.field === "philosophy")) {
    push({ entityKind: "system-facts", entityKey: bundle.systemSlug, code: "MISSING_EVIDENCE", message: "philosophy without evidence", severity: "error" });
  }
  return issues;
}
