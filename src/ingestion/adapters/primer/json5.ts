/**
 * Minimal, static JSON5 parser (no eval, no code execution). Primer's token sources
 * (@primer/primitives src/tokens/**.json5) use comments, unquoted keys, single-quoted strings
 * and trailing commas. No json5 dependency is available, so this implements the JSON5 value
 * grammar: objects, arrays, strings ('…' / "…" with escapes and line continuations), numbers
 * (decimal, hex, leading/trailing dot, +/-, Infinity, NaN), true/false/null, // and block comments.
 *
 * Objects are built with defineProperty so keys like "__proto__" can never alter prototypes.
 * Duplicate keys: last one wins (JSON5 / JSON.parse semantics).
 */

export class Json5SyntaxError extends Error {
  constructor(
    message: string,
    public pos: number,
    public line: number,
    public column: number,
  ) {
    super(`${message} at ${line}:${column}`);
    this.name = "Json5SyntaxError";
  }
}

const ID_START = /[A-Za-z_$ª-￿]/;
const ID_PART = /[A-Za-z0-9_$ª-￿‌‍]/;

export function parseJson5(text: string): unknown {
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const fail = (msg: string): never => {
    const before = src.slice(0, i);
    const line = before.split("\n").length;
    const column = i - before.lastIndexOf("\n");
    throw new Json5SyntaxError(msg, i, line, column);
  };

  const skip = () => {
    for (;;) {
      const c = src[i];
      if (c === undefined) return;
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f" || c === " " || c === " " || c === " " || c === "﻿") {
        i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        i += 2;
        while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) fail("Unterminated block comment");
        i = end + 2;
        continue;
      }
      return;
    }
  };

  const parseString = (): string => {
    const quote = src[i];
    i++;
    let out = "";
    for (;;) {
      const c = src[i];
      if (c === undefined) return fail("Unterminated string");
      if (c === quote) {
        i++;
        return out;
      }
      if (c === "\n" || c === "\r") fail("Unescaped line break in string");
      if (c === "\\") {
        i++;
        const e = src[i];
        i++;
        switch (e) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "v": out += "\v"; break;
          case "0":
            if (/[0-9]/.test(src[i] ?? "")) fail("Octal escapes are not allowed");
            out += "\0";
            break;
          case "x": {
            const hex = src.slice(i, i + 2);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail("Invalid \\x escape");
            out += String.fromCharCode(parseInt(hex, 16));
            i += 2;
            break;
          }
          case "u": {
            const hex = src.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape");
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          case "\r":
            if (src[i] === "\n") i++;
            break; // line continuation
          case "\n":
          case " ":
          case " ":
            break; // line continuation
          case undefined:
            fail("Unterminated string");
            break;
          default:
            if (/[1-9]/.test(e)) fail("Invalid escape");
            out += e;
        }
        continue;
      }
      out += c;
      i++;
    }
  };

  const parseIdentifier = (): string => {
    let out = "";
    const first = src[i];
    if (first === undefined || !ID_START.test(first)) fail("Expected identifier");
    while (i < src.length && ID_PART.test(src[i]!)) out += src[i++];
    return out;
  };

  const parseNumber = (): number => {
    const start = i;
    let sign = 1;
    if (src[i] === "+" || src[i] === "-") {
      if (src[i] === "-") sign = -1;
      i++;
    }
    if (src.startsWith("Infinity", i)) {
      i += 8;
      return sign * Infinity;
    }
    if (src.startsWith("NaN", i)) {
      i += 3;
      return NaN;
    }
    if (src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
      i += 2;
      const h = /^[0-9a-fA-F]+/.exec(src.slice(i));
      if (!h) fail("Invalid hex number");
      i += h![0].length;
      return sign * parseInt(h![0], 16);
    }
    const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) {
      i = start;
      fail("Invalid number");
    }
    i += m![0].length;
    return sign * Number(m![0]);
  };

  const setKey = (obj: Record<string, unknown>, key: string, value: unknown) => {
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  };

  const parseValue = (depth: number): unknown => {
    if (depth > 200) fail("Nesting too deep");
    skip();
    const c = src[i];
    if (c === undefined) return fail("Unexpected end of input");
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      skip();
      if (src[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        skip();
        const k = src[i];
        const key = k === '"' || k === "'" ? parseString() : parseIdentifier();
        skip();
        if (src[i] !== ":") fail("Expected ':'");
        i++;
        setKey(obj, key, parseValue(depth + 1));
        skip();
        if (src[i] === ",") {
          i++;
          skip();
          if (src[i] === "}") {
            i++;
            return obj;
          }
          continue;
        }
        if (src[i] === "}") {
          i++;
          return obj;
        }
        fail("Expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      skip();
      if (src[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue(depth + 1));
        skip();
        if (src[i] === ",") {
          i++;
          skip();
          if (src[i] === "]") {
            i++;
            return arr;
          }
          continue;
        }
        if (src[i] === "]") {
          i++;
          return arr;
        }
        fail("Expected ',' or ']'");
      }
    }
    if (c === '"' || c === "'") return parseString();
    if (src.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (src.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (src.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (/[0-9+\-.IN]/.test(c)) return parseNumber();
    return fail(`Unexpected character '${c}'`);
  };

  const value = parseValue(0);
  skip();
  if (i < src.length) fail("Unexpected trailing content");
  return value;
}
