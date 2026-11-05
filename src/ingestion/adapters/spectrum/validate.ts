/** Spectrum adapter-specific sanity checks (the engine additionally runs generic validation). */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { ADAPTER_ID, type SpectrumSystem } from "./constants";

const EXPECT: Record<SpectrumSystem, { components: string[]; minComponents: number; docsHost: RegExp; minPatterns: number }> = {
  "adobe-spectrum": { components: ["button", "text-field", "picker", "menu", "tabs", "checkbox", "switch"], minComponents: 60, docsHost: /^https:\/\/spectrum\.adobe\.com\/web\//, minPatterns: 5 },
  "react-spectrum": { components: ["button", "text-field", "picker", "menu", "dialog", "table-view", "tabs", "combo-box"], minComponents: 55, docsHost: /^https:\/\/react-spectrum\.adobe\.com\/[A-Z]/, minPatterns: 2 },
  "react-aria": { components: ["button", "combo-box", "select", "menu", "modal", "table", "tabs", "text-field"], minComponents: 40, docsHost: /^https:\/\/react-aria\.adobe\.com\/[A-Z]/, minPatterns: 2 },
};

export function validateSpectrumBundle(system: SpectrumSystem, bundle: NormalizedBundle, limit?: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: ValidationIssue) => issues.push(i);
  const exp = EXPECT[system];
  const slugs = new Map<string, number>();
  for (const c of bundle.components) {
    slugs.set(c.slug, (slugs.get(c.slug) ?? 0) + 1);
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
      if (e.code && !e.attribution) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_ATTRIBUTION", message: `example ${e.slug} has code without attribution`, severity: "error" });
    }
    if (c.docsUrl && !exp.docsHost.test(c.docsUrl)) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `docsUrl outside the expected docs site: ${c.docsUrl}`, severity: "warning" });
    if (c.description && c.description.length > 280) push({ entityKind: "component", entityKey: c.slug, code: "EXCERPT_TOO_LONG", message: `description ${c.description.length} chars`, severity: "warning" });
    if (c.sourceCodeUrl && !c.sourceCodeUrl.startsWith("https://github.com/adobe/")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `sourceCodeUrl outside github.com/adobe: ${c.sourceCodeUrl}`, severity: "warning" });
    for (const r of c.relationships) if (r.targetSlug && !bundle.components.some((x) => x.slug === r.targetSlug)) push({ entityKind: "component", entityKey: c.slug, code: "UNRESOLVED_LINK", message: `relationship target ${r.targetSlug} not in bundle`, severity: "warning" });
    if (system !== "adobe-spectrum" && !c.frameworks.some((f) => f.slug === "react")) push({ entityKind: "component", entityKey: c.slug, code: "FRAMEWORK_MISMATCH", message: "React implementation without react framework entry", severity: "error" });
  }
  for (const [s, n] of slugs) if (n > 1) push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `duplicate component slug (${n})`, severity: "error" });

  if (!limit) {
    for (const must of exp.components) if (!slugs.has(must)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `well-known component missing: ${must}`, severity: "error" });
    if (bundle.components.length < exp.minComponents) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (expected >= ${exp.minComponents})`, severity: "warning" });
    if (bundle.patterns.length < exp.minPatterns) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} patterns`, severity: "warning" });
    const withProps = bundle.components.filter((c) => c.properties.length).length;
    if (bundle.components.length && withProps / bundle.components.length < 0.6) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${withProps}/${bundle.components.length} components have properties`, severity: "warning" });
  }

  // Tokens (adobe-spectrum only).
  const setSlugs = new Set<string>();
  const allNames = new Set<string>();
  const namesBySet = new Map<string, Set<string>>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug", severity: "error" });
    setSlugs.add(s.slug);
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set", severity: "error" });
      names.add(t.name);
      allNames.add(t.name);
      if (t.rawValue === undefined || t.rawValue === null || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "error" });
      if (t.cssVar && !/^--spectrum-[a-z0-9-]+$/.test(t.cssVar)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "SUSPICIOUS", message: `unexpected cssVar ${t.cssVar}`, severity: "warning" });
    }
    namesBySet.set(s.slug, names);
  }
  if (system === "adobe-spectrum" && !limit) {
    for (const req of ["color-light", "color-dark", "scale-desktop", "scale-mobile", "layout"]) if (!setSlugs.has(req)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `token set missing: ${req}`, severity: "error" });
    const light = namesBySet.get("color-light");
    const dark = namesBySet.get("color-dark");
    if (light && light.size < 400) push({ entityKind: "token-set", entityKey: "color-light", code: "SUSPICIOUS", message: `${light.size} tokens (< 400)`, severity: "warning" });
    if (light && dark) {
      const onlyOne = [...light].filter((n) => !dark.has(n)).length + [...dark].filter((n) => !light.has(n)).length;
      if (onlyOne) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${onlyOne} color tokens exist in only one of light/dark`, severity: "warning" });
    }
    const desk = namesBySet.get("scale-desktop");
    const mob = namesBySet.get("scale-mobile");
    if (desk && mob && (desk.size !== mob.size || [...desk].some((n) => !mob.has(n)))) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: "desktop and mobile scale sets do not hold the same token names", severity: "warning" });
  }
  let unresolved = 0;
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!allNames.has(r)) unresolved++;
  if (unresolved) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unresolved} token references do not match a token in this bundle`, severity: "warning" });
  let unknownUsages = 0;
  for (const c of bundle.components) for (const u of c.tokenUsages) if (!allNames.has(u.tokenName)) unknownUsages++;
  if (unknownUsages && allNames.size) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unknownUsages} component token usages name tokens not in the bundle`, severity: "warning" });

  const pslugs = new Set<string>();
  for (const p of bundle.patterns) {
    if (pslugs.has(p.slug)) push({ entityKind: "pattern", entityKey: p.slug, code: "DUPLICATE", message: "duplicate pattern slug", severity: "error" });
    pslugs.add(p.slug);
  }
  if (bundle.facts && !bundle.facts.latestVersion) push({ entityKind: "system-facts", entityKey: "facts", code: "REQUIRED_FIELD", message: "latestVersion not resolved from npm", severity: "warning" });
  return issues;
}
