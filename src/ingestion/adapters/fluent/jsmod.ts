/**
 * A deliberately tiny, side-effect-free interpreter for the generated ES modules in
 * @fluentui/tokens/lib (object literals of token values, arrow functions that build a theme from a
 * brand ramp, `Array#reduce` loops that build palette tokens from name lists).
 *
 * This is static analysis, not execution: fetched code is never handed to a JavaScript engine.
 * Source text is tokenized and parsed into a small expression AST; only a whitelisted subset is
 * understood (literals, templates, `+`, member access, object/array literals with spread, arrow and
 * function declarations, `const`, `return`, member assignment, and the pure built-ins
 * String#slice/toUpperCase/toLowerCase, Array#reduce/map, Object.assign/entries/keys). Anything
 * else evaluates to an opaque value and is reported. There are no loops other than `reduce`/`map`
 * over finite literal arrays, and evaluation is bounded by a step budget.
 *
 * Values keep *provenance*: reading a member of a "token group" object (a color ramp such as
 * `grey`, a brand ramp, or a map of theme tokens) yields a reference to that token instead of its
 * literal, so aliases are preserved exactly as authored ("{grey.14}", "{brandWeb.80}").
 */

/* --------------------------------- tokenizer --------------------------------- */

type Tok =
  | { k: "id"; v: string; line: number }
  | { k: "num"; v: number; line: number }
  | { k: "str"; v: string; line: number }
  | { k: "tpl"; parts: (string | Tok[])[]; line: number }
  | { k: "p"; v: string; line: number }
  | { k: "eof"; line: number };

const PUNCT = ["...", "=>", "===", "!==", "==", "!=", "&&", "||", "??", "?.", "{", "}", "(", ")", "[", "]", ",", ":", ";", ".", "=", "+", "-", "*", "/", "?", "!", "<", ">"];

export class JsSyntaxError extends Error {}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      for (let k = i; k < end; k++) if (src[k] === "\n") line++;
      i = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j]!)) j++;
      out.push({ k: "id", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /[0-9._eExXa-fA-F]/.test(src[j]!)) j++;
      out.push({ k: "num", v: Number(src.slice(i, j).replace(/_/g, "")), line });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let v = "";
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") {
          v += unescapeChar(src[j + 1] ?? "");
          j += 2;
          continue;
        }
        v += src[j];
        j++;
      }
      out.push({ k: "str", v, line });
      i = j + 1;
      continue;
    }
    if (c === "`") {
      const parts: (string | Tok[])[] = [];
      let j = i + 1;
      let cur = "";
      const startLine = line;
      while (j < n && src[j] !== "`") {
        if (src[j] === "\\") {
          cur += unescapeChar(src[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (src[j] === "$" && src[j + 1] === "{") {
          parts.push(cur);
          cur = "";
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            if (depth > 0) k++;
          }
          parts.push(tokenize(src.slice(j + 2, k)).slice(0, -1));
          j = k + 1;
          continue;
        }
        if (src[j] === "\n") line++;
        cur += src[j];
        j++;
      }
      parts.push(cur);
      out.push({ k: "tpl", parts, line: startLine });
      i = j + 1;
      continue;
    }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (!p) throw new JsSyntaxError(`unexpected character ${JSON.stringify(c)} at line ${line}`);
    out.push({ k: "p", v: p, line });
    i += p.length;
  }
  out.push({ k: "eof", line });
  return out;
}

function unescapeChar(c: string): string {
  return c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c;
}

/* ----------------------------------- AST ----------------------------------- */

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "tpl"; parts: (string | Node)[] }
  | { t: "id"; name: string }
  | { t: "member"; obj: Node; prop: Node; computed: boolean }
  | { t: "call"; callee: Node; args: Node[] }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "obj"; props: ({ kind: "kv"; key: Node; computed: boolean; value: Node; line: number } | { kind: "spread"; arg: Node; line: number })[]; line: number }
  | { t: "arr"; items: Node[] }
  | { t: "fn"; params: Param[]; body: Node | Stmt[] }
  | { t: "unsupported"; what: string };

export type Param = { kind: "id"; name: string; def: Node | null } | { kind: "arr"; names: string[] };

export type Stmt =
  | { t: "import"; names: { local: string; imported: string }[]; from: string }
  | { t: "reexport"; names: { exported: string; local: string }[]; from: string }
  | { t: "exportList"; names: { exported: string; local: string }[] }
  | { t: "const"; name: string; init: Node; exported: boolean; line: number }
  | { t: "assign"; target: Node; value: Node; line: number }
  | { t: "return"; value: Node }
  | { t: "expr"; value: Node };

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}
  private peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)]!;
  }
  private next(): Tok {
    return this.toks[this.i++] ?? this.toks[this.toks.length - 1]!;
  }
  private isP(v: string, o = 0) {
    const t = this.peek(o);
    return t.k === "p" && t.v === v;
  }
  private isId(v: string, o = 0) {
    const t = this.peek(o);
    return t.k === "id" && t.v === v;
  }
  private eat(v: string) {
    if (this.isP(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(v: string) {
    if (!this.eat(v)) throw new JsSyntaxError(`expected '${v}' at line ${this.peek().line}, got ${JSON.stringify(this.peek())}`);
  }
  private ident(): string {
    const t = this.next();
    if (t.k !== "id") throw new JsSyntaxError(`expected identifier at line ${t.line}`);
    return t.v;
  }

  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.peek().k !== "eof") {
      if (this.eat(";")) continue;
      out.push(...this.statement(true));
    }
    return out;
  }

  private block(): Stmt[] {
    this.expect("{");
    const out: Stmt[] = [];
    while (!this.isP("}")) {
      if (this.peek().k === "eof") throw new JsSyntaxError("unterminated block");
      if (this.eat(";")) continue;
      out.push(...this.statement(false));
    }
    this.expect("}");
    return out;
  }

  private nameList(): { a: string; b: string }[] {
    this.expect("{");
    const out: { a: string; b: string }[] = [];
    while (!this.isP("}")) {
      const a = this.ident();
      let b = a;
      if (this.isId("as")) {
        this.next();
        b = this.ident();
      }
      out.push({ a, b });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return out;
  }

  private fromClause(): string {
    if (!this.isId("from")) throw new JsSyntaxError(`expected from at line ${this.peek().line}`);
    this.next();
    const t = this.next();
    if (t.k !== "str") throw new JsSyntaxError("expected module specifier");
    return t.v;
  }

  private statement(top: boolean): Stmt[] {
    const t = this.peek();
    if (t.k === "id" && t.v === "import" && top) {
      this.next();
      if (this.peek().k === "str") {
        this.next();
        this.eat(";");
        return [];
      }
      const names = this.isP("{") ? this.nameList().map(({ a, b }) => ({ imported: a, local: b })) : [];
      const from = this.fromClause();
      this.eat(";");
      return [{ t: "import", names, from }];
    }
    if (t.k === "id" && t.v === "export" && top) {
      this.next();
      if (this.isP("{")) {
        const list = this.nameList();
        if (this.isId("from")) {
          const from = this.fromClause();
          this.eat(";");
          return [{ t: "reexport", names: list.map(({ a, b }) => ({ local: a, exported: b })), from }];
        }
        this.eat(";");
        return [{ t: "exportList", names: list.map(({ a, b }) => ({ local: a, exported: b })) }];
      }
      if (this.isId("function")) return [this.functionDecl(true)];
      if (this.isId("const") || this.isId("let") || this.isId("var")) return this.constDecl(true);
      throw new JsSyntaxError(`unsupported export form at line ${t.line}`);
    }
    if (t.k === "id" && (t.v === "const" || t.v === "let" || t.v === "var")) return this.constDecl(false);
    if (t.k === "id" && t.v === "function") return [this.functionDecl(false)];
    if (t.k === "id" && t.v === "return") {
      this.next();
      const value = this.expr();
      this.eat(";");
      return [{ t: "return", value }];
    }
    const e = this.expr();
    if (this.eat("=")) {
      const value = this.expr();
      this.eat(";");
      return [{ t: "assign", target: e, value, line: t.line }];
    }
    this.eat(";");
    return [{ t: "expr", value: e }];
  }

  private constDecl(exported: boolean): Stmt[] {
    this.next();
    const out: Stmt[] = [];
    for (;;) {
      const line = this.peek().line;
      const name = this.ident();
      this.expect("=");
      out.push({ t: "const", name, init: this.expr(), exported, line });
      if (!this.eat(",")) break;
    }
    this.eat(";");
    return out;
  }

  private functionDecl(exported: boolean): Stmt {
    const line = this.peek().line;
    this.next();
    const name = this.ident();
    const params = this.params();
    const body = this.block();
    return { t: "const", name, init: { t: "fn", params, body }, exported, line };
  }

  private params(): Param[] {
    this.expect("(");
    const out: Param[] = [];
    while (!this.isP(")")) {
      if (this.isP("[")) {
        this.next();
        const names: string[] = [];
        while (!this.isP("]")) {
          names.push(this.ident());
          if (!this.eat(",")) break;
        }
        this.expect("]");
        out.push({ kind: "arr", names });
      } else {
        const name = this.ident();
        const def = this.eat("=") ? this.expr() : null;
        out.push({ kind: "id", name, def });
      }
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return out;
  }

  /** Detect `(a, b) =>` / `([a, b]) =>` / `() =>` / `a =>` at the current position. */
  private arrowAhead(): boolean {
    if (this.peek().k === "id" && this.isP("=>", 1)) return true;
    if (!this.isP("(")) return false;
    let depth = 0;
    for (let k = this.i; k < this.toks.length; k++) {
      const t = this.toks[k]!;
      if (t.k === "p" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
      else if (t.k === "p" && (t.v === ")" || t.v === "]" || t.v === "}")) {
        depth--;
        if (depth === 0) {
          const nx = this.toks[k + 1];
          return !!nx && nx.k === "p" && nx.v === "=>";
        }
      } else if (t.k === "eof") return false;
    }
    return false;
  }

  expr(): Node {
    if (this.arrowAhead()) {
      let params: Param[];
      if (this.peek().k === "id") params = [{ kind: "id", name: this.ident(), def: null }];
      else params = this.params();
      this.expect("=>");
      if (this.isP("{")) return { t: "fn", params, body: this.block() };
      return { t: "fn", params, body: this.expr() };
    }
    return this.additive();
  }

  private additive(): Node {
    let l = this.postfix();
    while (this.isP("+") || this.isP("-") || this.isP("*") || this.isP("/") || this.isP("??") || this.isP("||") || this.isP("&&")) {
      const op = (this.next() as { v: string }).v;
      l = { t: "bin", op, l, r: this.postfix() };
    }
    if (this.isP("?")) {
      // Conditional expressions are not part of the supported subset.
      this.next();
      this.expr();
      this.expect(":");
      this.expr();
      return { t: "unsupported", what: "conditional expression" };
    }
    return l;
  }

  private postfix(): Node {
    let e = this.primary();
    for (;;) {
      if (this.eat(".") || this.eat("?.")) {
        const name = this.ident();
        e = { t: "member", obj: e, prop: { t: "str", v: name }, computed: false };
      } else if (this.isP("[")) {
        this.next();
        const prop = this.expr();
        this.expect("]");
        e = { t: "member", obj: e, prop, computed: true };
      } else if (this.isP("(")) {
        this.next();
        const args: Node[] = [];
        while (!this.isP(")")) {
          args.push(this.expr());
          if (!this.eat(",")) break;
        }
        this.expect(")");
        e = { t: "call", callee: e, args };
      } else break;
    }
    return e;
  }

  private primary(): Node {
    const t = this.next();
    switch (t.k) {
      case "num":
        return { t: "num", v: t.v };
      case "str":
        return { t: "str", v: t.v };
      case "tpl":
        return { t: "tpl", parts: t.parts.map((p) => (typeof p === "string" ? p : new Parser([...p, { k: "eof", line: t.line }]).expr())) };
      case "id":
        if (t.v === "new" || t.v === "function" || t.v === "class") return { t: "unsupported", what: t.v };
        return { t: "id", name: t.v };
      case "p":
        if (t.v === "(") {
          const e = this.expr();
          this.expect(")");
          return e;
        }
        if (t.v === "{") return this.object(t.line);
        if (t.v === "[") {
          const items: Node[] = [];
          while (!this.isP("]")) {
            items.push(this.expr());
            if (!this.eat(",")) break;
          }
          this.expect("]");
          return { t: "arr", items };
        }
        if (t.v === "-" && this.peek().k === "num") return { t: "num", v: -(this.next() as { v: number }).v };
        throw new JsSyntaxError(`unexpected '${t.v}' at line ${t.line}`);
      default:
        throw new JsSyntaxError(`unexpected end of input`);
    }
  }

  private object(line: number): Node {
    const props: Extract<Node, { t: "obj" }>["props"] = [];
    while (!this.isP("}")) {
      const pl = this.peek().line;
      if (this.eat("...")) {
        props.push({ kind: "spread", arg: this.expr(), line: pl });
      } else {
        let key: Node;
        let computed = false;
        const kt = this.next();
        if (kt.k === "p" && kt.v === "[") {
          key = this.expr();
          this.expect("]");
          computed = true;
        } else if (kt.k === "id") key = { t: "str", v: kt.v };
        else if (kt.k === "str") key = { t: "str", v: kt.v };
        else if (kt.k === "num") key = { t: "str", v: String(kt.v) };
        else throw new JsSyntaxError(`bad object key at line ${kt.line}`);
        if (this.eat(":")) props.push({ kind: "kv", key, computed, value: this.expr(), line: pl });
        else if (kt.k === "id") props.push({ kind: "kv", key, computed: false, value: { t: "id", name: kt.v }, line: pl });
        else throw new JsSyntaxError(`expected ':' at line ${pl}`);
      }
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return { t: "obj", props, line };
  }
}

export function parseModule(src: string): Stmt[] {
  return new Parser(tokenize(src)).program();
}

/* --------------------------------- evaluation --------------------------------- */

export interface Origin {
  module: string;
  line: number;
}

export type Val =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "tpl"; parts: (string | Val)[] }
  | ObjVal
  | { t: "arr"; items: Val[] }
  | { t: "fn"; params: Param[]; body: Node | Stmt[]; env: Env; module: string }
  | { t: "builtin"; name: string; self?: Val }
  | { t: "undef" }
  | { t: "opaque"; why: string };

export interface ObjVal {
  t: "obj";
  props: Map<string, Val>;
  origins: Map<string, Origin>;
  /**
   * Token-group naming: when set, reading a scalar member yields a reference instead of a literal.
   * "" => member names are token names ("colorNeutralForeground1"); "grey" => "grey.<key>".
   */
  group?: string;
}

export interface Env {
  vars: Map<string, Val>;
  parent: Env | null;
}

const lookup = (env: Env | null, name: string): Val | undefined => {
  for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
  return undefined;
};

export interface ModuleHost {
  /** Source of a package-relative module path ("lib/global/colors.js"), or null if unavailable. */
  source(path: string): string | null;
  /**
   * Decide the token-group naming of an exported object or scalar.
   * Return undefined for plain containers.
   */
  groupFor(module: string, exportName: string, value: Val): string | undefined;
  /** Imported scalar bindings that should stay references (global color constants). */
  scalarRef(module: string, exportName: string): string | null;
  /** Known theme token names: an object whose keys are all token names reads as a token map. */
  isTokenName?(name: string): boolean;
}

export interface ModuleRecord {
  path: string;
  exports: Map<string, Val>;
  warnings: string[];
}

export function resolveSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const scalar = (v: Val) => v.t === "str" || v.t === "num" || v.t === "tpl" || v.t === "ref";

export class Interpreter {
  readonly modules = new Map<string, ModuleRecord>();
  readonly warnings: string[] = [];
  private steps = 0;
  private loading = new Set<string>();
  private tokenMaps = new WeakMap<ObjVal, boolean>();
  constructor(
    private host: ModuleHost,
    private budget = 2_000_000,
  ) {}

  private tick() {
    if (++this.steps > this.budget) throw new Error("evaluation budget exceeded");
  }

  load(path: string): ModuleRecord {
    const cached = this.modules.get(path);
    if (cached) return cached;
    const rec: ModuleRecord = { path, exports: new Map(), warnings: [] };
    this.modules.set(path, rec);
    if (this.loading.has(path)) return rec;
    this.loading.add(path);
    const src = this.host.source(path);
    if (src === null) {
      rec.warnings.push(`${path}: source unavailable`);
      this.warnings.push(`${path}: source unavailable`);
      return rec;
    }
    let stmts: Stmt[];
    try {
      stmts = parseModule(src);
    } catch (e) {
      const msg = `${path}: ${(e as Error).message}`;
      rec.warnings.push(msg);
      this.warnings.push(msg);
      return rec;
    }
    const env: Env = { vars: new Map(), parent: null };
    const localExports: { exported: string; local: string }[] = [];
    for (const s of stmts) {
      try {
        this.execTop(s, env, rec, localExports);
      } catch (e) {
        const msg = `${path}: ${(e as Error).message}`;
        rec.warnings.push(msg);
        this.warnings.push(msg);
      }
    }
    for (const { exported, local } of localExports) {
      const v = env.vars.get(local);
      if (v) rec.exports.set(exported, this.tagGroup(path, exported, v));
    }
    this.loading.delete(path);
    return rec;
  }

  private tagGroup(module: string, name: string, v: Val): Val {
    if (v.t === "obj" && v.group === undefined) {
      const g = this.host.groupFor(module, name, v);
      if (g !== undefined) v.group = g;
    }
    return v;
  }

  private execTop(s: Stmt, env: Env, rec: ModuleRecord, localExports: { exported: string; local: string }[]) {
    switch (s.t) {
      case "import": {
        const target = resolveSpecifier(rec.path, s.from);
        if (!target) {
          for (const n of s.names) env.vars.set(n.local, { t: "opaque", why: `external module ${s.from}` });
          return;
        }
        const m = this.load(target);
        for (const n of s.names) {
          const v = m.exports.get(n.imported);
          if (v && scalar(v)) {
            const ref = this.host.scalarRef(target, n.imported);
            env.vars.set(n.local, ref ? { t: "ref", name: ref } : v);
          } else env.vars.set(n.local, v ?? { t: "opaque", why: `${target} does not export ${n.imported}` });
        }
        return;
      }
      case "reexport": {
        const target = resolveSpecifier(rec.path, s.from);
        if (!target) return;
        const m = this.load(target);
        for (const n of s.names) {
          const v = m.exports.get(n.local);
          if (v) rec.exports.set(n.exported, v);
        }
        return;
      }
      case "exportList":
        localExports.push(...s.names);
        return;
      case "const": {
        const v = this.eval(s.init, env, rec.path);
        env.vars.set(s.name, v);
        if (s.exported) localExports.push({ exported: s.name, local: s.name });
        return;
      }
      default:
        this.exec(s, env, rec.path);
    }
  }

  /** Execute a statement in a function/module body. Returns a value for `return`. */
  private exec(s: Stmt, env: Env, module: string): Val | null {
    this.tick();
    switch (s.t) {
      case "const":
        env.vars.set(s.name, this.eval(s.init, env, module));
        return null;
      case "assign": {
        if (s.target.t !== "member") throw new Error(`unsupported assignment target at line ${s.line}`);
        const obj = this.eval(s.target.obj, env, module);
        const key = this.key(s.target.prop, s.target.computed, env, module);
        if (obj.t !== "obj" || key === null) throw new Error(`unsupported assignment at line ${s.line}`);
        obj.props.set(key, this.eval(s.value, env, module));
        obj.origins.set(key, { module, line: s.line });
        return null;
      }
      case "return":
        return this.eval(s.value, env, module);
      case "expr":
        this.eval(s.value, env, module);
        return null;
      default:
        throw new Error(`unsupported statement ${s.t} inside a function`);
    }
  }

  private key(prop: Node, computed: boolean, env: Env, module: string): string | null {
    if (!computed && prop.t === "str") return prop.v;
    const v = this.eval(prop, env, module);
    if (v.t === "str") return v.v;
    if (v.t === "num") return String(v.v);
    return null;
  }

  /** Objects without an explicit group whose keys are all theme token names (e.g. generateColorTokens() results). */
  private isTokenMap(obj: ObjVal): boolean {
    const hit = this.tokenMaps.get(obj);
    if (hit !== undefined) return hit;
    const isName = this.host.isTokenName;
    const r = !!isName && obj.props.size > 0 && [...obj.props.keys()].every((k) => isName.call(this.host, k));
    this.tokenMaps.set(obj, r);
    return r;
  }

  /** Member read, turning token-group scalars into references. */
  private member(obj: Val, key: string): Val {
    if (obj.t === "obj") {
      const v = obj.props.get(key);
      if (!v) return { t: "undef" };
      const group = obj.group ?? (this.isTokenMap(obj) ? "" : undefined);
      if (group !== undefined && scalar(v)) return { t: "ref", name: group ? `${group}.${key}` : key };
      return v;
    }
    if (obj.t === "str") {
      if (key === "length") return { t: "num", v: obj.v.length };
      if (["slice", "toUpperCase", "toLowerCase", "substring", "charAt"].includes(key)) return { t: "builtin", name: `str.${key}`, self: obj };
    }
    if (obj.t === "arr") {
      if (key === "length") return { t: "num", v: obj.items.length };
      if (/^\d+$/.test(key)) return obj.items[Number(key)] ?? { t: "undef" };
      if (["reduce", "map"].includes(key)) return { t: "builtin", name: `arr.${key}`, self: obj };
    }
    if (obj.t === "builtin" && obj.name === "Object" && ["assign", "entries", "keys"].includes(key)) return { t: "builtin", name: `Object.${key}` };
    return { t: "opaque", why: `member ${key} of ${obj.t}` };
  }

  private concat(a: Val, b: Val): Val {
    const parts = (v: Val): (string | Val)[] => (v.t === "str" ? [v.v] : v.t === "num" ? [String(v.v)] : v.t === "tpl" ? v.parts : [v]);
    return normTpl([...parts(a), ...parts(b)]);
  }

  eval(n: Node, env: Env, module: string): Val {
    this.tick();
    switch (n.t) {
      case "num":
        return { t: "num", v: n.v };
      case "str":
        return { t: "str", v: n.v };
      case "tpl": {
        const parts: (string | Val)[] = [];
        for (const p of n.parts) {
          if (typeof p === "string") parts.push(p);
          else {
            const v = this.eval(p, env, module);
            if (v.t === "str") parts.push(v.v);
            else if (v.t === "num") parts.push(String(v.v));
            else if (v.t === "tpl") parts.push(...v.parts);
            else parts.push(v);
          }
        }
        return normTpl(parts);
      }
      case "id": {
        if (n.name === "Object") return { t: "builtin", name: "Object" };
        if (n.name === "undefined") return { t: "undef" };
        return lookup(env, n.name) ?? { t: "opaque", why: `unbound ${n.name}` };
      }
      case "member": {
        const obj = this.eval(n.obj, env, module);
        const key = this.key(n.prop, n.computed, env, module);
        if (key === null) return { t: "opaque", why: "non-literal member key" };
        return this.member(obj, key);
      }
      case "bin": {
        const l = this.eval(n.l, env, module);
        const r = this.eval(n.r, env, module);
        if (n.op === "+") {
          if (l.t === "num" && r.t === "num") return { t: "num", v: l.v + r.v };
          return this.concat(l, r);
        }
        return { t: "opaque", why: `operator ${n.op}` };
      }
      case "obj": {
        const out: ObjVal = { t: "obj", props: new Map(), origins: new Map() };
        for (const p of n.props) {
          if (p.kind === "spread") {
            const v = this.eval(p.arg, env, module);
            if (v.t !== "obj") {
              this.warnings.push(`${module}:${p.line}: spread of non-object (${v.t === "opaque" ? v.why : v.t})`);
              continue;
            }
            for (const [k, val] of v.props) {
              // Spreading a token map keeps the values as authored (not references to the map itself).
              out.props.set(k, val);
              out.origins.set(k, v.origins.get(k) ?? { module, line: p.line });
            }
          } else {
            const key = this.key(p.key, p.computed, env, module);
            if (key === null) {
              this.warnings.push(`${module}:${p.line}: non-literal object key`);
              continue;
            }
            out.props.set(key, this.eval(p.value, env, module));
            out.origins.set(key, { module, line: p.line });
          }
        }
        return out;
      }
      case "arr":
        return { t: "arr", items: n.items.map((x) => this.eval(x, env, module)) };
      case "fn":
        return { t: "fn", params: n.params, body: n.body, env, module };
      case "call": {
        const callee = this.eval(n.callee, env, module);
        const args = n.args.map((a) => this.eval(a, env, module));
        return this.call(callee, args);
      }
      case "unsupported":
        return { t: "opaque", why: n.what };
    }
  }

  call(fn: Val, args: Val[]): Val {
    this.tick();
    if (fn.t === "builtin") return this.builtin(fn, args);
    if (fn.t !== "fn") return { t: "opaque", why: `call of ${fn.t === "opaque" ? fn.why : fn.t}` };
    const env: Env = { vars: new Map(), parent: fn.env };
    fn.params.forEach((p, i) => {
      const a = args[i];
      if (p.kind === "id") env.vars.set(p.name, a && a.t !== "undef" ? a : p.def ? this.eval(p.def, fn.env, fn.module) : { t: "undef" });
      else p.names.forEach((nm, k) => env.vars.set(nm, a?.t === "arr" ? (a.items[k] ?? { t: "undef" }) : { t: "undef" }));
    });
    if (!Array.isArray(fn.body)) return this.eval(fn.body as Node, env, fn.module);
    for (const s of fn.body as Stmt[]) {
      const r = this.exec(s, env, fn.module);
      if (s.t === "return") return r ?? { t: "undef" };
    }
    return { t: "undef" };
  }

  private builtin(fn: Extract<Val, { t: "builtin" }>, args: Val[]): Val {
    const self = fn.self;
    const num = (v: Val | undefined) => (v?.t === "num" ? v.v : undefined);
    switch (fn.name) {
      case "str.slice":
      case "str.substring":
        return self?.t === "str" ? { t: "str", v: self.v.slice(num(args[0]) ?? 0, num(args[1])) } : { t: "opaque", why: "slice" };
      case "str.charAt":
        return self?.t === "str" ? { t: "str", v: self.v.charAt(num(args[0]) ?? 0) } : { t: "opaque", why: "charAt" };
      case "str.toUpperCase":
        return self?.t === "str" ? { t: "str", v: self.v.toUpperCase() } : { t: "opaque", why: "toUpperCase" };
      case "str.toLowerCase":
        return self?.t === "str" ? { t: "str", v: self.v.toLowerCase() } : { t: "opaque", why: "toLowerCase" };
      case "arr.reduce": {
        if (self?.t !== "arr" || !args[0]) return { t: "opaque", why: "reduce" };
        let acc: Val = args[1] ?? { t: "undef" };
        self.items.forEach((item, i) => {
          acc = this.call(args[0]!, [acc, item, { t: "num", v: i }]);
        });
        return acc;
      }
      case "arr.map": {
        if (self?.t !== "arr" || !args[0]) return { t: "opaque", why: "map" };
        return { t: "arr", items: self.items.map((item, i) => this.call(args[0]!, [item, { t: "num", v: i }])) };
      }
      case "Object.assign": {
        const target = args[0];
        if (target?.t !== "obj") return { t: "opaque", why: "Object.assign target" };
        for (const src of args.slice(1)) {
          if (src.t !== "obj") continue;
          for (const [k, v] of src.props) {
            target.props.set(k, v);
            const o = src.origins.get(k);
            if (o) target.origins.set(k, o);
          }
        }
        return target;
      }
      case "Object.entries": {
        const o = args[0];
        if (o?.t !== "obj") return { t: "opaque", why: "Object.entries" };
        return { t: "arr", items: [...o.props.entries()].map(([k, v]) => ({ t: "arr", items: [{ t: "str", v: k }, v] }) as Val) };
      }
      case "Object.keys": {
        const o = args[0];
        if (o?.t !== "obj") return { t: "opaque", why: "Object.keys" };
        return { t: "arr", items: [...o.props.keys()].map((k) => ({ t: "str", v: k }) as Val) };
      }
      default:
        return { t: "opaque", why: `builtin ${fn.name}` };
    }
  }
}

function normTpl(parts: (string | Val)[]): Val {
  const merged: (string | Val)[] = [];
  for (const p of parts) {
    if (typeof p === "string") {
      if (typeof merged[merged.length - 1] === "string") merged[merged.length - 1] = (merged[merged.length - 1] as string) + p;
      else merged.push(p);
    } else merged.push(p);
  }
  if (merged.every((p) => typeof p === "string")) return { t: "str", v: merged.join("") };
  return { t: "tpl", parts: merged.filter((p) => p !== "") };
}

/* ------------------------------- value rendering ------------------------------- */

export interface Rendered {
  /** Raw value as authored: literal string/number, or a string with "{token}" references. */
  raw: unknown;
  references: string[];
  /** Non-renderable parts (opaque values) encountered. */
  opaque: string[];
}

/** Render a value as an ATLAS raw value (DTCG-style brace references, composite objects kept as objects). */
export function render(v: Val): Rendered {
  const refs = new Set<string>();
  const opaque: string[] = [];
  const go = (x: Val): unknown => {
    switch (x.t) {
      case "str":
        return x.v;
      case "num":
        return x.v;
      case "ref":
        refs.add(x.name);
        return `{${x.name}}`;
      case "tpl":
        return x.parts
          .map((p) => {
            if (typeof p === "string") return p;
            const r = go(p);
            return typeof r === "string" || typeof r === "number" ? String(r) : JSON.stringify(r);
          })
          .join("");
      case "obj": {
        const o: Record<string, unknown> = {};
        for (const [k, val] of x.props) o[k] = x.group !== undefined && scalarVal(val) ? (refs.add(x.group ? `${x.group}.${k}` : k), `{${x.group ? `${x.group}.${k}` : k}}`) : go(val);
        return o;
      }
      case "arr":
        return x.items.map(go);
      case "undef":
        return null;
      default:
        opaque.push(x.t === "opaque" ? x.why : x.t);
        return null;
    }
  };
  const raw = go(v);
  return { raw, references: [...refs], opaque };
}

const scalarVal = (v: Val) => v.t === "str" || v.t === "num" || v.t === "tpl" || v.t === "ref";
