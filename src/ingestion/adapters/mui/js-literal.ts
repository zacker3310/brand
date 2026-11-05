/**
 * Minimal static reader for JavaScript object literals in published package files
 * (e.g. `const red = { 50: '#ffebee', ... }`, `function getLight() { return { ... } }`).
 *
 * Nothing is evaluated. Supported values: string/number/boolean/null literals, template literals
 * without substitutions, nested object/array literals, spreads, and member-expression references
 * (`common.white`, `blue[700]`, `colors.blue`). Anything else (calls, operators, template
 * substitutions, functions) is returned as { t: "unsupported", raw } so callers can mark it
 * not-extracted instead of guessing.
 */

export type JsValue =
  | { t: "string"; v: string }
  | { t: "number"; v: number; raw: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "ref"; path: string[]; raw: string }
  | { t: "object"; entries: { key: string; value: JsValue }[]; spreads: JsValue[] }
  | { t: "array"; items: JsValue[] }
  | { t: "unsupported"; raw: string };

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

class Reader {
  constructor(
    readonly src: string,
    public i: number,
  ) {}

  ws(): void {
    const s = this.src;
    for (;;) {
      while (this.i < s.length && /\s/.test(s[this.i]!)) this.i++;
      if (s.startsWith("//", this.i)) {
        const nl = s.indexOf("\n", this.i);
        this.i = nl < 0 ? s.length : nl + 1;
        continue;
      }
      if (s.startsWith("/*", this.i)) {
        const end = s.indexOf("*/", this.i + 2);
        this.i = end < 0 ? s.length : end + 2;
        continue;
      }
      return;
    }
  }

  peek(): string {
    return this.src[this.i] ?? "";
  }

  string(): string {
    const s = this.src;
    const q = s[this.i]!;
    this.i++;
    let out = "";
    while (this.i < s.length && s[this.i] !== q) {
      const c = s[this.i]!;
      if (c === "\\") {
        const n = s[this.i + 1] ?? "";
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "`": "`" };
        out += map[n] ?? n;
        this.i += 2;
        continue;
      }
      out += c;
      this.i++;
    }
    this.i++; // closing quote
    return out;
  }

  ident(): string {
    const s = this.src;
    const start = this.i;
    if (!ID_START.test(s[this.i] ?? "")) return "";
    while (this.i < s.length && ID_PART.test(s[this.i]!)) this.i++;
    return s.slice(start, this.i);
  }

  /** Skip one expression up to a top-level `,` `}` `]` `)` `;` (not consumed). */
  skipExpression(): void {
    const s = this.src;
    let depth = 0;
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (c === "'" || c === '"') {
        this.string();
        continue;
      }
      if (c === "`") {
        this.template();
        continue;
      }
      if (s.startsWith("//", this.i) || s.startsWith("/*", this.i)) {
        this.ws();
        continue;
      }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) return;
        depth--;
      } else if ((c === "," || c === ";") && depth === 0) return;
      this.i++;
    }
  }

  /** Template literal; returns its text when it has no substitutions, else null. */
  template(): string | null {
    const s = this.src;
    this.i++;
    let out = "";
    let dynamic = false;
    while (this.i < s.length && s[this.i] !== "`") {
      if (s[this.i] === "\\") {
        out += s[this.i + 1] ?? "";
        this.i += 2;
        continue;
      }
      if (s.startsWith("${", this.i)) {
        dynamic = true;
        let depth = 0;
        this.i += 2;
        while (this.i < s.length) {
          const c = s[this.i]!;
          if (c === "{") depth++;
          else if (c === "}") {
            if (depth === 0) break;
            depth--;
          } else if (c === "`") {
            this.template();
            continue;
          } else if (c === "'" || c === '"') {
            this.string();
            continue;
          }
          this.i++;
        }
        this.i++;
        continue;
      }
      out += s[this.i];
      this.i++;
    }
    this.i++;
    return dynamic ? null : out;
  }

  private atValueEnd(): boolean {
    this.ws();
    const c = this.peek();
    return c === "" || c === "," || c === "}" || c === "]" || c === ")" || c === ";";
  }

  value(): JsValue {
    this.ws();
    const s = this.src;
    const start = this.i;
    const c = this.peek();
    const unsupported = (): JsValue => {
      this.i = start;
      this.skipExpression();
      return { t: "unsupported", raw: s.slice(start, this.i).trim().slice(0, 200) };
    };
    let v: JsValue;
    if (c === "{") v = this.object();
    else if (c === "[") v = this.array();
    else if (c === "'" || c === '"') v = { t: "string", v: this.string() };
    else if (c === "`") {
      const t = this.template();
      if (t === null) return unsupported();
      v = { t: "string", v: t };
    } else if (/[0-9.-]/.test(c)) {
      const m = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)/.exec(s.slice(this.i));
      if (!m) return unsupported();
      this.i += m[0].length;
      v = { t: "number", v: Number(m[0]), raw: m[0] };
    } else if (ID_START.test(c)) {
      const id = this.ident();
      if (id === "true" || id === "false") v = { t: "bool", v: id === "true" };
      else if (id === "null") v = { t: "null" };
      else if (id === "function" || id === "new" || id === "void" || id === "typeof" || id === "undefined") return unsupported();
      else {
        const path = [id];
        for (;;) {
          this.ws();
          if (this.peek() === "." && ID_START.test(s[this.i + 1] ?? "")) {
            this.i++;
            path.push(this.ident());
            continue;
          }
          if (this.peek() === "[") {
            this.i++;
            this.ws();
            const q = this.peek();
            let key: string | null = null;
            if (q === "'" || q === '"') key = this.string();
            else {
              const m = /^\d+/.exec(s.slice(this.i));
              if (m) {
                key = m[0];
                this.i += m[0].length;
              }
            }
            this.ws();
            if (key === null || this.peek() !== "]") return unsupported();
            this.i++;
            path.push(key);
            continue;
          }
          break;
        }
        v = { t: "ref", path, raw: s.slice(start, this.i).trim() };
      }
    } else return unsupported();
    if (!this.atValueEnd()) return unsupported();
    return v;
  }

  object(): JsValue {
    const s = this.src;
    const start = this.i;
    this.i++; // {
    const entries: { key: string; value: JsValue }[] = [];
    const spreads: JsValue[] = [];
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === "") return { t: "unsupported", raw: s.slice(start, this.i).slice(0, 200) };
      if (c === "}") {
        this.i++;
        break;
      }
      if (c === ",") {
        this.i++;
        continue;
      }
      if (s.startsWith("...", this.i)) {
        this.i += 3;
        spreads.push(this.value());
        continue;
      }
      let key: string | null = null;
      if (c === "'" || c === '"') key = this.string();
      else if (/[0-9]/.test(c)) {
        const m = /^\d+(?:\.\d+)?/.exec(s.slice(this.i))!;
        key = m[0];
        this.i += m[0].length;
      } else if (ID_START.test(c)) key = this.ident();
      else {
        // computed key or something exotic: skip the whole member
        this.skipExpression();
        continue;
      }
      this.ws();
      if (this.peek() === ":") {
        this.i++;
        entries.push({ key: key!, value: this.value() });
      } else if (this.peek() === "(") {
        // method shorthand: skip params and body
        this.skipExpression();
        entries.push({ key: key!, value: { t: "unsupported", raw: `${key}() {…}` } });
      } else {
        // shorthand property `{ foo }`
        entries.push({ key: key!, value: { t: "ref", path: [key!], raw: key! } });
      }
    }
    return { t: "object", entries, spreads };
  }

  array(): JsValue {
    this.i++; // [
    const items: JsValue[] = [];
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === "") break;
      if (c === "]") {
        this.i++;
        break;
      }
      if (c === ",") {
        this.i++;
        continue;
      }
      items.push(this.value());
    }
    return { t: "array", items };
  }
}

/** Parse the value starting at `index` (whitespace/comments allowed before it). */
export function parseValueAt(src: string, index: number): { value: JsValue; end: number } {
  const r = new Reader(src, index);
  const value = r.value();
  return { value, end: r.i };
}

/**
 * Find `pattern` (which must end right before the value, e.g. /const red\s*=\s*\/) and parse the
 * value that follows. Returns null when the pattern is not found.
 */
export function findValue(src: string, pattern: RegExp): { value: JsValue; index: number } | null {
  const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const m = re.exec(src);
  if (!m) return null;
  const index = m.index + m[0].length;
  return { value: parseValueAt(src, index).value, index };
}

/** Body of `function name(...) {` -> the object literal of its first `return {` (same nesting level). */
export function functionReturns(src: string, name: string): { mode: "default" | string; value: JsValue }[] {
  const re = new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return [];
  const bodyStart = m.index + m[0].length;
  const body = sliceBalanced(src, bodyStart - 1);
  if (body === null) return [];
  const out: { mode: string; value: JsValue }[] = [];
  // `if (mode === 'dark') { return {...}; }` branches, then the trailing `return {...}`.
  const branchRe = /if\s*\(\s*mode\s*===\s*'([a-z]+)'\s*\)\s*\{\s*return\s*/g;
  let consumedTo = 0;
  for (let b = branchRe.exec(body); b; b = branchRe.exec(body)) {
    const { value, end } = parseValueAt(body, b.index + b[0].length);
    out.push({ mode: b[1]!, value });
    consumedTo = end;
  }
  const rest = body.slice(consumedTo);
  const ret = /return\s*(?=\{)/.exec(rest);
  if (ret) out.push({ mode: "default", value: parseValueAt(rest, ret.index + ret[0].length).value });
  return out;
}

/** Text between a `{` at `open` and its matching `}` (exclusive), string/comment aware. */
export function sliceBalanced(src: string, open: number): string | null {
  if (src[open] !== "{") return null;
  let depth = 0;
  const r = new Reader(src, open);
  while (r.i < src.length) {
    const c = src[r.i]!;
    if (c === "'" || c === '"') {
      r.string();
      continue;
    }
    if (c === "`") {
      r.template();
      continue;
    }
    if (src.startsWith("//", r.i) || src.startsWith("/*", r.i)) {
      r.ws();
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, r.i);
    }
    r.i++;
  }
  return null;
}

/** Flatten an object literal into leaf entries with their key paths. Spreads are reported separately. */
export function flattenObject(v: JsValue, prefix: string[] = []): { path: string[]; value: JsValue }[] {
  if (v.t !== "object") return [{ path: prefix, value: v }];
  const out: { path: string[]; value: JsValue }[] = [];
  for (const e of v.entries) {
    if (e.value.t === "object") out.push(...flattenObject(e.value, [...prefix, e.key]));
    else out.push({ path: [...prefix, e.key], value: e.value });
  }
  return out;
}

export function objectGet(v: JsValue | null | undefined, key: string): JsValue | null {
  if (!v || v.t !== "object") return null;
  return v.entries.find((e) => e.key === key)?.value ?? null;
}
