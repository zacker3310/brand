/**
 * Conservative static reader for TypeScript declaration files (api-extractor roll-ups such as
 * @fluentui/react-button/dist/index.d.ts and @fluentui/web-components/dist/web-components.d.ts).
 *
 * It never evaluates anything: it scans top-level declarations (type aliases, interfaces, classes,
 * consts, imports), keeps their TSDoc comments, and resolves *props* by structural rules that cover
 * the Fluent idioms (object literals, `&` intersections, `Pick` / `Omit` / `Partial` / `Required`,
 * `ComponentProps<Slots, 'primary'>`, local aliases, interface/class heritage). Anything it cannot
 * resolve locally (imported types, mapped/conditional types) is reported as unresolved, never guessed.
 */

/* ------------------------------------ TSDoc ------------------------------------ */

export interface JsDoc {
  /** Description text before the first block tag (inline {@link} reduced to its text). */
  summary: string;
  /** Block tags in order: "@default" -> ["'medium'"]. Values are trimmed, multi-line joined with "\n". */
  tags: Record<string, string[]>;
  /** Comment body without comment markers (inline links intact, for URL extraction). */
  raw: string;
}

const inlineLinks = (s: string) =>
  s
    .replace(/\{@link\s+([^}|]+?)\s*\|\s*([^}]+?)\s*\}/g, "$2")
    .replace(/\{@link\s+([^}]+?)\s*\}/g, (_, t: string) => t.replace(/^[^#]*#/, ""))
    .replace(/\{@(?:linkcode|linkplain|inheritDoc)\s*([^}]*)\}/g, "$1");

export function parseJsDoc(raw: string): JsDoc {
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^\/\*\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""));
  const summary: string[] = [];
  const tags: Record<string, string[]> = {};
  let cur: { tag: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    (tags[cur.tag] ??= []).push(cur.lines.join("\n").trim());
    cur = null;
  };
  let inFence = false;
  for (const line of body) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^\s*@([A-Za-z]+)\b\s?(.*)$/.exec(line) : null;
    if (m) {
      flush();
      cur = { tag: m[1]!, lines: [m[2] ?? ""] };
    } else if (cur) cur.lines.push(line);
    else summary.push(line);
  }
  flush();
  return { summary: inlineLinks(summary.join("\n")).replace(/[ \t]+\n/g, "\n").trim(), tags, raw: body.join("\n") };
}

export const docTag = (doc: JsDoc | null | undefined, tag: string): string | null => doc?.tags[tag]?.[0] ?? null;
export const hasTag = (doc: JsDoc | null | undefined, tag: string): boolean => !!doc && tag in doc.tags;

/* ------------------------------------ scanning ------------------------------------ */

export type DeclKind = "type" | "interface" | "class" | "const" | "function" | "enum";

export interface Decl {
  kind: DeclKind;
  name: string;
  exported: boolean;
  doc: JsDoc | null;
  /** type: right-hand side; const: declared type (after ':'); function: full signature text. */
  text: string;
  /** const initializer (`= "var(--x)"`), if any. */
  init: string | null;
  /** interface/class: body text between the braces. */
  body: string | null;
  /** interface/class heritage: extends targets (raw type text). */
  extends: string[];
  typeParams: string | null;
  /** 1-based line of the declaration keyword. */
  line: number;
}

export interface DtsFile {
  decls: Map<string, Decl[]>;
  /** local name -> { from: module specifier, imported: original export name } */
  imports: Map<string, { from: string; imported: string }>;
  /** `export { a as b }` aliases: exported name -> local name */
  exportAliases: Map<string, string>;
}

const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
const isId = (c: string) => /[A-Za-z0-9_$]/.test(c);

/** Index just past a string/template literal starting at `i` (quote char at src[i]). */
function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (q === "`" && c === "$" && src[j + 1] === "{") {
      j = matchClose(src, j + 1) + 1;
      continue;
    }
    if (c === q) return j + 1;
    j++;
  }
  return j;
}

/** Skip a comment at `i` if present; returns new index or -1. */
function skipComment(src: string, i: number): number {
  if (src[i] !== "/") return -1;
  if (src[i + 1] === "/") {
    const e = src.indexOf("\n", i);
    return e < 0 ? src.length : e + 1;
  }
  if (src[i + 1] === "*") {
    const e = src.indexOf("*/", i + 2);
    return e < 0 ? src.length : e + 2;
  }
  return -1;
}

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Index of the bracket closing the one at `open` (handles strings/comments; not angle brackets). */
export function matchClose(src: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i) - 1;
      continue;
    }
    const sc = skipComment(src, i);
    if (sc >= 0) {
      i = sc - 1;
      continue;
    }
    if (OPEN[c]) stack.push(OPEN[c]!);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/**
 * Index of the first occurrence of one of `stops` at bracket depth 0 (parens/brackets/braces, and
 * angle brackets when `angles`), skipping strings and comments. `=>` never closes an angle bracket.
 */
export function scanTo(src: string, start: number, stops: string[], angles = false): number {
  let depth = 0;
  let angle = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i) - 1;
      continue;
    }
    const sc = skipComment(src, i);
    if (sc >= 0) {
      i = sc - 1;
      continue;
    }
    if (depth === 0 && angle === 0 && stops.includes(c)) return i;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (angles && c === "<") angle++;
    else if (angles && c === ">" && src[i - 1] !== "=" && angle > 0) angle--;
    if (depth < 0) return i;
  }
  return -1;
}

/** Split at top-level separators (default "|"), respecting brackets, angle brackets and strings. */
export function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let angle = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    const sc = skipComment(text, i);
    if (sc >= 0) {
      i = sc - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "<") angle++;
    else if (c === ">" && text[i - 1] !== "=" && angle > 0) angle--;
    else if (depth === 0 && angle === 0 && text.startsWith(sep, i)) {
      // `=>` contains no separators we use; `&&`/`||` do not occur in type text.
      out.push(text.slice(last, i));
      last = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(last));
  return out.map((s) => s.trim()).filter((s, i, a) => s.length || (i > 0 && i < a.length - 1));
}

function readIdent(src: string, i: number): { name: string; end: number } | null {
  if (!isIdStart(src[i] ?? "")) return null;
  let j = i + 1;
  while (j < src.length && isId(src[j]!)) j++;
  return { name: src.slice(i, j), end: j };
}

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i]!)) i++;
  return i;
}

/** 1-based line lookup over precomputed newline offsets (binary search). */
function lineIndex(src: string): (i: number) => number {
  const nl: number[] = [];
  for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) nl.push(k);
  return (i: number) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid]! < i) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

/** Parse the top-level declarations of a .d.ts file. */
export function parseDts(input: string): DtsFile {
  const src = input.replace(/\r\n?/g, "\n");
  const decls = new Map<string, Decl[]>();
  const imports = new Map<string, { from: string; imported: string }>();
  const exportAliases = new Map<string, string>();
  const add = (d: Decl) => decls.set(d.name, [...(decls.get(d.name) ?? []), d]);
  let doc: JsDoc | null = null;
  let i = 0;
  const lineAt = lineIndex(src);
  while (i < src.length) {
    i = skipWs(src, i);
    if (i >= src.length) break;
    if (src.startsWith("/**", i) && !src.startsWith("/**/", i)) {
      const e = src.indexOf("*/", i + 3);
      const raw = src.slice(i, e < 0 ? src.length : e + 2);
      doc = parseJsDoc(raw);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    const sc = skipComment(src, i);
    if (sc >= 0) {
      i = sc;
      continue;
    }
    const stmtStart = i;
    let exported = false;
    // modifiers
    for (;;) {
      const id = readIdent(src, i);
      if (!id) break;
      if (id.name === "export") {
        exported = true;
        i = skipWs(src, id.end);
        continue;
      }
      if (id.name === "declare" || id.name === "default" || id.name === "abstract") {
        i = skipWs(src, id.end);
        continue;
      }
      break;
    }
    const kw = readIdent(src, i);
    if (src[i] === "{" && exported) {
      // export { a, b as c } [from '...'];
      const close = matchClose(src, i);
      const list = src.slice(i + 1, close < 0 ? src.length : close);
      for (const part of list.split(",")) {
        const m = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        if (m) exportAliases.set(m[2] ?? m[1]!, m[1]!);
      }
      const end = scanTo(src, close + 1, [";", "\n"]);
      i = end < 0 ? src.length : end + 1;
      doc = null;
      continue;
    }
    if (!kw) {
      const end = scanTo(src, i, [";", "\n"]);
      i = end < 0 ? src.length : Math.max(end + 1, i + 1);
      doc = null;
      continue;
    }
    const after = skipWs(src, kw.end);
    const line = lineAt(stmtStart);
    switch (kw.name) {
      case "import": {
        const end = scanTo(src, after, [";"]);
        const stmt = src.slice(after, end < 0 ? src.length : end);
        const from = /from\s+['"]([^'"]+)['"]/.exec(stmt)?.[1] ?? null;
        if (from) {
          const named = /\{([^}]*)\}/.exec(stmt);
          if (named) {
            for (const part of named[1]!.split(",")) {
              const m = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
              if (m) imports.set(m[2] ?? m[1]!, { from, imported: m[1]! });
            }
          }
          const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(stmt);
          if (ns) imports.set(ns[1]!, { from, imported: "*" });
          const def = /^(?:type\s+)?([A-Za-z_$][\w$]*)\s+from/.exec(stmt.trim());
          if (def) imports.set(def[1]!, { from, imported: "default" });
        }
        i = end < 0 ? src.length : end + 1;
        break;
      }
      case "type": {
        const nm = readIdent(src, after);
        if (!nm) {
          i = after;
          break;
        }
        let j = skipWs(src, nm.end);
        let typeParams: string | null = null;
        if (src[j] === "<") {
          const e = scanTo(src, j + 1, [">"], true);
          typeParams = src.slice(j + 1, e);
          j = skipWs(src, e + 1);
        }
        if (src[j] !== "=") {
          i = j;
          break;
        }
        const end = scanTo(src, j + 1, [";"]);
        add({ kind: "type", name: nm.name, exported, doc, text: src.slice(j + 1, end < 0 ? src.length : end).trim(), init: null, body: null, extends: [], typeParams, line });
        i = end < 0 ? src.length : end + 1;
        break;
      }
      case "interface":
      case "class": {
        const nm = readIdent(src, after);
        if (!nm) {
          i = after;
          break;
        }
        let j = skipWs(src, nm.end);
        let typeParams: string | null = null;
        if (src[j] === "<") {
          const e = scanTo(src, j + 1, [">"], true);
          typeParams = src.slice(j + 1, e);
          j = e + 1;
        }
        const brace = scanTo(src, j, ["{"], true);
        if (brace < 0) {
          i = src.length;
          break;
        }
        const heritage = src.slice(j, brace);
        const close = matchClose(src, brace);
        const ext: string[] = [];
        const m = /\bextends\s+([\s\S]*?)(?:\bimplements\b|$)/.exec(heritage);
        if (m) ext.push(...splitTop(m[1]!, ",").filter(Boolean));
        add({ kind: kw.name, name: nm.name, exported, doc, text: heritage.trim(), init: null, body: src.slice(brace + 1, close < 0 ? src.length : close), extends: ext, typeParams, line });
        i = close < 0 ? src.length : close + 1;
        break;
      }
      case "const":
      case "let":
      case "var": {
        const nm = readIdent(src, after);
        if (!nm) {
          i = after;
          break;
        }
        const end = scanTo(src, nm.end, [";"]);
        const rest = src.slice(nm.end, end < 0 ? src.length : end).trim();
        let type = "";
        let init: string | null = null;
        if (rest.startsWith(":")) {
          const eq = scanTo(rest, 1, ["="], true);
          if (eq >= 0 && rest[eq + 1] !== ">") {
            type = rest.slice(1, eq).trim();
            init = rest.slice(eq + 1).trim();
          } else type = rest.slice(1).trim();
        } else if (rest.startsWith("=")) init = rest.slice(1).trim();
        add({ kind: "const", name: nm.name, exported, doc, text: type, init, body: null, extends: [], typeParams: null, line });
        i = end < 0 ? src.length : end + 1;
        break;
      }
      case "function": {
        const nm = readIdent(src, after);
        const end = scanTo(src, after, [";", "{"]);
        if (nm) add({ kind: "function", name: nm.name, exported, doc, text: src.slice(nm.end, end < 0 ? src.length : end).trim(), init: null, body: null, extends: [], typeParams: null, line });
        i = end < 0 ? src.length : src[end] === "{" ? matchClose(src, end) + 1 : end + 1;
        break;
      }
      case "enum": {
        const nm = readIdent(src, after);
        const brace = src.indexOf("{", after);
        const close = brace < 0 ? -1 : matchClose(src, brace);
        if (nm && brace >= 0) add({ kind: "enum", name: nm.name, exported, doc, text: "", init: null, body: src.slice(brace + 1, close), extends: [], typeParams: null, line });
        i = close < 0 ? src.length : close + 1;
        break;
      }
      case "namespace":
      case "module":
      case "global": {
        const brace = src.indexOf("{", after);
        const close = brace < 0 ? -1 : matchClose(src, brace);
        i = close < 0 ? src.length : close + 1;
        break;
      }
      default: {
        const end = scanTo(src, i, [";", "\n"]);
        i = end < 0 ? src.length : Math.max(end + 1, i + 1);
      }
    }
    doc = null;
  }
  return { decls, imports, exportAliases };
}

/* ------------------------------------ members ------------------------------------ */

export interface Member {
  name: string;
  optional: boolean;
  readonly: boolean;
  /** Type text as authored (whitespace collapsed). */
  type: string;
  doc: JsDoc | null;
  kind: "property" | "method" | "getter";
  isStatic: boolean;
  visibility: "public" | "protected" | "private";
  /** Initializer (`static readonly formAssociated = true`). */
  init: string | null;
}

/** Members of an object type literal / interface body / class body. */
export function parseMembers(body: string): Member[] {
  const out: Member[] = [];
  let i = 0;
  let doc: JsDoc | null = null;
  while (i < body.length) {
    i = skipWs(body, i);
    if (i >= body.length) break;
    if (body.startsWith("/**", i)) {
      const e = body.indexOf("*/", i + 3);
      doc = parseJsDoc(body.slice(i, e < 0 ? body.length : e + 2));
      i = e < 0 ? body.length : e + 2;
      continue;
    }
    const sc = skipComment(body, i);
    if (sc >= 0) {
      i = sc;
      continue;
    }
    if (body[i] === ";" || body[i] === ",") {
      i++;
      continue;
    }
    const end = scanTo(body, i, [";", ","], true);
    // A member without a terminator (last member) ends at the body end; also stop at a newline that
    // begins a new member only when the scan found nothing.
    const stop = end < 0 ? body.length : end;
    const text = body.slice(i, stop).trim();
    i = stop + 1;
    const m = parseMember(text, doc);
    doc = null;
    if (m) out.push(m);
  }
  return out;
}

function parseMember(text: string, doc: JsDoc | null): Member | null {
  let t = text;
  let isStatic = false;
  let readonly = false;
  let visibility: Member["visibility"] = "public";
  for (;;) {
    const m = /^(static|readonly|public|protected|private|abstract|declare|override|accessor)\s+/.exec(t);
    if (!m) break;
    if (m[1] === "static") isStatic = true;
    if (m[1] === "readonly") readonly = true;
    if (m[1] === "protected" || m[1] === "private") visibility = m[1];
    t = t.slice(m[0].length);
  }
  if (!t || t.startsWith("[") || t.startsWith("(") || t.startsWith("<") || /^new\s*[(<]/.test(t) || /^constructor\s*\(/.test(t)) return null;
  let kind: Member["kind"] = "property";
  const acc = /^(get|set)\s+(?=[A-Za-z_$'"#])/.exec(t);
  if (acc) {
    if (acc[1] === "set") return null;
    kind = "getter";
    readonly = true;
    t = t.slice(acc[0].length);
  }
  let name: string;
  let j: number;
  if (t[0] === "'" || t[0] === '"') {
    const e = skipString(t, 0);
    name = t.slice(1, e - 1);
    j = e;
  } else if (t[0] === "#") return null;
  else {
    const id = readIdent(t, 0);
    if (!id) return null;
    name = id.name;
    j = id.end;
  }
  j = skipWs(t, j);
  let optional = false;
  if (t[j] === "?") {
    optional = true;
    j = skipWs(t, j + 1);
  }
  if (t[j] === "(" || t[j] === "<") {
    if (kind === "getter") {
      const close = t[j] === "(" ? matchClose(t, j) : -1;
      const rest = close >= 0 ? t.slice(close + 1).trim() : "";
      const type = rest.startsWith(":") ? rest.slice(1).trim() : "";
      return { name, optional, readonly, type: collapseWs(type), doc, kind, isStatic, visibility, init: null };
    }
    return { name, optional, readonly, type: collapseWs(t.slice(j)), doc, kind: "method", isStatic, visibility, init: null };
  }
  let type = "";
  let init: string | null = null;
  if (t[j] === ":") {
    const rest = t.slice(j + 1);
    const eq = scanTo(rest, 0, ["="], true);
    if (eq >= 0 && rest[eq + 1] !== ">") {
      type = rest.slice(0, eq).trim();
      init = rest.slice(eq + 1).trim();
    } else type = rest.trim();
  } else if (t[j] === "=") init = t.slice(j + 1).trim();
  else if (j < t.length) return null;
  return { name, optional, readonly, type: collapseWs(type), doc, kind, isStatic, visibility, init };
}

export const collapseWs = (s: string) => s.replace(/\s+/g, " ").trim();

/* --------------------------------- type resolution --------------------------------- */

export interface PropMember {
  name: string;
  optional: boolean;
  type: string;
  doc: JsDoc | null;
  /** Declaring type (e.g. "ButtonProps", "ButtonSlots"). */
  origin: string;
  /** True when the member is a Fluent slot (from ComponentProps<Slots>). */
  slot: boolean;
}

export interface ResolveResult {
  members: PropMember[];
  /** Type names referenced but not declared locally (imported or global). */
  unresolved: string[];
  /** Primary slot whose native element props are accepted (ComponentProps<_, primary>). */
  primarySlots: string[];
}

interface ResolveCtx {
  file: DtsFile;
  unresolved: Set<string>;
  primary: Set<string>;
  depth: number;
  stack: string[];
}

const UTIL_IGNORE = new Set(["React", "React_2", "JSX", "HTMLElement"]);

function firstDecl(file: DtsFile, name: string, kinds: DeclKind[]): Decl | undefined {
  const local = file.exportAliases.get(name) ?? name;
  return (file.decls.get(local) ?? []).find((d) => kinds.includes(d.kind));
}

/** Split `Name<a, b>` into name + raw args; null when text is not a single generic reference. */
export function genericRef(text: string): { name: string; args: string[] } | null {
  const t = text.trim();
  const m = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(<)?/.exec(t);
  if (!m) return null;
  if (!m[2]) return m[0].length === t.length ? { name: m[1]!, args: [] } : null;
  const open = m[0].length - 1;
  const close = scanTo(t, open + 1, [">"], true);
  if (close !== t.length - 1) return null;
  return { name: m[1]!, args: splitTop(t.slice(open + 1, close), ",") };
}

const stripParens = (t: string): string => {
  let s = t.trim();
  while (s.startsWith("(") && matchClose(s, 0) === s.length - 1) s = s.slice(1, -1).trim();
  return s;
};

/** String-literal keys of `'a' | 'b' | keyof X`. */
export function keysOf(text: string, ctx: Pick<ResolveCtx, "file">): string[] | null {
  const out: string[] = [];
  for (const part of splitTop(stripParens(text), "|")) {
    const p = part.trim();
    const lit = /^(['"])(.*)\1$/.exec(p);
    if (lit) {
      out.push(lit[2]!);
      continue;
    }
    const ko = /^keyof\s+(.+)$/.exec(p);
    if (ko) {
      const r = resolveProps(ko[1]!, ctx.file);
      out.push(...r.members.map((m) => m.name));
      continue;
    }
    if (p === "never") continue;
    return null;
  }
  return out;
}

function mergeInto(target: Map<string, PropMember>, members: Iterable<PropMember>) {
  for (const m of members) {
    const cur = target.get(m.name);
    if (!cur) target.set(m.name, m);
    else target.set(m.name, { ...m, doc: m.doc && (m.doc.summary || Object.keys(m.doc.tags).length) ? m.doc : cur.doc, optional: cur.optional && m.optional });
  }
}

/**
 * Union of prop shapes (`{ text?: string; children: string } | { text: string; children?: ReactNode }`):
 * a prop is required only when every branch declares it as required, and its type is the union of
 * the distinct branch types. (Intersection merging would claim "required" from any one branch.)
 */
export function mergeUnion(branches: Map<string, PropMember>[]): Map<string, PropMember> {
  const out = new Map<string, PropMember>();
  if (branches.length === 1) return branches[0]!;
  const names: string[] = [];
  for (const b of branches) for (const k of b.keys()) if (!names.includes(k)) names.push(k);
  for (const name of names) {
    const present = branches.map((b) => b.get(name)).filter((m): m is PropMember => !!m);
    const types: string[] = [];
    for (const m of present) if (m.type && !types.includes(m.type)) types.push(m.type);
    const withDoc = present.find((m) => m.doc && (m.doc.summary || Object.keys(m.doc.tags).length)) ?? present[0]!;
    out.set(name, {
      ...present[present.length - 1]!,
      doc: withDoc.doc,
      type: types.length > 1 ? types.join(" | ") : (types[0] ?? present[0]!.type),
      optional: present.length < branches.length || present.some((m) => m.optional),
    });
  }
  return out;
}

function resolveInner(text: string, ctx: ResolveCtx, origin: string): Map<string, PropMember> {
  const out = new Map<string, PropMember>();
  if (ctx.depth > 24) return out;
  const t = stripParens(text);
  if (!t) return out;
  const inter = splitTop(t, "&");
  if (inter.length > 1) {
    for (const part of inter) mergeInto(out, resolveInner(part, { ...ctx, depth: ctx.depth + 1 }, origin).values());
    return out;
  }
  const uni = splitTop(t, "|");
  if (uni.length > 1) {
    const branches = uni
      .filter((part) => !/^(undefined|null|never)$/.test(part))
      .map((part) => resolveInner(part, { ...ctx, depth: ctx.depth + 1 }, origin));
    return mergeUnion(branches);
  }
  if (t.startsWith("{")) {
    const close = matchClose(t, 0);
    for (const m of parseMembers(t.slice(1, close < 0 ? t.length : close))) {
      if ((m.kind === "method" && !m.optional) || hasTag(m.doc, "internal")) continue;
      out.set(m.name, { name: m.name, optional: m.optional, type: m.type, doc: m.doc, origin, slot: false });
    }
    return out;
  }
  const g = genericRef(t);
  if (!g) return out;
  const next = { ...ctx, depth: ctx.depth + 1 };
  const base = g.name.split(".").pop()!;
  switch (base) {
    case "Pick":
    case "Omit":
    case "DistributiveOmit": {
      if (g.args.length < 2) return out;
      const inner = resolveInner(g.args[0]!, next, origin);
      const keys = keysOf(g.args[1]!, ctx);
      if (!keys) {
        ctx.unresolved.add(`${base}<…, ${collapseWs(g.args[1]!).slice(0, 60)}>`);
        return base === "Pick" ? out : inner;
      }
      const ks = new Set(keys);
      for (const [k, v] of inner) if (base === "Pick" ? ks.has(k) : !ks.has(k)) out.set(k, v);
      return out;
    }
    case "Partial":
    case "Required":
    case "Readonly":
    case "NonNullable":
    case "PropsWithChildren": {
      const inner = resolveInner(g.args[0] ?? "", next, origin);
      for (const [k, v] of inner) out.set(k, base === "Partial" ? { ...v, optional: true } : base === "Required" ? { ...v, optional: false } : v);
      if (base === "PropsWithChildren" && !out.has("children")) out.set("children", { name: "children", optional: true, type: "ReactNode", doc: null, origin: "PropsWithChildren", slot: false });
      return out;
    }
    case "ComponentProps": {
      // Fluent: ComponentProps<Slots, Primary = 'root'> = Omit<Slots, Primary> & props of the primary slot.
      const slots = resolveInner(g.args[0] ?? "", next, origin);
      const primary = g.args[1] ? (keysOf(g.args[1], ctx) ?? ["root"]) : ["root"];
      for (const p of primary) ctx.primary.add(p);
      for (const [k, v] of slots) if (!primary.includes(k)) out.set(k, { ...v, slot: true, optional: true });
      return out;
    }
    default:
      break;
  }
  if (UTIL_IGNORE.has(g.name.split(".")[0]!)) {
    ctx.unresolved.add(g.name);
    return out;
  }
  const decl = firstDecl(ctx.file, g.name, ["type", "interface", "class"]);
  if (!decl) {
    if (!/^(string|number|boolean|unknown|any|object|void|never|undefined|null)$/.test(g.name)) ctx.unresolved.add(g.name);
    return out;
  }
  if (ctx.stack.includes(decl.name)) return out;
  const sub = { ...next, stack: [...ctx.stack, decl.name] };
  if (decl.kind === "type") {
    if (decl.typeParams && g.args.length) {
      ctx.unresolved.add(`${decl.name}<…>`);
      return out;
    }
    return resolveInner(decl.text, sub, decl.name);
  }
  for (const e of decl.extends) mergeInto(out, resolveInner(e, sub, decl.name).values());
  for (const m of parseMembers(decl.body ?? "")) {
    if (m.kind === "method" || m.isStatic || m.visibility !== "public" || hasTag(m.doc, "internal") || hasTag(m.doc, "private")) continue;
    out.set(m.name, { name: m.name, optional: m.optional, type: m.type, doc: m.doc, origin: decl.name, slot: false });
  }
  return out;
}

/** Resolve the members of a props type expression (e.g. "ButtonProps"). */
export function resolveProps(typeText: string, file: DtsFile): ResolveResult {
  const ctx: ResolveCtx = { file, unresolved: new Set(), primary: new Set(), depth: 0, stack: [] };
  const members = resolveInner(typeText, ctx, collapseWs(typeText).slice(0, 80));
  return { members: [...members.values()], unresolved: [...ctx.unresolved].sort(), primarySlots: [...ctx.primary].sort() };
}

/* -------------------------------- literal unions -------------------------------- */

/**
 * Literal values of a union type: `'a' | 'b'`, a local alias of one, `ValuesOf<typeof Const>` where
 * Const is declared `{ readonly a: "a"; ... }`, or a `keyof typeof Const`. Null when any member is
 * not a literal (booleans and open types are not enumerations).
 */
export function literalValues(typeText: string, file: DtsFile, depth = 0): string[] | null {
  if (depth > 8) return null;
  const parts = splitTop(stripParens(typeText), "|").filter((p) => !/^(undefined|null)$/.test(p));
  if (!parts.length) return null;
  const out: string[] = [];
  for (const p of parts) {
    const lit = /^(['"])(.*)\1$/.exec(p);
    if (lit) {
      out.push(lit[2]!);
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(p)) {
      out.push(p);
      continue;
    }
    const vo = /^ValuesOf<\s*typeof\s+([A-Za-z_$][\w$]*)\s*>$/.exec(p);
    if (vo) {
      const vals = constObjectValues(vo[1]!, file);
      if (!vals) return null;
      out.push(...vals);
      continue;
    }
    const g = genericRef(p);
    if (g && !g.args.length) {
      const d = firstDecl(file, g.name, ["type"]);
      if (!d || d.typeParams) return null;
      const inner = literalValues(d.text, file, depth + 1);
      if (!inner) return null;
      out.push(...inner);
      continue;
    }
    return null;
  }
  const u = [...new Set(out)];
  return u.length >= 1 ? u : null;
}

/** Values of `declare const X: { readonly a: "a"; readonly b: "b" }`. */
export function constObjectValues(name: string, file: DtsFile): string[] | null {
  const d = firstDecl(file, name, ["const"]);
  if (!d || !d.text.trim().startsWith("{")) return null;
  const t = d.text.trim();
  const vals: string[] = [];
  for (const m of parseMembers(t.slice(1, matchClose(t, 0)))) {
    const lit = /^(['"])(.*)\1$/.exec(m.type);
    if (lit) vals.push(lit[2]!);
    else if (/^-?\d+(\.\d+)?$/.test(m.type)) vals.push(m.type);
    else return null;
  }
  return vals.length ? vals : null;
}

/** `@default` / `@defaultValue` / `@defaultvalue` tag value, unquoted when it is a single literal. */
export function defaultOf(doc: JsDoc | null | undefined): string | null {
  const raw = docTag(doc, "default") ?? docTag(doc, "defaultValue") ?? docTag(doc, "defaultvalue");
  if (raw === null) return null;
  const t = raw.replace(/^`+|`+$/g, "").trim().split("\n")[0]!.trim();
  if (!t) return null;
  const lit = /^(['"])(.*)\1$/.exec(t);
  return lit ? lit[2]! : t;
}

/** Text of a member's TSDoc suitable for a property description (summary + remarks minus API boilerplate). */
export function memberDescription(doc: JsDoc | null | undefined): string | null {
  if (!doc) return null;
  const s = doc.summary.replace(/\n+/g, " ").trim();
  if (/\bTODO\b|add (more )?docs/i.test(s)) return null;
  return s || null;
}

/* ------------------------------ component extraction ------------------------------ */

export interface DtsComponent {
  name: string;
  doc: JsDoc | null;
  /** Props type name, or the inline props type text. */
  propsType: string;
  members: PropMember[];
  unresolved: string[];
  primarySlots: string[];
  /** TSDoc marks the export @internal (kept so documented pages can still use it). */
  internal: boolean;
  line: number;
}

const COMPONENT_TYPE = /(?:^|[\s&|(<.])(?:ForwardRefComponent|FC|FunctionComponent|ForwardRefExoticComponent|ComponentType|NamedExoticComponent|MemoExoticComponent)\s*</;

/** Props type argument of a component type (`ForwardRefComponent<ButtonProps>` -> "ButtonProps"). */
export function componentPropsArg(typeText: string): string | null {
  const t = ` ${typeText}`;
  const m = COMPONENT_TYPE.exec(t);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = scanTo(t, open + 1, [">"], true);
  if (close < 0) return null;
  const arg = t.slice(open + 1, close).trim();
  return arg || null;
}

/** Exported React components of a Fluent package roll-up: `export declare const X: ForwardRefComponent<XProps>`. */
export function reactComponentsOf(file: DtsFile): DtsComponent[] {
  const out: DtsComponent[] = [];
  const names = new Map<string, string>(); // exported name -> local decl name
  for (const [name, decls] of file.decls) if (decls.some((d) => d.kind === "const" && d.exported)) names.set(name, name);
  for (const [exported, local] of file.exportAliases) if (!names.has(exported)) names.set(exported, local);
  for (const [name, local] of names) {
    if (!/^[A-Z]/.test(name)) continue;
    const d = (file.decls.get(local) ?? []).find((x) => x.kind === "const");
    if (!d) continue;
    const arg = componentPropsArg(d.text);
    if (!arg) continue;
    const ident = /^[A-Za-z_$][\w$]*$/.test(arg);
    if (ident && !/Props$/.test(arg)) continue;
    if (!ident && !/[{&]/.test(arg)) continue;
    const r = resolveProps(arg, file);
    out.push({ name, doc: d.doc, propsType: ident ? arg : `${name} props (inline)`, members: r.members, unresolved: r.unresolved, primarySlots: r.primarySlots, internal: hasTag(d.doc, "internal"), line: d.line });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export interface DtsElementMember {
  name: string;
  attribute: string | null;
  type: string;
  optional: boolean;
  readonly: boolean;
  doc: JsDoc | null;
  declaredIn: string;
  init: string | null;
}

export interface DtsElement {
  className: string;
  tagName: string;
  doc: JsDoc | null;
  /** Class chain, own class first ("Button", "BaseButton"). */
  chain: string[];
  members: DtsElementMember[];
  /** Merged JSDoc tags across the chain (@slot, @csspart, @fires). */
  slots: string[];
  events: string[];
  cssParts: string[];
  line: number;
}

/**
 * Custom elements of a web-components roll-up: `XDefinition` consts documented as
 * "The definition for the `<fluent-x>` element." paired with `class X`.
 */
export function customElementsOf(file: DtsFile): DtsElement[] {
  const out: DtsElement[] = [];
  for (const [name, decls] of file.decls) {
    const m = /^([A-Z][\w$]*)Definition$/.exec(name);
    if (!m) continue;
    const def = decls.find((d) => d.kind === "const");
    const tag = /`<([a-z][a-z0-9-]*)>`/.exec(def?.doc?.summary ?? "")?.[1];
    if (!def || !tag) continue;
    const cls = firstDecl(file, m[1]!, ["class"]);
    if (!cls) continue;
    const chain: string[] = [];
    const members = new Map<string, DtsElementMember>();
    const slots = new Set<string>();
    const events = new Set<string>();
    const parts = new Set<string>();
    let cur: Decl | undefined = cls;
    const seen = new Set<string>();
    const chainDecls: Decl[] = [];
    while (cur && !seen.has(cur.name)) {
      seen.add(cur.name);
      chain.push(cur.name);
      chainDecls.push(cur);
      const parent: string | undefined = cur.extends[0] ? genericRef(cur.extends[0])?.name : undefined;
      cur = parent ? firstDecl(file, parent, ["class"]) : undefined;
    }
    // Base classes first so subclasses override.
    for (const d of [...chainDecls].reverse()) {
      for (const t of d.doc?.tags.slot ?? []) slots.add(t.split(/\s+-\s+/)[0]!.trim() || "(default)");
      for (const t of d.doc?.tags.fires ?? []) {
        const ev = /^(?:\{[^}]*\}\s*)?([\w:-]+)/.exec(t.trim())?.[1];
        if (ev) events.add(ev);
      }
      for (const t of d.doc?.tags.csspart ?? []) parts.add(t.split(/\s+-\s+/)[0]!.trim());
      for (const mem of parseMembers(d.body ?? "")) {
        if (mem.kind === "method" || mem.isStatic || mem.visibility !== "public") continue;
        if (hasTag(mem.doc, "internal") || hasTag(mem.doc, "private") || mem.name.startsWith("_")) continue;
        if (!hasTag(mem.doc, "public") && !mem.doc) continue;
        const attr = /HTML Attribute:\s*`?([a-z][a-z0-9-]*)`?/.exec((mem.doc?.tags.remarks ?? []).join("\n"))?.[1] ?? null;
        members.set(mem.name, { name: mem.name, attribute: attr, type: mem.type, optional: mem.optional, readonly: mem.readonly, doc: mem.doc, declaredIn: d.name, init: mem.init });
      }
    }
    out.push({ className: cls.name, tagName: tag, doc: cls.doc, chain, members: [...members.values()], slots: [...slots], events: [...events], cssParts: [...parts], line: cls.line });
  }
  return out.sort((a, b) => (a.tagName < b.tagName ? -1 : 1));
}
