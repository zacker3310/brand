import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/utils";

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/**
 * Keys whose values change on every run without the underlying facts changing. They are kept in
 * stored payloads (evidence shows when a claim was retrieved) but excluded from change detection,
 * otherwise re-running an unchanged source would report every entity as updated.
 */
// contentHash: evidence carries the source page hash; live HTML pages often change bytes (build ids, nonces)
// while the extracted facts are identical. Facts drive change detection; snapshots track page changes.
const VOLATILE_KEYS = new Set(["retrievedAt", "contentHash"]);

function stripVolatile(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k) || val === undefined) continue;
      out[k] = stripVolatile(val);
    }
    return out;
  }
  return v;
}

/** sha256(stableStringify(payload)) with volatile keys removed. Deterministic across runs. */
export function contentHash(payload: unknown): string {
  return sha256(stableStringify(stripVolatile(payload)));
}

/** JSON round-trip: drops undefined, matches what jsonb storage gives back. */
export function toJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null)) as T;
}
