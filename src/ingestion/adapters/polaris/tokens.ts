/**
 * @shopify/polaris-tokens: CSS custom properties per theme (dist/css/styles.css) plus token
 * descriptions from the package's ESM metadata modules (dist/esm/src/themes/base/<group>.mjs),
 * read as text (object-literal `description` strings). Nothing is executed.
 *
 * styles.css holds the default theme in `:root,.p-theme-light` and partial overrides per theme class
 * (`.p-theme-<name>`, from createThemeClassName). Each theme set here is the cascade result for that
 * class: default declarations overridden by the theme's own (as @shopify/polaris-tokens `themes` does).
 */
import type { NormalizedToken, TokenCategory, TokenTier } from "@/lib/contracts";
import { parseCssCustomProperties } from "@/lib/tokens/css";
import { TOKEN_GROUPS } from "./constants";
import { collapse } from "./text";

export interface ThemeBlockDecl {
  name: string;
  cssVar: string | null;
  value: string;
  references: string[];
}

export interface ThemeBlock {
  selector: string;
  /** Polaris theme names the selector targets ("light" for `:root,.p-theme-light`). */
  themes: string[];
  isDefault: boolean;
  decls: ThemeBlockDecl[];
}

const PREFIX = "--p-";

/** Token name for a Polaris custom property ("--p-color-bg" -> "color-bg"); null for non-Polaris names. */
export const tokenNameFromVar = (v: string): string | null => (v.startsWith(PREFIX) ? v.slice(PREFIX.length) : null);

export function themesFromSelector(selector: string): { themes: string[]; isDefault: boolean } {
  const themes: string[] = [];
  let isDefault = false;
  for (const part of selector.split(",").map((s) => s.trim())) {
    if (part === ":root" || part === "html") isDefault = true;
    const m = /^\.p-theme-([a-z0-9-]+)$/.exec(part);
    if (m) themes.push(m[1]!);
  }
  return { themes, isDefault };
}

export function parseTokensCss(css: string): ThemeBlock[] {
  const decls = parseCssCustomProperties(css, { includeScoped: true });
  const blocks = new Map<string, ThemeBlock>();
  for (const d of decls) {
    if (d.media || d.conditions) continue;
    const sel = collapse(d.selector);
    const { themes, isDefault } = themesFromSelector(sel);
    if (!themes.length && !isDefault) continue;
    const name = tokenNameFromVar(d.name);
    if (!name) continue;
    let b = blocks.get(sel);
    if (!b) {
      b = { selector: sel, themes, isDefault, decls: [] };
      blocks.set(sel, b);
    }
    const refs = d.references.map((r) => tokenNameFromVar(r) ?? r);
    const existing = b.decls.findIndex((x) => x.name === name);
    const entry = { name, cssVar: d.name, value: d.value, references: [...new Set(refs)] };
    if (existing >= 0) b.decls[existing] = entry;
    else b.decls.push(entry);
  }
  // `color-scheme` is a Polaris color token emitted as a real CSS property, not a custom property.
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = collapse(m[1]!);
    const cs = /(?:^|;)\s*color-scheme\s*:\s*([a-z ]+?)\s*(?:;|$)/.exec(m[2]!);
    const b = blocks.get(sel);
    if (cs && b && !b.decls.some((x) => x.name === "color-scheme")) b.decls.unshift({ name: "color-scheme", cssVar: null, value: cs[1]!, references: [] });
  }
  return [...blocks.values()];
}

export interface ThemeTokenRow extends ThemeBlockDecl {
  /** Selector of the block whose declaration is in effect for the theme. */
  selector: string;
  inherited: boolean;
}

/** Cascade result for one theme: default block, then the theme's own override block. */
export function themeTokens(blocks: ThemeBlock[], theme: string): ThemeTokenRow[] {
  const byName = new Map<string, ThemeTokenRow>();
  const base = blocks.find((b) => b.isDefault);
  if (base) for (const d of base.decls) byName.set(d.name, { ...d, selector: base.selector, inherited: !base.themes.includes(theme) });
  for (const b of blocks) {
    if (b.isDefault || !b.themes.includes(theme)) continue;
    for (const d of b.decls) byName.set(d.name, { ...d, selector: b.selector, inherited: false });
  }
  return [...byName.values()];
}

/* ------------------------------ descriptions ------------------------------ */

/** `'color-bg': { value: gray[6], description: 'The default background color of the admin.' }` -> map. */
export function parseTokenDescriptions(js: string): Map<string, string> {
  const out = new Map<string, string>();
  const entry = /(['"])([a-z0-9-]+)\1\s*:\s*\{([^{}]*)\}/g;
  for (const m of js.matchAll(entry)) {
    const d = /\bdescription\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/.exec(m[3]!);
    if (!d) continue;
    const text = collapse(d[2]!.replace(/\\(['"\\])/g, "$1").replace(/\\n/g, " "));
    if (text) out.set(m[2]!, text);
  }
  return out;
}

/* ------------------------------ classification ---------------------------- */

const GROUP_CATEGORY: Record<string, TokenCategory> = {
  border: "shape",
  breakpoints: "layout",
  color: "color",
  font: "typography",
  height: "spacing",
  motion: "motion",
  shadow: "elevation",
  space: "spacing",
  text: "typography",
  width: "spacing",
  zIndex: "elevation",
};

export function tokenGroup(name: string): string | null {
  if (name === "color-scheme") return "color";
  for (const g of TOKEN_GROUPS) if (name.startsWith(g.prefix)) return g.group;
  return null;
}

/** "Specialty and component" tokens (named after a component in @shopify/polaris-tokens' type comments). */
const COMPONENT_TOKEN = /^(color-(avatar|backdrop|button|checkbox|input|nav|radio-button|scrollbar|tooltip|video-thumbnail)-|shadow-button|space-(button-group|card|table-cell)-)/;
const PRIMITIVE_TOKEN =
  /^(border-(radius|width)-|breakpoints-|font-(family|letter-spacing|line-height|size|weight)-|height-|width-|space-\d|motion-(duration|ease|linear|keyframes)|shadow-(\d|inset-|bevel-|border-)|z-index-)/;

export function tokenTier(name: string): TokenTier | null {
  if (name === "color-scheme") return null;
  if (COMPONENT_TOKEN.test(name)) return "component";
  if (PRIMITIVE_TOKEN.test(name)) return "primitive";
  if (/^(color|text)-/.test(name)) return "semantic";
  return null;
}

export function toPolarisToken(row: ThemeTokenRow, descriptions: Map<string, string>, file: string): NormalizedToken {
  const group = tokenGroup(row.name);
  return {
    name: row.name,
    path: [group ?? "other", row.name],
    cssVar: row.cssVar,
    type: null,
    category: row.name === "color-scheme" ? "other" : (group ? GROUP_CATEGORY[group] : undefined) ?? "other",
    tier: tokenTier(row.name),
    tierState: "inferred",
    rawValue: row.value,
    references: row.references,
    description: descriptions.get(row.name)?.slice(0, 600) ?? null,
    deprecated: false,
    location: `${file} ${row.selector}`,
  };
}
