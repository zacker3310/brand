/**
 * Token set exports (pure). Only offered when token_set.redistribution = 'permitted'; every export carries
 * attribution, license and retrieval metadata. Values are exported as stored by ATLAS: authored value plus
 * the resolved value where ATLAS could resolve it. Nothing is invented for unresolved references.
 */
import { isThemeDependentValue, type Redistribution } from "@/lib/contracts";
import { formatTokenValue } from "@/lib/tokens/format";

export interface ExportSetMeta {
  systemSlug: string;
  systemName: string;
  setSlug: string;
  setName: string;
  theme: string | null;
  format: string;
  sourceUrl: string;
  packageName: string | null;
  packageVersion: string | null;
  redistribution: Redistribution;
  license: { slug: string; name: string; spdxId: string | null; url: string | null } | null;
  retrievedAt: string | null;
}

export interface ExportToken {
  name: string;
  path: string[];
  cssVar: string | null;
  type: string | null;
  category: string;
  tier: string | null;
  tierState: string;
  rawValue: unknown;
  resolvedValue: unknown;
  valueText: string | null;
  aliasState: string | null;
  description: string | null;
  deprecated: boolean;
  location: string | null;
}

/** SPDX licenses link to their canonical SPDX page; others to the recorded license URL. */
export function licenseHref(l: { spdxId: string | null; url: string | null }): string | null {
  if (l.spdxId && /^[A-Za-z0-9.+-]+$/.test(l.spdxId)) return `https://spdx.org/licenses/${l.spdxId}.html`;
  return l.url;
}

export type ExportDecision = { allowed: true } | { allowed: false; reason: string };

const REASONS: Record<Exclude<Redistribution, "permitted">, string> = {
  conditional:
    "The license for this token set permits redistribution only under conditions ATLAS cannot verify on your behalf. Use the official source.",
  restricted: "The license for this token set does not permit redistribution. ATLAS links to the official source instead.",
  unknown: "ATLAS could not establish whether this token set may be redistributed, so it is not offered for download. Use the official source.",
};

export function exportDecision(redistribution: Redistribution | string | null | undefined): ExportDecision {
  if (redistribution === "permitted") return { allowed: true };
  const key = (redistribution === "conditional" || redistribution === "restricted" ? redistribution : "unknown") as Exclude<Redistribution, "permitted">;
  return { allowed: false, reason: REASONS[key] };
}

export const EXPORT_FORMATS = ["json", "css"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function exportFileName(meta: Pick<ExportSetMeta, "systemSlug" | "setSlug" | "packageVersion">, format: ExportFormat): string {
  const v = meta.packageVersion ? `-${meta.packageVersion.replace(/[^0-9A-Za-z.-]/g, "")}` : "";
  return `${meta.systemSlug}-${meta.setSlug}${v}.${format === "json" ? "tokens.json" : "css"}`;
}

function attributionLine(meta: ExportSetMeta): string {
  const pkg = meta.packageName ? `${meta.packageName}${meta.packageVersion ? `@${meta.packageVersion}` : ""}` : null;
  const lic = meta.license ? (meta.license.spdxId ?? meta.license.name) : "license not recorded";
  return `${meta.systemName} · ${meta.setName}${pkg ? ` · ${pkg}` : ""} · ${lic}`;
}

/** JSON export: metadata + flat token list as stored by ATLAS. */
export function buildExportJson(meta: ExportSetMeta, tokens: readonly ExportToken[], exportedAt: string): string {
  const doc = {
    $atlas: {
      note: "Exported by ATLAS from the official source. Values are as authored, with ATLAS alias resolution where resolvable. Verify against the source before use.",
      attribution: attributionLine(meta),
      system: { slug: meta.systemSlug, name: meta.systemName },
      set: { slug: meta.setSlug, name: meta.setName, theme: meta.theme, format: meta.format },
      source: meta.sourceUrl,
      package: meta.packageName ? { name: meta.packageName, version: meta.packageVersion } : null,
      license: meta.license,
      redistribution: meta.redistribution,
      retrievedAt: meta.retrievedAt,
      exportedAt,
      tokenCount: tokens.length,
    },
    tokens: tokens.map((t) => ({
      name: t.name,
      path: t.path,
      cssVar: t.cssVar,
      type: t.type,
      category: t.category,
      tier: t.tier,
      tierState: t.tierState,
      value: t.rawValue,
      resolvedValue: t.resolvedValue,
      aliasState: t.aliasState ?? "literal",
      description: t.description,
      deprecated: t.deprecated,
      location: t.location,
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const sanitizeComment = (s: string) => s.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ");

/** "--fgColor-default" kept; otherwise derived from the path ("fg-color.default" -> "--fgColor-default"). */
export function cssVarName(t: Pick<ExportToken, "cssVar" | "path" | "name">): string {
  const raw = t.cssVar && t.cssVar.startsWith("--") ? t.cssVar : `--${(t.path.length ? t.path : t.name.split(".")).join("-")}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "-");
}

/** CSS value for a token, or null (with a reason) when there is no static value to export. */
export function cssValueOf(t: ExportToken): { value: string } | { skip: string } {
  if (isThemeDependentValue(t.resolvedValue)) return { skip: "theme-dependent: value differs per themed set" };
  const state = t.aliasState ?? "literal";
  if (state === "unresolved" || state === "cycle" || state === "external") return { skip: `${state} reference ${typeof t.rawValue === "string" ? t.rawValue : ""}`.trim() };
  const v = t.resolvedValue ?? t.rawValue;
  if (v === null || v === undefined) return { skip: "no value" };
  const out = formatTokenValue(v, t.type ?? (t.category === "color" ? "color" : null), { maxLength: 2000 });
  if (!out) return { skip: "no value" };
  if (/^[[{]/.test(out.trim())) return { skip: "composite value without a CSS representation" };
  if (/[{};]|\*\//.test(out)) return { skip: "value is not valid as a CSS custom property" };
  return { value: out };
}

/** CSS export: custom properties on :root. Tokens without a static value are listed as comments. */
export function buildExportCss(meta: ExportSetMeta, tokens: readonly ExportToken[], exportedAt: string): string {
  const lines: string[] = [];
  lines.push("/*");
  lines.push(` * ${sanitizeComment(attributionLine(meta))}`);
  lines.push(` * Source: ${sanitizeComment(meta.sourceUrl)}`);
  const lic = meta.license ? licenseHref(meta.license) : null;
  if (lic) lines.push(` * License: ${sanitizeComment(lic)}`);
  if (meta.theme) lines.push(` * Theme: ${sanitizeComment(meta.theme)} (selector below is :root; scope it to your theme mechanism)`);
  lines.push(` * Retrieved: ${meta.retrievedAt ?? "unknown"} · Exported by ATLAS: ${exportedAt}`);
  lines.push(" * Values as authored, with ATLAS alias resolution where resolvable. Verify against the source before use.");
  lines.push(" */");
  lines.push(":root {");
  let skipped = 0;
  for (const t of tokens) {
    const name = cssVarName(t);
    const r = cssValueOf(t);
    if ("value" in r) lines.push(`  ${name}: ${r.value};${t.deprecated ? " /* deprecated */" : ""}`);
    else {
      skipped++;
      lines.push(`  /* ${name}: not exported (${sanitizeComment(r.skip)}) */`);
    }
  }
  lines.push("}");
  if (skipped) lines.push(`/* ${skipped} of ${tokens.length} tokens have no static CSS value and are listed as comments. */`);
  return `${lines.join("\n")}\n`;
}
