/**
 * Server-rendered, abbreviated JSON with light syntax colouring. Arrays beyond `maxItems` and long
 * strings are cut, and every cut is marked with a comment, so an example never pretends to be
 * the full response.
 */
import type { ReactNode } from "react";

interface Opts {
  maxItems: number;
  maxString: number;
  maxDepth: number;
}

const DEFAULTS: Opts = { maxItems: 2, maxString: 140, maxDepth: 7 };

const K = "text-foreground";
const S = "text-verified";
const N = "text-info";
const L = "text-inferred";
const C = "text-muted-foreground italic";
const P = "text-muted-foreground";

function render(v: unknown, depth: number, indent: string, o: Opts, out: ReactNode[], key: { n: number }) {
  const push = (cls: string, text: string) => out.push(<span key={key.n++} className={cls}>{text}</span>);
  if (v === null || v === undefined) return push(L, "null");
  if (typeof v === "boolean") return push(L, String(v));
  if (typeof v === "number") return push(N, String(v));
  if (typeof v === "string") {
    const cut = v.length > o.maxString;
    push(S, JSON.stringify(cut ? v.slice(0, o.maxString) : v));
    if (cut) push(C, ` /* +${v.length - o.maxString} chars */`);
    return;
  }
  const next = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return push(P, "[]");
    if (depth >= o.maxDepth) return push(C, `[ /* ${v.length} items */ ]`);
    push(P, "[\n");
    const shown = v.slice(0, o.maxItems);
    shown.forEach((item, i) => {
      out.push(next);
      render(item, depth + 1, next, o, out, key);
      if (i < shown.length - 1 || v.length > shown.length) push(P, ",");
      out.push("\n");
    });
    if (v.length > shown.length) {
      out.push(next);
      push(C, `/* … ${v.length - shown.length} more */`);
      out.push("\n");
    }
    out.push(indent);
    return push(P, "]");
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return push(P, "{}");
  if (depth >= o.maxDepth) return push(C, `{ /* ${entries.length} keys */ }`);
  push(P, "{\n");
  entries.forEach(([k, val], i) => {
    out.push(next);
    push(K, JSON.stringify(k));
    push(P, ": ");
    render(val, depth + 1, next, o, out, key);
    if (i < entries.length - 1) push(P, ",");
    out.push("\n");
  });
  out.push(indent);
  push(P, "}");
}

export function JsonView({ value, label, opts }: { value: unknown; label: string; opts?: Partial<Opts> }) {
  const out: ReactNode[] = [];
  render(value, 0, "", { ...DEFAULTS, ...opts }, out, { n: 0 });
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="max-h-[28rem] overflow-auto rounded-lg border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed whitespace-pre text-foreground/90 focus-visible:outline-2"
    >
      <code>{out}</code>
    </pre>
  );
}
