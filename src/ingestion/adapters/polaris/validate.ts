/** Polaris-specific sanity checks on a normalized bundle (the engine also runs generic validation). */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";

export interface PolarisValidateOptions {
  limit?: number;
}

const WC_DOCS = /^https:\/\/shopify\.dev\/docs\/api\/app-home\//;
const ARCHIVE = /^https:\/\/github\.com\/Shopify\/polaris-react-archive\//;

export function validatePolarisBundle(bundle: NormalizedBundle, opts: PolarisValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: Omit<ValidationIssue, "severity"> & { severity?: ValidationIssue["severity"] }) => issues.push({ severity: "warning", ...i });
  const web = bundle.components.filter((c) => c.frameworks.some((f) => f.slug === "web-components"));
  const react = bundle.components.filter((c) => c.frameworks.some((f) => f.slug === "react"));
  const slugs = new Set(bundle.components.map((c) => c.slug));

  if (!opts.limit) {
    if (web.length < 40) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${web.length} Polaris web components (manifest lists ~60)`, severity: "error" });
    if (react.length < 60) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${react.length} Polaris React components documented (archive has ~90)` });
    if (bundle.tokenSets.length !== 4) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `expected 4 Polaris token themes, got ${bundle.tokenSets.length}` });
    if (bundle.patterns.length < 10) push({ entityKind: "bundle", entityKey: bundle.systemSlug, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} App Home patterns` });
  }

  for (const c of bundle.components) {
    const isWeb = c.frameworks.some((f) => f.slug === "web-components");
    const isReact = c.frameworks.some((f) => f.slug === "react");
    if (isWeb === isReact) push({ entityKind: "component", entityKey: c.slug, code: "FRAMEWORK_MISMATCH", message: "component must belong to exactly one Polaris implementation (web components or React)" });
    if (c.examples.some((e) => e.code)) push({ entityKind: "component", entityKey: c.slug, code: "LICENSE", message: "code example stored although the Polaris license restricts redistribution", severity: "error" });
    if (isWeb) {
      if (c.slug.startsWith("react-")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "web component slug uses the React prefix", severity: "error" });
      if (c.docsUrl && !WC_DOCS.test(c.docsUrl)) push({ entityKind: "component", entityKey: c.slug, code: "INVALID_URL", message: `web component docsUrl not on shopify.dev App Home: ${c.docsUrl}` });
      if (!c.properties.length) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "web component without manifest properties, events or slots" });
      if (c.properties.some((p) => p.implementation !== "web-components")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "web component carries non web-components properties", severity: "error" });
      if (c.lifecycle === "deprecated") push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "web component marked deprecated without a source claim" });
    }
    if (isReact) {
      if (!c.slug.startsWith("react-")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "React component slug must use the react- prefix", severity: "error" });
      if (c.lifecycle !== "deprecated") push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `Polaris React component lifecycle is "${c.lifecycle}"; the package is deprecated on npm` });
      if (c.docsUrl && !ARCHIVE.test(c.docsUrl)) push({ entityKind: "component", entityKey: c.slug, code: "INVALID_URL", message: `React docsUrl should point at the archived docs source: ${c.docsUrl}` });
      if (c.properties.some((p) => p.implementation !== "react")) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: "React component carries non-React properties", severity: "error" });
    }
    if (c.description && c.description.length > 280) push({ entityKind: "component", entityKey: c.slug, code: "EXCERPT_TOO_LONG", message: `description is ${c.description.length} chars (max 280)` });
    for (const r of c.relationships) {
      if (r.targetSlug && !slugs.has(r.targetSlug) && !opts.limit) push({ entityKind: "component", entityKey: c.slug, code: "UNRESOLVED_LINK", message: `relationship ${r.kind} -> ${r.targetSlug} not in bundle` });
    }
    const names = new Set<string>();
    for (const p of c.properties) {
      const k = `${p.implementation}:${p.name}`;
      if (names.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate property ${k}`, severity: "error" });
      names.add(k);
    }
  }

  for (const s of bundle.tokenSets) {
    if (s.redistribution !== "restricted") push({ entityKind: "token-set", entityKey: s.slug, code: "LICENSE", message: "Polaris tokens must be marked redistribution restricted", severity: "error" });
    if (s.tokens.length < 300) push({ entityKind: "token-set", entityKey: s.slug, code: "SUSPICIOUS", message: `only ${s.tokens.length} tokens in theme set` });
    const names = new Set(s.tokens.map((t) => t.name));
    const dangling = s.tokens.filter((t) => t.references.some((r) => !names.has(r)));
    if (dangling.length) push({ entityKind: "token-set", entityKey: s.slug, code: "UNRESOLVED_LINK", message: `${dangling.length} tokens reference names outside the set (e.g. ${dangling[0]!.name} -> ${dangling[0]!.references.join(", ")})` });
  }

  for (const p of bundle.patterns) {
    if (!p.componentSlugs.length) push({ entityKind: "pattern", entityKey: p.slug, code: "SUSPICIOUS", message: "pattern lists no supported components" });
  }
  return issues;
}
