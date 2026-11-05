/**
 * Static parsing of govuk-frontend implementation files: Nunjucks templates (literal ARIA roles),
 * component JavaScript modules (roles set via setAttribute, keyboard handlers in `switch (event.key)`),
 * govuk-prototype-kit.config.json (Nunjucks macro names) and dist/govuk/all.mjs (JS components).
 * Fetched code is only read as text; it is never executed.
 */

export interface TemplateInfo {
  /** Literal role attribute values (dynamic `role="{{ x }}"` values are ignored). */
  roles: string[];
  /** aria-* attribute names used in the template. */
  ariaAttributes: string[];
  /** Other component macros the template imports (`govuk/components/<name>/macro.njk` or "../<name>/macro.njk"). */
  imports: string[];
}

export function parseTemplate(text: string): TemplateInfo {
  const roles = new Set<string>();
  for (const m of text.matchAll(/\brole=(["'])([a-z][a-z ]*)\1/g)) for (const r of m[2]!.split(/\s+/)) if (r) roles.add(r);
  const aria = new Set<string>();
  for (const m of text.matchAll(/\b(aria-[a-z]+)=/g)) aria.add(m[1]!);
  const imports = new Set<string>();
  for (const m of text.matchAll(/\{%-?\s*from\s+["']([^"']+)["']\s+import\b/g)) {
    const p = /(?:^|\/)components\/([a-z0-9-]+)\/macro\.njk$|^\.\.\/([a-z0-9-]+)\/macro\.njk$/.exec(m[1]!);
    const name = p?.[1] ?? p?.[2];
    if (name) imports.add(name);
  }
  return { roles: [...roles].sort(), ariaAttributes: [...aria].sort(), imports: [...imports].sort() };
}

export interface JsKeyHandler {
  keys: string[];
  /** Method called for the key(s), e.g. "activateNextTab". */
  method: string;
}

export interface JsInfo {
  roles: string[];
  ariaAttributes: string[];
  keyHandlers: JsKeyHandler[];
  moduleName: string | null;
}

const KEY_ALIASES: Record<string, string> = { Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown", Esc: "Escape", " ": "Space", Spacebar: "Space" };

/** Parse a component ES module: setAttribute('role', 'x'), aria-* attributes, `case 'ArrowLeft':` handlers. */
export function parseComponentJs(text: string): JsInfo {
  const roles = new Set<string>();
  for (const m of text.matchAll(/setAttribute\(\s*['"]role['"]\s*,\s*['"]([a-z]+)['"]\s*\)/g)) roles.add(m[1]!);
  const aria = new Set<string>();
  for (const m of text.matchAll(/setAttribute\(\s*['"](aria-[a-z]+)['"]/g)) aria.add(m[1]!);
  const keyHandlers: JsKeyHandler[] = [];
  for (const sw of text.matchAll(/switch\s*\(\s*event\.key\s*\)\s*\{/g)) {
    const open = sw.index! + sw[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length && i < open + 20_000; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    // Groups of consecutive case labels followed by a statement block until `break`.
    for (const grp of body.matchAll(/((?:\s*case\s+['"][^'"]+['"]\s*:)+)([\s\S]*?)\bbreak\s*;/g)) {
      const keys = [...grp[1]!.matchAll(/case\s+['"]([^'"]+)['"]/g)].map((k) => KEY_ALIASES[k[1]!] ?? k[1]!);
      const method = /this\.([a-zA-Z]+)\(/.exec(grp[2]!)?.[1];
      if (!method || !keys.length) continue;
      const uniq = [...new Set(keys)];
      if (!keyHandlers.some((h) => h.method === method)) keyHandlers.push({ keys: uniq, method });
    }
  }
  const moduleName = /static\s+moduleName\s*=\s*['"]([a-z-]+)['"]/.exec(text)?.[1] ?? null;
  return { roles: [...roles].sort(), ariaAttributes: [...aria].sort(), keyHandlers, moduleName };
}

/** "activatePreviousTab" -> "Activate previous tab" (ATLAS paraphrase of the handler name). */
export function humanizeMethod(method: string): string {
  const words = method.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** govuk-prototype-kit.config.json -> { "button": "govukButton", ... } from nunjucksMacros[].importFrom. */
export function parsePrototypeKitConfig(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const j = JSON.parse(text) as { nunjucksMacros?: { importFrom?: unknown; macroName?: unknown }[] };
    for (const m of j.nunjucksMacros ?? []) {
      if (typeof m.importFrom !== "string" || typeof m.macroName !== "string") continue;
      const c = /components\/([a-z0-9-]+)\/macro\.njk$/.exec(m.importFrom);
      if (c) out[c[1]!] = m.macroName;
    }
  } catch {
    /* not JSON */
  }
  return out;
}

/** dist/govuk/all.mjs -> component folders that ship a JavaScript module, with the exported class name. */
export function parseAllMjs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/export\s*\{\s*([A-Za-z]+)\s*\}\s*from\s*['"]\.\/components\/([a-z0-9-]+)\/[a-z0-9-]+\.mjs['"]/g)) out[m[2]!] = m[1]!;
  return out;
}

/** macro.njk -> macro name (`{% macro button(params) %}` -> "button"). */
export function parseMacroNjk(text: string): string | null {
  return /\{%-?\s*macro\s+([A-Za-z_][\w]*)\s*\(/.exec(text)?.[1] ?? null;
}
