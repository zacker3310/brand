/**
 * GOV.UK adapter-specific sanity checks (the engine runs generic validation too).
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { ADAPTER_ID, GOVUK, frontendRepoUrl, type FrontendProfile } from "./constants";

const EXPECT: Record<FrontendProfile["id"], { components: string[]; minComponents: number; minPatterns: number; sets: string[]; tokens: string[] }> = {
  govuk: {
    components: ["button", "text-input", "radios", "checkboxes", "summary-list", "error-summary", "date-input"],
    minComponents: 30,
    minPatterns: 20,
    sets: ["colour-palette", "functional-colours", "spacing", "typography", "layout"],
    tokens: ["govuk-palette.blue.primary", "govuk-functional-colours.brand", "govuk-spacing-points.3", "govuk-breakpoints.tablet"],
  },
  nhs: {
    components: ["buttons", "text-input", "radios", "checkboxes", "summary-list", "error-summary", "date-input"],
    minComponents: 35,
    minPatterns: 10,
    sets: ["colour-palette", "applied-colours", "spacing", "typography", "layout"],
    tokens: ["nhsuk-colours.blue", "nhsuk-brand-colour", "nhsuk-spacing-points.3", "nhsuk-breakpoints.tablet"],
  },
};

/** Colour cross-check results recorded by normalize (functional colour default vs docs colour table). */
export const colourChecks = new WeakMap<NormalizedBundle, { name: string; source: string; docs: string }[]>();

export function validateGovuk(bundle: NormalizedBundle, opts: { limit?: number; profile?: FrontendProfile }): ValidationIssue[] {
  const P = opts.profile ?? GOVUK;
  const X = EXPECT[P.id];
  const docsOrigin = P.docs.origin;
  const repoUrl = frontendRepoUrl(P);
  const issues: ValidationIssue[] = [];
  const push = (i: ValidationIssue) => issues.push(i);
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
      if (e.code && !e.attribution) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_ATTRIBUTION", message: `example ${e.slug} has code without attribution`, severity: "error" });
    }
    if (c.docsUrl && !c.docsUrl.startsWith(`${docsOrigin}/`)) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `docsUrl outside ${docsOrigin}: ${c.docsUrl}`, severity: "warning" });
    if (c.sourceCodeUrl && !c.sourceCodeUrl.startsWith(`${repoUrl}/`)) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `sourceCodeUrl outside ${P.frontend.repo}: ${c.sourceCodeUrl}`, severity: "warning" });
    if (c.description && c.description.length > 280) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `description ${c.description.length} chars (> 280)`, severity: "warning" });
    if (!c.properties.length && c.frameworks.some((f) => f.slug === "nunjucks")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "Nunjucks macro without parsed options", severity: "warning" });
  }
  for (const [s, n] of slugs) if (n > 1) push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `duplicate component slug (${n})`, severity: "error" });

  const full = !opts.limit;
  if (full) {
    for (const must of X.components) {
      if (!slugs.has(must)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `well-known component missing: ${must}`, severity: "error" });
    }
    if (bundle.components.length < X.minComponents) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.components.length} components`, severity: "warning" });
    if (bundle.patterns.length < X.minPatterns) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} patterns`, severity: "warning" });
    const withProps = bundle.components.filter((c) => c.properties.length).length;
    if (withProps < bundle.components.length * 0.8) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${withProps}/${bundle.components.length} components have macro options`, severity: "warning" });
  }

  const setSlugs = new Set<string>();
  const tokenNames = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug", severity: "error" });
    setSlugs.add(s.slug);
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set", severity: "error" });
      names.add(t.name);
      tokenNames.add(t.name);
      if (t.rawValue === undefined || t.rawValue === null || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "error" });
      if (s.slug === "colour-palette" && typeof t.rawValue === "string" && !t.references.length && !/^#[0-9a-f]{6}$/i.test(t.rawValue))
        push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: `palette value is not a hex colour: ${t.rawValue}`, severity: "warning" });
    }
  }
  if (full) {
    for (const req of X.sets) {
      if (!setSlugs.has(req)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `token set missing: ${req}`, severity: "error" });
    }
    for (const t of X.tokens) {
      if (!tokenNames.has(t)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `well-known token missing: ${t}`, severity: "warning" });
    }
  }
  let unresolved = 0;
  const examples: string[] = [];
  for (const s of bundle.tokenSets)
    for (const t of s.tokens)
      for (const r of t.references)
        if (!tokenNames.has(r)) {
          unresolved++;
          if (examples.length < 5) examples.push(`${t.name} -> ${r}`);
        }
  if (unresolved) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unresolved} token references do not match a token in this bundle (${examples.join("; ")})`, severity: "warning" });
  let unknownUsages = 0;
  for (const c of bundle.components) for (const u of c.tokenUsages) if (!tokenNames.has(u.tokenName)) unknownUsages++;
  if (unknownUsages) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unknownUsages} component token usages name tokens not in the bundle`, severity: "warning" });
  for (const m of colourChecks.get(bundle) ?? [])
    push({ entityKind: "token-set", entityKey: "functional-colours", code: "SUSPICIOUS", message: `functional colour ${m.name}: govuk-frontend default ${m.source} differs from docs colour table ${m.docs}`, severity: "warning" });

  const pslugs = new Set<string>();
  for (const p of bundle.patterns) {
    if (pslugs.has(p.slug)) push({ entityKind: "pattern", entityKey: p.slug, code: "DUPLICATE", message: "duplicate pattern slug", severity: "error" });
    pslugs.add(p.slug);
    const missing = p.componentSlugs.filter((s) => !slugs.has(s));
    if (missing.length && full) push({ entityKind: "pattern", entityKey: p.slug, code: "UNRESOLVED_LINK", message: `links to components not in bundle: ${missing.join(", ")}`, severity: "warning" });
  }
  return issues;
}
