/**
 * Static reader for the TypeScript declaration files shipped in @shopify/polaris
 * (build/ts/src/**.d.ts). A small, bracket/string/comment-aware scanner extracts interfaces, type
 * aliases, imports and re-exports, then resolves a component's `<Name>Props` (interface `extends`,
 * intersections, unions of object types, Omit/Partial/Pick) across local modules through a loader.
 * Nothing is evaluated; external types (React.*, @shopify/polaris-tokens) are named, not expanded.
 */
import { collapse, literalUnion, splitUnion } from "./text";

export interface DtsMember {
  name: string;
  optional: boolean;
  type: string | null;
  description: string | null;
  defaultValue: string | null;
  deprecated: boolean;
  deprecationNote: string | null;
}

export interface DtsDecl {
  kind: "interface" | "type";
  name: string;
  exported: boolean;
  /** interface: heritage clauses; type: right-hand side text. */
  extends: string[];
  body: string;
  members: DtsMember[];
  jsdoc: string | null;
}

export interface DtsFile {
  decls: Map<string, DtsDecl>;
  /** local name -> { module, imported name } */
  imports: Map<string, { module: string; name: string }>;
  /** exported name -> { module, imported name } */
  reexports: Map<string, { module: string; name: string }>;
  starExports: string[];
}

/* -------------------------------------------------------------------------- */
/* Scanner                                                                     */
/* -------------------------------------------------------------------------- */

/** Index just past a string/comment starting at i, or -1. */
function skipNonCode(src: string, i: number): number {
  const c = src[i];
  const n = src[i + 1];
  if (c === "/" && n === "/") {
    const e = src.indexOf("\n", i);
    return e < 0 ? src.length : e;
  }
  if (c === "/" && n === "*") {
    const e = src.indexOf("*/", i + 2);
    return e < 0 ? src.length : e + 2;
  }
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) {
      if (src[j] === "\\") j++;
      j++;
    }
    return j + 1;
  }
  return -1;
}

/** Index of the bracket matching src[open] ("{", "(", "[", "<"), or -1. */
export function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]", "<": ">" };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const skip = skipNonCode(src, i);
    if (skip >= 0) {
      i = skip - 1;
      continue;
    }
    const c = src[i]!;
    if (c === "=" && src[i + 1] === ">") {
      i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]!);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    } else if (")]}".includes(c) && !stack.includes(c) && c !== ">") return -1;
  }
  return -1;
}

/** Split on a separator at bracket depth 0 (strings/comments respected). */
export function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const skip = skipNonCode(src, i);
    if (skip >= 0) {
      i = skip - 1;
      continue;
    }
    const c = src[i]!;
    if (c === "=" && src[i + 1] === ">") {
      i++;
      continue;
    }
    if ("{([<".includes(c)) depth++;
    else if ("})]>".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && src.startsWith(sep, i)) {
      out.push(src.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(src.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* JSDoc                                                                        */
/* -------------------------------------------------------------------------- */

interface JsDoc {
  description: string | null;
  defaultValue: string | null;
  deprecated: boolean;
  deprecationNote: string | null;
}

export function parseJsDoc(raw: string | null): JsDoc {
  if (!raw) return { description: null, defaultValue: null, deprecated: false, deprecationNote: null };
  const inner = raw
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n");
  const desc: string[] = [];
  let tag: string | null = null;
  const tags: Record<string, string[]> = {};
  for (const line of inner.split("\n")) {
    const m = /^\s*@(\w+)\s*(.*)$/.exec(line);
    if (m) {
      tag = m[1]!.toLowerCase();
      (tags[tag] ??= []).push(m[2]!);
      continue;
    }
    if (tag) tags[tag]!.push(line);
    else desc.push(line);
  }
  const t = (k: string) => (tags[k] ? collapse(tags[k]!.join(" ")) : null);
  return {
    description: collapse(desc.join(" ")) || null,
    defaultValue: t("default") || t("defaultvalue") || null,
    deprecated: "deprecated" in tags,
    deprecationNote: t("deprecated") || null,
  };
}

/* -------------------------------------------------------------------------- */
/* File parsing                                                                */
/* -------------------------------------------------------------------------- */

/** Members of an interface / object-literal body (between the braces). */
export function parseMembers(body: string): DtsMember[] {
  const out: DtsMember[] = [];
  let i = 0;
  let pendingDoc: string | null = null;
  while (i < body.length) {
    // whitespace / separators
    while (i < body.length && /[\s;,]/.test(body[i]!)) i++;
    if (i >= body.length) break;
    if (body.startsWith("/**", i)) {
      const e = body.indexOf("*/", i + 3);
      pendingDoc = body.slice(i, e < 0 ? body.length : e + 2);
      i = e < 0 ? body.length : e + 2;
      continue;
    }
    if (body.startsWith("//", i) || body.startsWith("/*", i)) {
      i = skipNonCode(body, i);
      continue;
    }
    // member: read until ';' (or newline-terminated) at depth 0
    let j = i;
    let depth = 0;
    for (; j < body.length; j++) {
      const skip = skipNonCode(body, j);
      if (skip >= 0) {
        j = skip - 1;
        continue;
      }
      const c = body[j]!;
      if (c === "=" && body[j + 1] === ">") {
        j++;
        continue;
      }
      if ("{([<".includes(c)) depth++;
      else if ("})]>".includes(c)) depth--;
      else if ((c === ";" || c === ",") && depth === 0) break;
    }
    const text = body.slice(i, j).trim();
    i = j + 1;
    const member = parseMember(text, pendingDoc);
    pendingDoc = null;
    if (member) out.push(member);
  }
  return out;
}

function parseMember(text: string, doc: string | null): DtsMember | null {
  if (!text || text.startsWith("[")) return null; // index signature
  const m = /^(?:readonly\s+)?(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))(\?)?\s*(\(|<|:)/.exec(text);
  if (!m) return null;
  const name = m[2] ?? m[3]!;
  const optional = !!m[4];
  let type: string | null;
  if (m[5] === ":") type = collapse(text.slice(m[0].length));
  else {
    // method signature: name(args): Ret  /  name<T>(args): Ret
    const start = m[0].length - 1;
    let k = start;
    if (text[k] === "<") k = matchBracket(text, k) + 1;
    const close = text[k] === "(" ? matchBracket(text, k) : -1;
    if (close < 0) return null;
    const args = text.slice(k, close + 1);
    const ret = text.slice(close + 1).replace(/^\s*:\s*/, "");
    type = collapse(`${args} => ${ret || "void"}`);
  }
  const jd = parseJsDoc(doc);
  return { name, optional, type: type || null, description: jd.description, defaultValue: jd.defaultValue, deprecated: jd.deprecated, deprecationNote: jd.deprecationNote };
}

export function parseDts(src: string): DtsFile {
  const file: DtsFile = { decls: new Map(), imports: new Map(), reexports: new Map(), starExports: [] };
  let i = 0;
  let lastDoc: string | null = null;
  while (i < src.length) {
    if (src.startsWith("/**", i)) {
      const e = src.indexOf("*/", i + 3);
      lastDoc = src.slice(i, e < 0 ? src.length : e + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    const skip = skipNonCode(src, i);
    if (skip >= 0) {
      i = skip;
      continue;
    }
    if (/\s/.test(src[i]!)) {
      i++;
      continue;
    }
    const rest = src.slice(i, i + 400);
    let m: RegExpExecArray | null;
    if ((m = /^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?/.exec(rest))) {
      for (const spec of m[1]!.split(",")) {
        const s = spec.trim().replace(/^type\s+/, "");
        if (!s) continue;
        const [orig, local] = s.split(/\s+as\s+/).map((x) => x.trim());
        file.imports.set(local ?? orig!, { module: m[3]!, name: orig! });
      }
      i += m[0].length;
      continue;
    }
    if ((m = /^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?/.exec(rest))) {
      for (const spec of m[1]!.split(",")) {
        const s = spec.trim().replace(/^type\s+/, "");
        if (!s) continue;
        const [orig, exported] = s.split(/\s+as\s+/).map((x) => x.trim());
        file.reexports.set(exported ?? orig!, { module: m[3]!, name: orig! });
      }
      i += m[0].length;
      continue;
    }
    if ((m = /^export\s+\*\s+from\s*(['"])([^'"]+)\1\s*;?/.exec(rest))) {
      file.starExports.push(m[2]!);
      i += m[0].length;
      continue;
    }
    if ((m = /^(export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)\s*/.exec(rest))) {
      let k = i + m[0].length;
      if (src[k] === "<") k = matchBracket(src, k) + 1;
      const brace = src.indexOf("{", k);
      const heritage = src.slice(k, brace).trim().replace(/^extends\s+/, "");
      const close = matchBracket(src, brace);
      if (brace < 0 || close < 0) break;
      const body = src.slice(brace + 1, close);
      file.decls.set(m[2]!, {
        kind: "interface",
        name: m[2]!,
        exported: !!m[1],
        extends: heritage ? splitTop(heritage, ",") : [],
        body,
        members: parseMembers(body),
        jsdoc: lastDoc,
      });
      lastDoc = null;
      i = close + 1;
      continue;
    }
    if ((m = /^(export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*/.exec(rest))) {
      let k = i + m[0].length;
      if (src[k] === "<") k = matchBracket(src, k) + 1;
      while (/\s/.test(src[k] ?? "")) k++;
      if (src[k] !== "=") {
        i = k;
        continue;
      }
      k++;
      // RHS ends at ';' at depth 0
      let j = k;
      let depth = 0;
      for (; j < src.length; j++) {
        const sk = skipNonCode(src, j);
        if (sk >= 0) {
          j = sk - 1;
          continue;
        }
        const c = src[j]!;
        if (c === "=" && src[j + 1] === ">") {
          j++;
          continue;
        }
        if ("{([<".includes(c)) depth++;
        else if ("})]>".includes(c)) depth--;
        else if (c === ";" && depth <= 0) break;
      }
      const rhs = src.slice(k, j).trim();
      file.decls.set(m[2]!, { kind: "type", name: m[2]!, exported: !!m[1], extends: [rhs], body: rhs, members: [], jsdoc: lastDoc });
      lastDoc = null;
      i = j + 1;
      continue;
    }
    // any other statement: skip to end of line / balanced braces
    const nl = src.indexOf("\n", i);
    const brace = src.indexOf("{", i);
    if (brace >= 0 && (nl < 0 || brace < nl)) {
      const close = matchBracket(src, brace);
      i = close < 0 ? src.length : close + 1;
    } else i = nl < 0 ? src.length : nl + 1;
    lastDoc = null;
  }
  return file;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                   */
/* -------------------------------------------------------------------------- */

/** Loader for package-relative paths ("build/ts/src/types.d.ts"); returns null when missing. */
export type DtsLoader = (path: string) => Promise<string | null>;

export interface ResolvedProp extends DtsMember {
  /** Declaration the member was found in ("BaseButton", "ButtonProps"). */
  from: string;
  /** Package-relative file of that declaration. */
  file: string;
}

export interface ResolvedProps {
  props: ResolvedProp[];
  /** Types not expanded (external or unresolvable), e.g. "React.AriaAttributes". */
  unresolved: string[];
  files: string[];
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function joinPath(base: string, rel: string): string {
  const parts = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export class DtsResolver {
  private cache = new Map<string, Promise<DtsFile | null>>();
  /** `exists` (optional) answers from a package file listing so missing candidates are never requested. */
  constructor(
    private load: DtsLoader,
    private exists?: (path: string) => boolean | undefined,
  ) {}

  file(path: string): Promise<DtsFile | null> {
    let p = this.cache.get(path);
    if (!p) {
      p = this.load(path).then((src) => (src === null ? null : parseDts(src)));
      this.cache.set(path, p);
    }
    return p;
  }

  /** Resolve a relative module specifier to a loaded file path (tries .d.ts then /index.d.ts). */
  private async moduleFile(fromFile: string, spec: string): Promise<string | null> {
    if (!spec.startsWith(".")) return null;
    const base = joinPath(dirname(fromFile), spec);
    for (const cand of [`${base}.d.ts`, `${base}/index.d.ts`]) {
      if (this.exists?.(cand) === false) continue;
      if (await this.file(cand)) return cand;
    }
    return null;
  }

  /** Find declaration `name` visible from `file` (local, imported, re-exported). */
  async findDecl(file: string, name: string, depth = 0): Promise<{ decl: DtsDecl; file: string } | null> {
    if (depth > 8) return null;
    const f = await this.file(file);
    if (!f) return null;
    const local = f.decls.get(name);
    if (local) return { decl: local, file };
    const imp = f.imports.get(name) ?? f.reexports.get(name);
    if (imp) {
      const target = await this.moduleFile(file, imp.module);
      return target ? this.findDecl(target, imp.name, depth + 1) : null;
    }
    for (const star of f.starExports) {
      const target = await this.moduleFile(file, star);
      if (!target) continue;
      const hit = await this.findDecl(target, name, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  /** Collect props of a type expression as seen from `file`. */
  async collect(file: string, typeText: string, out: ResolvedProps, seen = new Set<string>(), depth = 0, opts: { omit?: Set<string>; pick?: Set<string>; optional?: boolean; via?: string } = {}): Promise<void> {
    if (depth > 10) return;
    const t = typeText.trim().replace(/^\(([\s\S]*)\)$/, (m0, inner: string) => (matchBracket(typeText.trim(), 0) === typeText.trim().length - 1 ? inner : m0));
    const add = (members: DtsMember[], from: string, f: string) => {
      for (const mem of members) {
        if (opts.omit?.has(mem.name)) continue;
        if (opts.pick && !opts.pick.has(mem.name)) continue;
        if (out.props.some((p) => p.name === mem.name)) continue;
        out.props.push({ ...mem, optional: mem.optional || !!opts.optional, from, file: f });
      }
    };
    const inter = splitTop(t, "&");
    if (inter.length > 1) {
      for (const part of inter) await this.collect(file, part, out, seen, depth + 1, opts);
      return;
    }
    const union = splitTop(t, "|");
    if (union.length > 1) {
      // Union of object shapes: every member of every branch, optional (only valid in some branches).
      for (const part of union) await this.collect(file, part, out, seen, depth + 1, { ...opts, optional: true });
      return;
    }
    if (t.startsWith("{")) {
      const close = matchBracket(t, 0);
      add(parseMembers(t.slice(1, close < 0 ? t.length : close)), opts.via ?? "(inline)", file);
      return;
    }
    const gen = /^([A-Za-z_$][\w$.]*)\s*<([\s\S]*)>$/.exec(t);
    if (gen) {
      const args = splitTop(gen[2]!, ",");
      const keys = (s: string | undefined) => new Set(splitUnion(s ?? "").map((k) => k.replace(/^['"]|['"]$/g, "")));
      if (gen[1] === "Omit" && args[0]) return this.collect(file, args[0], out, seen, depth + 1, { ...opts, omit: new Set([...(opts.omit ?? []), ...keys(args[1])]) });
      if (gen[1] === "Pick" && args[0]) return this.collect(file, args[0], out, seen, depth + 1, { ...opts, pick: keys(args[1]) });
      if ((gen[1] === "Partial" || gen[1] === "Readonly") && args[0]) return this.collect(file, args[0], out, seen, depth + 1, { ...opts, optional: gen[1] === "Partial" ? true : opts.optional });
      // Other generics (e.g. React.HTMLAttributes<T>): resolve the base name if local, else note it.
      return this.collect(file, gen[1]!, out, seen, depth + 1, opts);
    }
    if (!/^[A-Za-z_$][\w$.]*$/.test(t)) {
      if (t) out.unresolved.push(collapse(t).slice(0, 80));
      return;
    }
    if (t.includes(".")) {
      out.unresolved.push(t);
      return;
    }
    const key = `${file}#${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    const hit = await this.findDecl(file, t);
    if (!hit) {
      out.unresolved.push(t);
      return;
    }
    if (!out.files.includes(hit.file)) out.files.push(hit.file);
    if (hit.decl.kind === "interface") {
      add(hit.decl.members, hit.decl.name, hit.file);
      for (const h of hit.decl.extends) await this.collect(hit.file, h, out, seen, depth + 1, { ...opts, via: hit.decl.name });
    } else {
      await this.collect(hit.file, hit.decl.body, out, seen, depth + 1, { ...opts, via: hit.decl.name });
    }
  }

  async props(file: string, propsName: string): Promise<ResolvedProps | null> {
    const hit = await this.findDecl(file, propsName);
    if (!hit) return null;
    const out: ResolvedProps = { props: [], unresolved: [], files: [] };
    await this.collect(file, propsName, out);
    out.unresolved = [...new Set(out.unresolved)].sort();
    return out;
  }

  /** Literal values of a member type, following local/imported type aliases (e.g. `size?: Size`). */
  async allowedValues(file: string, type: string | null, depth = 0): Promise<string[] | null> {
    if (!type || depth > 4) return null;
    const direct = literalUnion(type);
    if (direct) return direct;
    const parts = splitUnion(type);
    const vals: string[] = [];
    for (const p of parts) {
      const lit = /^(["'`])(.*)\1$/.exec(p);
      if (lit) {
        vals.push(lit[2]!);
        continue;
      }
      if (p === "undefined" || p === "null") continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(p)) return null;
      const hit = await this.findDecl(file, p);
      if (!hit || hit.decl.kind !== "type") return null;
      const sub = await this.allowedValues(hit.file, hit.decl.body, depth + 1);
      if (!sub) return null;
      vals.push(...sub);
    }
    return vals.length >= 2 ? [...new Set(vals)] : null;
  }
}
