/**
 * Adapter registry. The engine resolves adapters by id or by registry system slug.
 * Adding a system = add an adapter module and list it here. The engine is never modified.
 *
 * OWNERSHIP: integrator (adapter authors own their module files only).
 */
import type { SourceAdapter } from "../types";
import { adapter as carbon } from "./carbon";
import { adapter as material } from "./material";
import { adapter as primer } from "./primer";

export const ADAPTERS: SourceAdapter[] = [material, carbon, primer].filter((a) => a.systems.length > 0);

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

export function adapterForSystem(slug: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.systems.includes(slug));
}
