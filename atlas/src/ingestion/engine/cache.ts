/**
 * Body cache access for the engine. Bodies live only in PoliteFetcher's content-addressed disk
 * cache (never in the database). When an adapter.fetch override returns a body that did not pass
 * through PoliteFetcher.get, the engine writes it to the same layout so parse can re-read it.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheDir, getFetcher } from "./config";

function cachePath(hash: string): string | null {
  const dir = cacheDir();
  return dir ? path.join(dir, hash.slice(0, 2), hash) : null;
}

export async function ensureCached(hash: string, body: string): Promise<void> {
  const p = cachePath(hash);
  if (!p) return;
  try {
    await stat(p);
    return;
  } catch {
    // missing: write below
  }
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, body, "utf8");
}

export async function readCachedBody(hash: string): Promise<string | null> {
  const viaFetcher = await getFetcher().readCache(hash);
  if (viaFetcher !== null) return viaFetcher;
  const p = cachePath(hash);
  if (!p) return null;
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}
