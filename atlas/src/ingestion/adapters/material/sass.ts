/**
 * Static parsers for the Material token SCSS shipped in material-components/material-web.
 * Pure text processing: no Sass is evaluated and nothing fetched is executed.
 *
 * Two generated formats exist in material-web@2.x:
 *
 *  1. tokens/versions/latest/sass/_md-*.scss  ("sass_vars", generated from Google's M3 token database)
 *       /// md.sys.color.primary (Primary colors)
 *       ///
 *       /// Description text
 *       $primary: md-ref-palette.$primary40;
 *
 *  2. tokens/versions/v0_192/_md-*.scss  (Sass map functions, "Design system version: v0.192")
 *       @function values($deps: $_default, $exclude-hardcoded-values: false) {
 *         @return (
 *           'container-color': map.get($deps, 'md-sys-color', 'primary'),
 *           'container-height': if($exclude-hardcoded-values, null, 40px),
 *         );
 *       }
 *
 * plus material-web's own wrappers tokens/_md-*.scss which list `$supported-tokens` and create
 * `--md-<prefix>-<token>` CSS custom properties.
 */

/* ------------------------------ latest sass_vars ------------------------------ */

export interface SassRef {
  module: string; // "md-ref-palette"
  varName: string; // "primary40"
}

export interface LatestSassToken {
  varName: string;
  tokenName: string;
  group: string | null;
  description: string | null;
  deprecated: boolean;
  rawScss: string;
  refs: SassRef[];
  /** Generator emitted a placeholder ("Type X is not supported") instead of a value. */
  unsupported: boolean;
  line: number;
}

export interface LatestSassFile {
  designSystem: string | null;
  version: string | null;
  contextTags: Record<string, string>;
  uses: string[];
  tokens: LatestSassToken[];
  /** `$vars` without a `/// md.*` doc comment (not emitted as tokens). */
  undocumentedVars: number;
}

const DOC_HEAD_RE = /^\/\/\/ (md\.[A-Za-z0-9_.\-]+)(?: \((.*)\))?\s*$/;
const VAR_RE = /^\$([A-Za-z0-9_-]+):\s*(.*)$/;
const REF_RE = /([a-z][a-z0-9-]*)\.\$([A-Za-z0-9_-]+)/g;
const UNSUPPORTED_RE = /\/\*\s*Type "[^"]*" is not supported\.\s*\*\/\s*null/;

export function parseLatestSass(text: string): LatestSassFile {
  const lines = text.split(/\r?\n/);
  const out: LatestSassFile = { designSystem: null, version: null, contextTags: {}, uses: [], tokens: [], undocumentedVars: 0 };
  let inTags = false;
  let pending: { tokenName: string; group: string | null; desc: string[]; deprecated: boolean } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Header comments (only before first token).
    if (!out.tokens.length && line.startsWith("// ") && !line.startsWith("/// ")) {
      const ds = /^\/\/ Design system:\s*(.+)$/.exec(line);
      if (ds) out.designSystem = ds[1]!.trim();
      const v = /^\/\/ Version:\s*(.+)$/.exec(line);
      if (v) out.version = v[1]!.trim();
      if (/^\/\/ Configured context tags:/.test(line)) {
        inTags = true;
        continue;
      }
      const tag = /^\/\/\s{3}([\w-]+):\s*(.+)$/.exec(line);
      if (inTags && tag) out.contextTags[tag[1]!] = tag[2]!.trim();
      else inTags = false;
      continue;
    }
    const use = /^@use '([^']+)'/.exec(line);
    if (use) {
      out.uses.push(use[1]!);
      continue;
    }
    if (line.startsWith("///")) {
      const head = DOC_HEAD_RE.exec(line);
      if (head && !pending) {
        pending = { tokenName: head[1]!, group: head[2]?.trim() || null, desc: [], deprecated: false };
      } else if (pending) {
        const body = line.replace(/^\/\/\/\s?/, "");
        if (/^@deprecated\b/.test(body)) {
          pending.deprecated = true;
          const note = body.replace(/^@deprecated\s*/, "").trim();
          if (note) pending.desc.push(`Deprecated: ${note}`);
        } else if (body.trim()) pending.desc.push(body.trim());
      }
      continue;
    }
    const vm = VAR_RE.exec(line);
    if (vm) {
      let value = vm[2]!;
      // Values normally fit on one line; accumulate defensively until the terminating semicolon.
      while (!/;\s*$/.test(value) && i + 1 < lines.length) value += ` ${lines[++i]!.trim()}`;
      value = value.replace(/;\s*$/, "").replace(/\s*!default$/, "").trim();
      if (!pending) {
        out.undocumentedVars++;
        continue;
      }
      const unsupported = UNSUPPORTED_RE.test(value);
      out.tokens.push({
        varName: vm[1]!,
        tokenName: pending.tokenName,
        group: pending.group,
        description: pending.desc.length ? pending.desc.join(" ") : null,
        deprecated: pending.deprecated,
        rawScss: value,
        refs: unsupported ? [] : [...value.matchAll(REF_RE)].map((m) => ({ module: m[1]!, varName: m[2]! })),
        unsupported,
        line: i + 1,
      });
      pending = null;
      continue;
    }
    // Anything else (blank lines, mixins) ends a dangling doc block.
    if (line.trim() === "" || /^@mixin|^\s/.test(line)) {
      if (line.trim() !== "") pending = null;
    }
  }
  return out;
}

/** Index: scss module stem -> scss var name -> dotted token name. */
export type SassVarIndex = Map<string, Map<string, string>>;

export function addToIndex(index: SassVarIndex, moduleStem: string, file: LatestSassFile) {
  let m = index.get(moduleStem);
  if (!m) index.set(moduleStem, (m = new Map()));
  for (const t of file.tokens) m.set(t.varName, t.tokenName);
}

/**
 * Convert an authored SCSS value into an ATLAS raw value, preserving references in DTCG brace
 * form ("{md.ref.palette.primary40}"). References that cannot be mapped to a documented token
 * name are left as authored SCSS text and reported in `unresolved`.
 */
export function latestValueToRaw(t: LatestSassToken, index: SassVarIndex): { rawValue: unknown; references: string[]; unresolved: string[] } {
  const references: string[] = [];
  const unresolved: string[] = [];
  if (!t.refs.length) return { rawValue: literal(t.rawScss), references, unresolved };
  const raw = t.rawScss.replace(REF_RE, (whole, mod: string, v: string) => {
    const name = index.get(mod)?.get(v);
    if (!name) {
      unresolved.push(whole);
      return whole;
    }
    references.push(name);
    return `{${name}}`;
  });
  return { rawValue: raw, references: [...new Set(references)], unresolved };
}

/** Numbers stay numbers (as authored in SCSS); everything else stays the authored string. */
export function literal(s: string): string | number {
  const v = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/* --------------------------------- v0_192 maps --------------------------------- */

export interface V0192Entry {
  key: string;
  kind: "ref" | "literal" | "composite";
  module?: string;
  refKey?: string;
  literal?: string;
  line: number;
}

export interface V0192File {
  designSystemVersion: string | null;
  functions: Record<string, V0192Entry[]>;
}

export function parseV0192(text: string): V0192File {
  const lines = text.split(/\r?\n/);
  const ver = /Design system version:\s*(\S+)/.exec(text)?.[1] ?? null;
  const functions: Record<string, V0192Entry[]> = {};
  for (let i = 0; i < lines.length; i++) {
    const fn = /^@function ([\w-]+)\(/.exec(lines[i]!);
    if (!fn) continue;
    const entries: V0192Entry[] = [];
    // advance to "@return ("
    let j = i + 1;
    while (j < lines.length && !/^\s*@return \($/.test(lines[j]!)) {
      if (/^}/.test(lines[j]!)) break;
      j++;
    }
    if (j >= lines.length || !/^\s*@return \($/.test(lines[j]!)) continue;
    let cur: { key: string; value: string; line: number } | null = null;
    const flush = () => {
      if (!cur) return;
      entries.push(classifyV0192(cur.key, cur.value.replace(/,\s*$/, "").trim(), cur.line));
      cur = null;
    };
    for (j = j + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (/^\s{2}\);\s*$/.test(l) || /^}/.test(l)) break;
      const km = /^ {4}'([^']+)':\s*(.*)$/.exec(l);
      if (km) {
        flush();
        cur = { key: km[1]!, value: km[2]!, line: j + 1 };
      } else if (cur) cur.value += ` ${l.trim()}`;
    }
    flush();
    functions[fn[1]!] = entries;
    i = j;
  }
  return { designSystemVersion: ver, functions };
}

function classifyV0192(key: string, value: string, line: number): V0192Entry {
  const ref = /^map\.get\(\$deps,\s*'([^']+)',\s*'([^']+)'\)$/.exec(value);
  if (ref) return { key, kind: "ref", module: ref[1]!, refKey: ref[2]!, line };
  const hard = /^if\(\$exclude-hardcoded-values,\s*null,\s*(.+)\)$/.exec(value);
  if (hard) {
    const inner = hard[1]!.trim();
    if (!/map\.get|\$|\bif\(|\/\*/.test(inner) && balanced(inner)) return { key, kind: "literal", literal: unwrapList(inner), line };
    return { key, kind: "composite", line };
  }
  if (!/[$(]/.test(value) && value.length) return { key, kind: "literal", literal: value, line };
  return { key, kind: "composite", line };
}

/** Sass list literal "(Roboto)" / "(16px 16px 0px 0px)" -> its CSS value text. */
export function unwrapList(s: string): string {
  const m = /^\((.*)\)$/.exec(s.trim());
  return m && balanced(m[1]!) ? m[1]!.trim() : s.trim();
}

function balanced(s: string): boolean {
  let d = 0;
  for (const c of s) {
    if (c === "(") d++;
    else if (c === ")" && --d < 0) return false;
  }
  return d === 0;
}

/** "md-sys-color" -> "md.sys.color"; "md-comp-filled-button" -> "md.comp.filled-button". */
export function v0192ModulePrefix(moduleStem: string): string {
  const m = /^md-(ref|sys|comp)-(.+)$/.exec(moduleStem);
  return m ? `md.${m[1]}.${m[2]}` : moduleStem.replace(/^md-/, "md.");
}

/* ------------------------ material-web wrappers (supported) ------------------------ */

export interface SupportedTokensFile {
  supported: string[] | null;
  v0192Modules: string[];
  /** e.g. "md-sys-color" or "md-filled-button" (from `var(--<prefix>-#{$token}, ...)`). */
  customPropertyPrefix: string | null;
}

export function parseSupportedTokens(text: string): SupportedTokensFile {
  const block = /\$supported-tokens:\s*\(([\s\S]*?)\n\);/.exec(text)?.[1] ?? null;
  const supported = block ? [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!) : null;
  const v0192Modules = [...text.matchAll(/@use 'versions\/v0_192\/(md-[a-z0-9-]+)'/g)].map((m) => m[1]!);
  const prefix = /var\(\s*--(md-[a-z0-9-]+?)-#\{\$token\}/.exec(text)?.[1] ?? null;
  return { supported, v0192Modules, customPropertyPrefix: prefix };
}
