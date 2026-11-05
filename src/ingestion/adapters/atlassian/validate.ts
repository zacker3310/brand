/** Atlassian-specific sanity checks (the engine runs generic contract validation separately). */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { TOKEN_SETS } from "./constants";

export interface ValidateOptions {
  limit?: number;
}

export function validateAtlassianBundle(bundle: NormalizedBundle, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const full = !opts.limit;
  const push = (i: ValidationIssue) => issues.push(i);
  const componentSlugs = new Set(bundle.components.map((c) => c.slug));

  /* ------------------------------- components ------------------------------- */
  const slugCount = new Map<string, number>();
  for (const c of bundle.components) {
    slugCount.set(c.slug, (slugCount.get(c.slug) ?? 0) + 1);
    if (!c.name.trim()) push({ entityKind: "component", entityKey: c.slug, code: "REQUIRED_FIELD", message: "empty component name", severity: "error" });
    if (c.docsUrl && !c.docsUrl.startsWith("https://atlassian.design/components/")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `docsUrl outside atlassian.design/components: ${c.docsUrl}`, severity: "warning" });
    if (c.examples.some((e) => e.code)) push({ entityKind: "component", entityKey: c.slug, code: "LICENSE", message: "code example stored although the ADS license forbids redistribution", severity: "error" });
    if (c.description && c.description.length > 280) push({ entityKind: "component", entityKey: c.slug, code: "EXCERPT_TOO_LONG", message: `description ${c.description.length} chars (> 280)`, severity: "warning" });
    const keys = new Map<string, number>();
    for (const p of c.properties) keys.set(`${p.implementation}|${p.name}`, (keys.get(`${p.implementation}|${p.name}`) ?? 0) + 1);
    for (const [k, n] of keys) if (n > 1) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `property ${k} listed ${n} times`, severity: "warning" });
    for (const r of c.relationships) {
      if (r.targetSlug && !componentSlugs.has(r.targetSlug)) push({ entityKind: "component", entityKey: c.slug, code: "UNRESOLVED_LINK", message: `relationship target ${r.targetSlug} not in bundle`, severity: "warning" });
    }
    if (c.classification?.state === "verified" && !c.classification.method.includes("apg-link")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "verified classification without an explicit APG pattern link", severity: "warning" });
    for (const f of c.frameworks) if (f.slug !== "react") push({ entityKind: "component", entityKey: c.slug, code: "FRAMEWORK_MISMATCH", message: `unexpected framework ${f.slug} for an @atlaskit React package`, severity: "warning" });
  }
  for (const [s, n] of slugCount) if (n > 1) push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `component slug used ${n} times`, severity: "error" });

  if (full) {
    const button = bundle.components.find((c) => c.slug === "button");
    if (!button) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: "well-known component Button missing", severity: "error" });
    else {
      if (!button.variants.some((v) => v.axis === "appearance" && v.name === "primary")) push({ entityKind: "component", entityKey: "button", code: "SUSPICIOUS", message: "Button has no appearance=primary variant", severity: "warning" });
      if (!button.properties.some((p) => p.name === "isDisabled")) push({ entityKind: "component", entityKey: "button", code: "SUSPICIOUS", message: "Button props table lacks isDisabled", severity: "warning" });
    }
    for (const slug of ["dropdown-menu", "modal-dialog", "select", "tabs", "tooltip", "text-field"]) {
      if (!componentSlugs.has(slug)) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `well-known component ${slug} missing`, severity: "warning" });
    }
    if (bundle.components.length < 60) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (expected 60+)`, severity: "warning" });
    const withProps = bundle.components.filter((c) => c.properties.length).length;
    if (withProps < bundle.components.length * 0.6) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${withProps}/${bundle.components.length} components have props (code tab parse may be broken)`, severity: "warning" });
    const withDesc = bundle.components.filter((c) => c.description).length;
    if (withDesc < bundle.components.length * 0.8) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${withDesc}/${bundle.components.length} components have descriptions`, severity: "warning" });
  }

  /* --------------------------------- tokens --------------------------------- */
  const allNames = new Set(bundle.tokenSets.flatMap((s) => s.tokens.map((t) => t.name)));
  const setSlugs = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug", severity: "error" });
    setSlugs.add(s.slug);
    if (s.redistribution !== "restricted") push({ entityKind: "token-set", entityKey: s.slug, code: "LICENSE", message: "ADS token sets must be redistribution 'restricted'", severity: "error" });
    const names = new Set<string>();
    let unresolved = 0;
    for (const t of s.tokens) {
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set", severity: "error" });
      names.add(t.name);
      if (t.rawValue === undefined || t.rawValue === null || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "error" });
      for (const r of t.references) if (!allNames.has(r)) unresolved++;
    }
    if (unresolved) push({ entityKind: "token-set", entityKey: s.slug, code: "UNRESOLVED_LINK", message: `${unresolved} references to tokens not in the bundle`, severity: "warning" });
    const spec = TOKEN_SETS.find((x) => x.slug === s.slug);
    if (spec?.kind === "theme") {
      const withVar = s.tokens.filter((t) => t.cssVar).length;
      if (withVar < s.tokens.length * 0.9) push({ entityKind: "token-set", entityKey: s.slug, code: "SUSPICIOUS", message: `only ${withVar}/${s.tokens.length} tokens have a CSS variable`, severity: "warning" });
    }
  }
  for (const spec of TOKEN_SETS) {
    if (!setSlugs.has(spec.slug)) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `token set ${spec.slug} missing (${spec.file})`, severity: "warning" });
  }
  const light = bundle.tokenSets.find((s) => s.slug === "theme-light");
  const dark = bundle.tokenSets.find((s) => s.slug === "theme-dark");
  if (light && dark) {
    const ln = new Set(light.tokens.map((t) => t.name));
    const onlyDark = dark.tokens.filter((t) => !ln.has(t.name)).length;
    if (onlyDark) push({ entityKind: "token-set", entityKey: "theme-dark", code: "SUSPICIOUS", message: `${onlyDark} dark tokens have no light counterpart`, severity: "warning" });
    if (light.tokens.length < 300) push({ entityKind: "token-set", entityKey: "theme-light", code: "SUSPICIOUS", message: `only ${light.tokens.length} light theme tokens`, severity: "warning" });
  }

  /* -------------------------------- patterns -------------------------------- */
  const patternSlugs = new Set<string>();
  for (const p of bundle.patterns) {
    if (patternSlugs.has(p.slug)) push({ entityKind: "pattern", entityKey: p.slug, code: "DUPLICATE", message: "duplicate pattern slug", severity: "error" });
    patternSlugs.add(p.slug);
    if (!p.docsUrl?.startsWith("https://atlassian.design/")) push({ entityKind: "pattern", entityKey: p.slug, code: "SUSPICIOUS", message: "pattern docsUrl outside atlassian.design", severity: "warning" });
  }
  return issues;
}
