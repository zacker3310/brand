/**
 * Adapter-specific sanity checks for mui / joy-ui / base-ui bundles (the engine also runs generic
 * contract validation). Errors are reserved for structural defects; plausibility checks are
 * warnings unless the bundle is clearly broken (e.g. a well-known component missing on a full run).
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { FRAMEWORKS } from "@/lib/taxonomy";

const FRAMEWORK_SLUGS = new Set(FRAMEWORKS.map((f) => f.slug));

const EXPECT: Record<string, { minComponents: number; mustHave: string[]; minTokens: number }> = {
  mui: { minComponents: 100, mustHave: ["button", "autocomplete", "dialog", "text-field"], minTokens: 250 },
  "joy-ui": { minComponents: 50, mustHave: ["button", "autocomplete", "modal", "input"], minTokens: 100 },
  "base-ui": { minComponents: 30, mustHave: ["button", "accordion", "dialog", "menu"], minTokens: 0 },
};

export function validateMuiBundle(system: string, bundle: NormalizedBundle, limit?: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: Omit<ValidationIssue, "severity"> & { severity?: ValidationIssue["severity"] }) => issues.push({ severity: "error", ...i });
  const slugs = new Set<string>();
  for (const c of bundle.components) {
    if (slugs.has(c.slug)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate component slug ${c.slug}` });
    slugs.add(c.slug);
    if (!c.name.trim()) push({ entityKind: "component", entityKey: c.slug, code: "REQUIRED_FIELD", message: "empty component name" });
    if (!c.evidence.length) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_EVIDENCE", message: "component without evidence" });
    if (c.description && c.description.length > 280) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `description is ${c.description.length} chars (> 280)`, severity: "warning" });
    for (const f of c.frameworks) if (!FRAMEWORK_SLUGS.has(f.slug)) push({ entityKind: "component", entityKey: c.slug, code: "FRAMEWORK_MISMATCH", message: `unknown framework ${f.slug}` });
    if (c.classification?.state === "verified" && !c.evidence.some((e) => e.field === "canonicalType")) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_EVIDENCE", message: "verified classification without canonicalType evidence", severity: "warning" });
    const props = new Set<string>();
    for (const p of c.properties) {
      const k = `${p.implementation}:${p.name}`;
      if (props.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate property ${k}`, severity: "warning" });
      props.add(k);
    }
    for (const r of c.relationships) if (r.targetSlug === c.slug) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "self relationship", severity: "warning" });
  }
  for (const c of bundle.components) for (const r of c.relationships) if (r.targetSlug && !slugs.has(r.targetSlug)) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `relationship target ${r.targetSlug} not in bundle`, severity: "warning" });

  const exp = EXPECT[system];
  if (exp && !limit) {
    if (bundle.components.length < exp.minComponents) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (expected >= ${exp.minComponents})` });
    for (const s of exp.mustHave) if (!slugs.has(s)) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `well-known component ${s} missing` });
    const withProps = bundle.components.filter((c) => c.properties.length).length;
    if (bundle.components.length && withProps / bundle.components.length < 0.8) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${withProps}/${bundle.components.length} components have properties`, severity: "warning" });
  }
  let total = 0;
  const setSlugs = new Set<string>();
  const names = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug" });
    setSlugs.add(s.slug);
    const inSet = new Set<string>();
    for (const t of s.tokens) {
      if (inSet.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set" });
      inSet.add(t.name);
      names.add(t.name);
      if (t.rawValue === null || t.rawValue === undefined || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value" });
    }
    total += s.tokens.length;
  }
  if (exp && !limit && total < exp.minTokens) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${total} tokens (expected >= ${exp.minTokens})`, severity: "warning" });
  let dangling = 0;
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!names.has(r)) dangling++;
  if (dangling) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `${dangling} token references do not resolve inside the bundle`, severity: "warning" });
  if (system === "base-ui" && bundle.tokenSets.length) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: "Base UI is unstyled; unexpected token sets", severity: "warning" });
  if (!bundle.facts?.latestVersion) push({ entityKind: "system-facts", entityKey: "facts", code: "REQUIRED_FIELD", message: "latestVersion missing", severity: "warning" });
  return issues;
}
