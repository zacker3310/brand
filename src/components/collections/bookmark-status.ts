"use client";

/**
 * Client-side bookmark state cache. Many BookmarkButtons can render on one page (catalog lists);
 * their initial-state lookups are batched into one GET /api/bookmarks/status request per tick,
 * and toggles are broadcast so every button for the same entity stays in sync.
 */
import type { EntityType } from "./schema";

type Listener = (bookmarked: boolean) => void;

const known = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();
let pending = new Map<string, ((v: boolean | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

export const refKey = (entityType: EntityType, entityId: string) => `${entityType}:${entityId}`;

async function flush() {
  timer = null;
  const batch = pending;
  pending = new Map();
  const keys = [...batch.keys()];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    let result: Record<string, boolean> | null = null;
    try {
      const res = await fetch(`/api/bookmarks/status?refs=${encodeURIComponent(chunk.join(","))}`, { cache: "no-store", credentials: "same-origin" });
      if (res.ok) result = ((await res.json()) as { data: Record<string, boolean> }).data;
    } catch {
      result = null;
    }
    for (const k of chunk) {
      const v = result ? !!result[k] : null;
      if (v !== null) known.set(k, v);
      for (const cb of batch.get(k) ?? []) cb(v);
    }
  }
}

/** Resolves to the bookmark state, or null when it could not be determined. */
export function loadBookmarked(key: string): Promise<boolean | null> {
  if (known.has(key)) return Promise.resolve(known.get(key)!);
  return new Promise((resolve) => {
    const list = pending.get(key) ?? [];
    list.push(resolve);
    pending.set(key, list);
    if (!timer) timer = setTimeout(flush, 30);
  });
}

export function setBookmarked(key: string, v: boolean) {
  known.set(key, v);
  for (const l of listeners.get(key) ?? []) l(v);
}

export function subscribeBookmarked(key: string, l: Listener): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(l);
  listeners.set(key, set);
  return () => set.delete(l);
}
