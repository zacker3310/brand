/**
 * Generic validation of adapter output, run for every adapter before anything is promoted.
 *
 * Produces one ValidatedEntity per (kind, key) with issues. Severity semantics:
 *   - entity-level `error`       -> extraction 'invalid' (quarantined, not promoted)
 *   - CONFLICT                   -> extraction 'conflict' (quarantined, not promoted)
 *   - `warning` only             -> extraction 'warning' (promoted)
 *   - token-level `error`        -> that token is dropped from the promoted set; the set is 'warning'
 *   - bundle-level `error`       -> blocks retirement/deletion (and, for TOO_MANY_COMPONENTS, component promotion)
 */
import { z } from "zod";
import {
  NormalizedComponent,
  NormalizedPattern,
  NormalizedSystemFacts,
  NormalizedTokenSet,
  type ValidationIssue,
} from "@/lib/contracts";
import { COMPONENT_TYPES, FRAMEWORKS, PATTERN_TYPES } from "@/lib/taxonomy";
import { contentHash } from "./hash";
import { validateTokenValue } from "./tokens";

export type EntityKind = "component" | "token-set" | "pattern" | "system-facts";
export type ExtractionValidation = "valid" | "warning" | "invalid" | "conflict";

export interface ValidatedEntity {
  kind: EntityKind;
  key: string;
  /** Parsed (contract-valid) payload, or raw adapter output when parsing failed. */
  payload: Record<string, unknown>;
  parsed: boolean;
  issues: ValidationIssue[];
  /** Token names dropped from a token set (invalid value / conflicting duplicate). */
  droppedTokens?: string[];
  validation: ExtractionValidation;
  hash: string;
}

export interface BundleValidation {
  entities: ValidatedEntity[];
  bundleIssues: ValidationIssue[];
  /** Bundle-level errors present: never retire/delete records based on this bundle. */
  blockRemovals: boolean;
  /** Components must not be promoted (e.g. implausibly many). */
  blockComponents: boolean;
}

export const MAX_COMPONENTS = 800;
const MAX_DESCRIPTION_CHARS = 400;

const COMPONENT_TYPE_SLUGS = new Set(COMPONENT_TYPES.map((c) => c.slug));
const PATTERN_TYPE_SLUGS = new Set(PATTERN_TYPES.map((p) => p.slug));
const FRAMEWORK_SLUGS = new Set(FRAMEWORKS.map((f) => f.slug));

/** Site-navigation / marketing strings that are never component names. */
const NAV_TEXT =
  /^(overview|introduction|intro|getting started|get started|start here|home|homepage|blog|pricing|plans|about|about us|contact|contact us|changelog|change log|release notes|releases|whats new|what's new|faq|faqs|docs|documentation|support|help center|community|careers|jobs|privacy|privacy policy|terms|terms of use|terms of service|cookies|cookie policy|cookie settings|resources|showcase|contributing|contribute|roadmap|news|sponsor|sponsors|team|license|all components|components|component overview|foundations|patterns|guidelines|design tokens|tokens|usage|examples|playground|best practices|principles|templates|sign up|sign up for free|try it free|try for free|follow us|github|twitter|discord|slack|toggle navigation|edit this page|search docs|search documentation)$/i;

/** Navigation-like phrases that are also legitimate component names in some systems: warn, never quarantine. */
const NAV_TEXT_AMBIGUOUS = /^(learn more|read more|see more|view all|show more|download|downloads|table of contents|on this page|previous|next|skip to main content|subscribe)$/i;

export function suspiciousName(name: string): { severity: "error" | "warning"; reason: string } | null {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return { severity: "error", reason: "empty name" };
  if (/<[a-z][^>]*>/i.test(n)) return { severity: "error", reason: "name contains HTML markup" };
  if (/https?:\/\/|www\./i.test(n)) return { severity: "error", reason: "name contains a URL" };
  const bare = n.replace(/[.!?:→›»]+$/u, "").trim();
  if (NAV_TEXT.test(bare)) return { severity: "error", reason: "name looks like site navigation or marketing text" };
  if (NAV_TEXT_AMBIGUOUS.test(bare)) return { severity: "warning", reason: "name resembles navigation text (also a real component name in some systems)" };
  if (/[©®™]|[!?]$|→|›|»/u.test(n)) return { severity: "warning", reason: "name contains marketing/navigation punctuation" };
  const words = n.split(" ").length;
  if (words > 6 || n.length > 60) return { severity: "warning", reason: "name is unusually long for a component" };
  return null;
}

const isHttpUrl = (u: unknown): boolean => {
  if (typeof u !== "string") return false;
  try {
    const p = new URL(u);
    return (p.protocol === "https:" || p.protocol === "http:") && !!p.hostname;
  } catch {
    return false;
  }
};

function zodIssues(kind: ValidationIssue["entityKind"], key: string, err: z.ZodError): ValidationIssue[] {
  return err.issues.slice(0, 25).map((i) => ({
    entityKind: kind,
    entityKey: key,
    code: i.code === "invalid_type" && /received undefined/.test(i.message) ? "REQUIRED_FIELD" : i.code === "invalid_format" ? "INVALID_URL" : "CONTRACT",
    message: i.message,
    path: i.path.join("."),
    severity: "error" as const,
  }));
}

function urlIssues(kind: ValidationIssue["entityKind"], key: string, urls: [string, unknown][]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const [path, u] of urls) {
    if (u === null || u === undefined) continue;
    if (!isHttpUrl(u)) out.push({ entityKind: kind, entityKey: key, code: "INVALID_URL", message: `not an http(s) URL: ${String(u).slice(0, 120)}`, path, severity: "error" });
  }
  return out;
}

const evidenceUrls = (ev: { sourceUrl: string }[] | undefined): [string, unknown][] => (ev ?? []).map((e, i) => [`evidence.${i}.sourceUrl`, e.sourceUrl]);

function computeValidation(issues: ValidationIssue[]): ExtractionValidation {
  const own = issues.filter((i) => i.entityKind !== "token");
  if (own.some((i) => i.code === "CONFLICT")) return "conflict";
  if (own.some((i) => i.severity === "error")) return "invalid";
  return issues.length ? "warning" : "valid";
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v as unknown });
const keyOf = (v: unknown, i: number) => {
  const s = (v as { slug?: unknown })?.slug;
  return typeof s === "string" && s ? s : `#${i}`;
};

interface Parsed<T> {
  key: string;
  raw: unknown;
  ok: boolean;
  data?: T;
  issues: ValidationIssue[];
}

function parseList<T>(schema: z.ZodType<T>, kind: ValidationIssue["entityKind"], list: unknown): Parsed<T>[] {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((raw, i) => {
    const key = keyOf(raw, i);
    const r = schema.safeParse(raw);
    return r.success ? { key, raw, ok: true, data: r.data, issues: [] } : { key, raw, ok: false, issues: zodIssues(kind, key, r.error) };
  });
}

/** Group parsed entities by key; identical duplicates collapse with a warning, differing ones conflict. */
function dedupe<T>(kind: EntityKind, items: Parsed<T>[]): ValidatedEntity[] {
  const groups = new Map<string, Parsed<T>[]>();
  for (const it of items) {
    const g = groups.get(it.key) ?? [];
    g.push(it);
    groups.set(it.key, g);
  }
  const issueKind = kind as ValidationIssue["entityKind"];
  const out: ValidatedEntity[] = [];
  for (const [key, g] of groups) {
    const first = g[0]!;
    if (g.length === 1) {
      const payload = first.ok ? (first.data as Record<string, unknown>) : asRecord(first.raw);
      out.push({ kind, key, payload, parsed: first.ok, issues: [...first.issues], validation: "valid", hash: contentHash(payload) });
      continue;
    }
    const parsed = g.filter((x) => x.ok);
    const hashes = new Set(g.map((x) => contentHash(x.ok ? x.data : x.raw)));
    if (hashes.size === 1 && first.ok) {
      const payload = first.data as Record<string, unknown>;
      out.push({
        kind,
        key,
        payload,
        parsed: true,
        issues: [{ entityKind: issueKind, entityKey: key, code: "DUPLICATE", message: `${g.length} identical ${kind} entries with key "${key}" collapsed`, severity: "warning" }],
        validation: "valid",
        hash: contentHash(payload),
      });
      continue;
    }
    const candidates = g.map((x) => (x.ok ? x.data : x.raw));
    const payload = { conflict: true, key, candidates } as Record<string, unknown>;
    out.push({
      kind,
      key,
      payload,
      parsed: parsed.length === g.length,
      issues: [
        {
          entityKind: issueKind,
          entityKey: key,
          code: "CONFLICT",
          message: `${g.length} different ${kind} entries share key "${key}"; none promoted until resolved`,
          severity: "error",
        },
        ...g.flatMap((x) => x.issues),
      ],
      validation: "conflict",
      hash: contentHash(payload),
    });
  }
  return out;
}

function componentChecks(e: ValidatedEntity): void {
  if (!e.parsed || e.validation === "conflict") return;
  const c = e.payload as unknown as NormalizedComponent;
  const k = e.key;
  const push = (code: string, message: string, severity: "error" | "warning", path?: string) => e.issues.push({ entityKind: "component", entityKey: k, code, message, severity, path });
  if (!c.name.trim()) push("REQUIRED_FIELD", "name is blank", "error", "name");
  const sus = suspiciousName(c.name);
  if (sus) push("SUSPICIOUS", `${sus.reason}: "${c.name.slice(0, 80)}"`, sus.severity, "name");
  e.issues.push(
    ...urlIssues("component", k, [
      ["docsUrl", c.docsUrl],
      ["sourceCodeUrl", c.sourceCodeUrl],
      ["accessibility.docsUrl", c.accessibility?.docsUrl],
      ...c.variants.map((v, i): [string, unknown] => [`variants.${i}.sourceUrl`, v.sourceUrl]),
      ...c.states.map((v, i): [string, unknown] => [`states.${i}.sourceUrl`, v.sourceUrl]),
      ...c.properties.map((v, i): [string, unknown] => [`properties.${i}.sourceUrl`, v.sourceUrl]),
      ...c.examples.map((v, i): [string, unknown] => [`examples.${i}.url`, v.url]),
      ...c.frameworks.map((v, i): [string, unknown] => [`frameworks.${i}.sourceUrl`, v.sourceUrl]),
      ...evidenceUrls(c.evidence),
    ]),
  );
  if (c.canonicalType && !COMPONENT_TYPE_SLUGS.has(c.canonicalType)) push("UNKNOWN_TYPE", `canonicalType "${c.canonicalType}" is not in the ATLAS taxonomy; classification falls back to heuristics`, "warning", "canonicalType");
  c.frameworks.forEach((f, i) => {
    if (!FRAMEWORK_SLUGS.has(f.slug)) push("FRAMEWORK_MISMATCH", `framework "${f.slug}" is not a known framework slug; link skipped`, "warning", `frameworks.${i}.slug`);
  });
  if (c.description && c.description.length > MAX_DESCRIPTION_CHARS) push("EXCERPT_TOO_LONG", `description is ${c.description.length} chars; store a first sentence or paraphrase`, "warning", "description");
  c.examples.forEach((ex, i) => {
    if (ex.code && !ex.attribution) push("MISSING_ATTRIBUTION", `example "${ex.slug}" stores code without attribution`, "warning", `examples.${i}`);
  });
  const evFields = new Set(c.evidence.map((x) => x.field));
  if (!evFields.has("*")) {
    for (const [field, state] of Object.entries(c.coverage)) {
      if (state === "documented" && !evFields.has(field)) push("MISSING_EVIDENCE", `coverage marks "${field}" documented but no evidence covers it`, "warning", `coverage.${field}`);
    }
  }
}

/** Components sharing a keyboard table with at least this many others are flagged (audit deep-2 R3). */
const DUPLICATE_KEYBOARD_MIN = 3;

/**
 * Docs sites sometimes serve one component's accessibility fragment for others (spectrum.adobe.com
 * served Button's for 12 components). Byte-identical multi-row keyboard tables across
 * DUPLICATE_KEYBOARD_MIN+ components are flagged so the copy is reviewed instead of published silently.
 */
function duplicateKeyboardChecks(components: ValidatedEntity[]): void {
  const groups = new Map<string, ValidatedEntity[]>();
  for (const e of components) {
    if (!e.parsed || e.validation === "conflict") continue;
    const kb = (e.payload as unknown as NormalizedComponent).accessibility?.keyboard;
    if (!kb || kb.length < 2) continue;
    const sig = JSON.stringify(kb.map((k) => [k.keys.trim().toLowerCase(), k.action.trim().toLowerCase()]));
    const g = groups.get(sig);
    if (g) g.push(e);
    else groups.set(sig, [e]);
  }
  for (const g of groups.values()) {
    if (g.length < DUPLICATE_KEYBOARD_MIN) continue;
    const names = g.map((e) => e.key);
    for (const e of g)
      e.issues.push({
        entityKind: "component",
        entityKey: e.key,
        code: "DUPLICATE_KEYBOARD",
        message: `keyboard table is identical across ${g.length} components (${names.slice(0, 5).join(", ")}${g.length > 5 ? ", …" : ""}); check it is not a copied fragment`,
        severity: "warning",
        path: "accessibility.keyboard",
      });
  }
}

function tokenSetChecks(e: ValidatedEntity): void {
  if (!e.parsed || e.validation === "conflict") return;
  const s = e.payload as unknown as NormalizedTokenSet;
  const k = e.key;
  e.issues.push(...urlIssues("token-set", k, [["sourceUrl", s.sourceUrl], ["license.url", s.license?.url], ...evidenceUrls(s.evidence)]));
  const byName = new Map<string, NormalizedTokenSet["tokens"]>();
  for (const t of s.tokens) {
    const g = byName.get(t.name) ?? [];
    g.push(t);
    byName.set(t.name, g);
  }
  const dropped = new Set<string>();
  for (const [name, g] of byName) {
    if (g.length > 1) {
      const hashes = new Set(g.map((t) => contentHash(t)));
      if (hashes.size > 1) {
        dropped.add(name);
        e.issues.push({ entityKind: "token", entityKey: `${k}:${name}`, code: "CONFLICT", message: `${g.length} different definitions of token "${name}" in set; token not promoted`, severity: "error" });
        continue;
      }
      e.issues.push({ entityKind: "token", entityKey: `${k}:${name}`, code: "DUPLICATE", message: `${g.length} identical definitions of token "${name}" collapsed`, severity: "warning" });
    }
    const t = g[0]!;
    if (!t.references.length) {
      const check = validateTokenValue(t.rawValue, t.type);
      if (!check.valid) {
        dropped.add(name);
        e.issues.push({ entityKind: "token", entityKey: `${k}:${name}`, code: "INVALID_TOKEN_VALUE", message: `${t.type ?? "untyped"} token "${name}": ${check.message ?? "invalid value"}`, severity: "error" });
      }
    }
  }
  if (!s.tokens.length) e.issues.push({ entityKind: "token-set", entityKey: k, code: "SUSPICIOUS", message: "token set has no tokens", severity: "warning" });
  else if (dropped.size === byName.size) e.issues.push({ entityKind: "token-set", entityKey: k, code: "INVALID_TOKEN_VALUE", message: "every token in the set is invalid", severity: "error" });
  if (dropped.size) e.droppedTokens = [...dropped].sort();
}

function patternChecks(e: ValidatedEntity, componentSlugs: Set<string>): void {
  if (!e.parsed || e.validation === "conflict") return;
  const p = e.payload as unknown as NormalizedPattern;
  const k = e.key;
  const sus = suspiciousName(p.name);
  // Pattern titles are naturally sentence-length ("There is a problem with the service pages"): skip the length rule.
  if (sus && sus.reason !== "name looks like site navigation or marketing text" && !sus.reason.startsWith("name is unusually long")) e.issues.push({ entityKind: "pattern", entityKey: k, code: "SUSPICIOUS", message: `${sus.reason}: "${p.name.slice(0, 80)}"`, severity: sus.severity, path: "name" });
  e.issues.push(...urlIssues("pattern", k, [["docsUrl", p.docsUrl], ...evidenceUrls(p.evidence)]));
  if (p.canonicalType && !PATTERN_TYPE_SLUGS.has(p.canonicalType)) e.issues.push({ entityKind: "pattern", entityKey: k, code: "UNKNOWN_TYPE", message: `canonicalType "${p.canonicalType}" is not an ATLAS pattern type`, severity: "warning", path: "canonicalType" });
  const missing = p.componentSlugs.filter((s) => !componentSlugs.has(s));
  if (missing.length) e.issues.push({ entityKind: "pattern", entityKey: k, code: "UNRESOLVED_LINK", message: `component slugs not in this bundle: ${missing.slice(0, 10).join(", ")}`, severity: "warning", path: "componentSlugs" });
}

function factsChecks(e: ValidatedEntity): void {
  if (!e.parsed) return;
  const f = e.payload as unknown as NormalizedSystemFacts;
  const fields = new Set(f.evidence.map((x) => x.field));
  const has = (field: string) => fields.has(field) || fields.has("*");
  const push = (code: string, message: string, severity: "error" | "warning", path?: string) => e.issues.push({ entityKind: "system-facts", entityKey: e.key, code, message, severity, path });
  for (const field of ["latestVersion", "latestReleaseAt", "philosophy", "principles", "frameworks"] as const) {
    const v = f[field];
    if (v !== null && v !== undefined && !has(field)) push("MISSING_EVIDENCE", `${field} provided without evidence; not applied`, "warning", field);
  }
  e.issues.push(...urlIssues("system-facts", e.key, [...(f.principles ?? []).map((p, i): [string, unknown] => [`principles.${i}.sourceUrl`, p.sourceUrl]), ...evidenceUrls(f.evidence)]));
  (f.frameworks ?? []).forEach((fw, i) => {
    if (!FRAMEWORK_SLUGS.has(fw.slug)) push("FRAMEWORK_MISMATCH", `framework "${fw.slug}" is not a known framework slug`, "warning", `frameworks.${i}.slug`);
  });
}

/** Attach adapter-reported issues to entities (unknown keys become bundle-level issues). */
function attachAdapterIssues(entities: ValidatedEntity[], bundleIssues: ValidationIssue[], adapterIssues: ValidationIssue[]) {
  const index = new Map(entities.map((e) => [`${e.kind}|${e.key}`, e]));
  for (const issue of adapterIssues) {
    const kind = issue.entityKind === "token" ? "token-set" : issue.entityKind;
    let target = index.get(`${kind}|${issue.entityKey}`);
    if (!target && issue.entityKind === "token") {
      const m = /^([a-z0-9-]+)[:/](.+)$/.exec(issue.entityKey);
      if (m) {
        target = index.get(`token-set|${m[1]}`);
        if (target && issue.severity === "error") target.droppedTokens = [...new Set([...(target.droppedTokens ?? []), m[2]!])].sort();
      }
    }
    if (!target && issue.entityKind === "system-facts") target = index.get("system-facts|facts");
    const tagged = { ...issue, code: issue.code, message: `[adapter] ${issue.message}` };
    if (target) target.issues.push(tagged);
    else bundleIssues.push({ ...tagged, severity: issue.entityKind === "bundle" ? issue.severity : "warning" });
  }
}

export interface ValidateOptions {
  systemSlug: string;
  adapterIssues?: ValidationIssue[];
}

/** Validate a raw bundle (adapter.normalize output). Never throws on bad data. */
export function validateBundle(raw: unknown, opts: ValidateOptions): BundleValidation {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bundleIssues: ValidationIssue[] = [];
  if (!raw || typeof raw !== "object") bundleIssues.push({ entityKind: "bundle", entityKey: opts.systemSlug, code: "CONTRACT", message: "adapter returned no bundle object", severity: "error" });
  else if (b.systemSlug !== opts.systemSlug)
    bundleIssues.push({ entityKind: "bundle", entityKey: opts.systemSlug, code: "CONTRACT", message: `bundle systemSlug "${String(b.systemSlug)}" does not match "${opts.systemSlug}"`, severity: "error" });

  const components = dedupe("component", parseList(NormalizedComponent, "component", b.components));
  const tokenSets = dedupe("token-set", parseList(NormalizedTokenSet, "token-set", b.tokenSets));
  const patterns = dedupe("pattern", parseList(NormalizedPattern, "pattern", b.patterns));
  const entities: ValidatedEntity[] = [...components, ...tokenSets, ...patterns];
  if (b.facts !== null && b.facts !== undefined) {
    const r = NormalizedSystemFacts.safeParse(b.facts);
    const payload = r.success ? (r.data as Record<string, unknown>) : asRecord(b.facts);
    entities.push({ kind: "system-facts", key: "facts", payload, parsed: r.success, issues: r.success ? [] : zodIssues("system-facts", "facts", r.error), validation: "valid", hash: contentHash(payload) });
  }

  const componentSlugs = new Set(components.map((c) => c.key));
  for (const e of entities) {
    if (e.kind === "component") componentChecks(e);
    else if (e.kind === "token-set") tokenSetChecks(e);
    else if (e.kind === "pattern") patternChecks(e, componentSlugs);
    else factsChecks(e);
  }
  duplicateKeyboardChecks(components);
  attachAdapterIssues(entities, bundleIssues, opts.adapterIssues ?? []);

  const tokenCount = tokenSets.reduce((n, s) => n + (s.parsed && Array.isArray(s.payload.tokens) ? (s.payload.tokens as unknown[]).length : 0), 0);
  if (components.length === 0 && tokenCount === 0)
    bundleIssues.push({ entityKind: "bundle", entityKey: opts.systemSlug, code: "SUSPICIOUS", message: "bundle has 0 components and 0 tokens", severity: "error" });
  let blockComponents = false;
  if (components.length > MAX_COMPONENTS) {
    blockComponents = true;
    bundleIssues.push({ entityKind: "bundle", entityKey: opts.systemSlug, code: "SUSPICIOUS", message: `${components.length} components exceeds plausibility limit ${MAX_COMPONENTS}; components quarantined`, severity: "error" });
    for (const c of components) c.issues.push({ entityKind: "component", entityKey: c.key, code: "SUSPICIOUS", message: "quarantined: bundle has implausibly many components", severity: "error" });
  }
  const suspicious = components.filter((c) => c.issues.some((i) => i.code === "SUSPICIOUS" && i.path === "name")).length;
  if (components.length >= 10 && suspicious / components.length > 0.3)
    bundleIssues.push({ entityKind: "bundle", entityKey: opts.systemSlug, code: "SUSPICIOUS", message: `${suspicious}/${components.length} component names look like navigation/marketing text`, severity: "warning" });

  for (const e of entities) e.validation = computeValidation(e.issues);
  return { entities, bundleIssues, blockRemovals: bundleIssues.some((i) => i.severity === "error"), blockComponents };
}
