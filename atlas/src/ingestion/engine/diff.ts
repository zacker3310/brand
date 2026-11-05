/**
 * Field-level diff summaries for change_event.field_changes. Compares the previously published
 * normalized payload with the new one. Evidence and volatile keys are ignored.
 */
import type { FieldChange } from "@/lib/contracts";
import { stableStringify } from "@/lib/utils";
import { contentHash } from "./hash";

type Rec = Record<string, unknown>;

const IGNORED = new Set(["evidence"]);

/** Identity of array items per field, so diffs report added/removed/changed members. */
const ITEM_KEYS: Record<string, (item: Rec) => string> = {
  variants: (i) => `${i.axis ?? "variant"}:${i.name}`,
  states: (i) => String(i.name),
  properties: (i) => `${i.implementation ?? "default"}:${i.name}`,
  examples: (i) => String(i.slug),
  frameworks: (i) => String(i.slug),
  relationships: (i) => `${i.kind}:${i.targetSlug ?? i.targetType ?? ""}`,
  tokenUsages: (i) => `${i.tokenName}:${i.property ?? ""}`,
  tokens: (i) => String(i.name),
  principles: (i) => String(i.name),
};

const MAX_LIST = 8;
const MAX_SCALAR = 200;

function bounded(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_SCALAR ? `${v.slice(0, MAX_SCALAR - 1)}…` : v;
  if (v === undefined) return null;
  if (v && typeof v === "object") {
    const s = stableStringify(v);
    return s.length > MAX_SCALAR ? `${s.slice(0, MAX_SCALAR - 1)}…` : v;
  }
  return v;
}

const listPreview = (xs: string[]) => (xs.length > MAX_LIST ? `${xs.slice(0, MAX_LIST).join(", ")}, +${xs.length - MAX_LIST} more` : xs.join(", "));

function diffArray(field: string, before: unknown[], after: unknown[]): FieldChange | null {
  const keyFn = ITEM_KEYS[field];
  const isPrimitive = (xs: unknown[]) => xs.every((x) => x === null || typeof x !== "object");
  const key = (x: unknown) => (keyFn && x && typeof x === "object" ? keyFn(x as Rec) : stableStringify(x));
  const b = new Map(before.map((x) => [key(x), x]));
  const a = new Map(after.map((x) => [key(x), x]));
  const added = [...a.keys()].filter((k) => !b.has(k));
  const removed = [...b.keys()].filter((k) => !a.has(k));
  const changed = [...a.keys()].filter((k) => b.has(k) && contentHash(b.get(k)) !== contentHash(a.get(k)));
  if (!added.length && !removed.length && !changed.length) {
    // Same members: maybe reordered. Order is not meaningful for these lists.
    return null;
  }
  const parts: string[] = [];
  if (added.length) parts.push(`+${added.length} (${listPreview(added)})`);
  if (removed.length) parts.push(`-${removed.length} (${listPreview(removed)})`);
  if (changed.length) parts.push(`~${changed.length} (${listPreview(changed)})`);
  const change: FieldChange = { field, summary: `${field}: ${parts.join(" ")}` };
  if (isPrimitive(before) && isPrimitive(after) && before.length + after.length <= 2 * MAX_LIST) {
    change.before = before;
    change.after = after;
  } else {
    change.before = before.length;
    change.after = after.length;
  }
  return change;
}

function diffObject(field: string, before: Rec, after: Rec): FieldChange | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((k) => stableStringify(before[k] ?? null) !== stableStringify(after[k] ?? null)).sort();
  if (!changed.length) return null;
  return { field, summary: `${field}: changed ${listPreview(changed)}`, before: bounded(before), after: bounded(after) };
}

/** Compute field changes between two payloads. `before === null` means the entity is new. */
export function diffPayload(before: Rec | null, after: Rec): FieldChange[] {
  if (!before) return [];
  const out: FieldChange[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !IGNORED.has(k)).sort();
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (stableStringify(b ?? null) === stableStringify(a ?? null)) continue;
    if (Array.isArray(b) || Array.isArray(a)) {
      const c = diffArray(k, Array.isArray(b) ? b : [], Array.isArray(a) ? a : []);
      if (c) out.push(c);
      else if (!Array.isArray(b) || !Array.isArray(a)) out.push({ field: k, before: bounded(b), after: bounded(a), summary: `${k}: ${b == null ? "set" : a == null ? "cleared" : "changed"}` });
      continue;
    }
    if (b && a && typeof b === "object" && typeof a === "object") {
      const c = diffObject(k, b as Rec, a as Rec);
      if (c) out.push(c);
      continue;
    }
    out.push({ field: k, before: bounded(b), after: bounded(a), summary: `${k}: ${b == null ? "set" : a == null ? "cleared" : "changed"}` });
  }
  return out;
}
