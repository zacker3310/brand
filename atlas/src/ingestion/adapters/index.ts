/**
 * Adapter registry. The engine resolves adapters by id or by registry system slug.
 * Adding a system = add an adapter module and list it here. The engine is never modified.
 * Specific adapters take precedence over the generic adapter (it is listed last).
 *
 * OWNERSHIP: integrator (adapter authors own their module files only).
 */
import type { SourceAdapter } from "../types";
import { adapter as antd } from "./antd";
import { adapter as atlassian } from "./atlassian";
import { adapter as carbon } from "./carbon";
import { adapter as fluent } from "./fluent";
import { adapter as generic } from "./generic";
import { adapter as govuk } from "./govuk";
import { adapter as material } from "./material";
import { adapter as mui } from "./mui";
import { adapter as polaris } from "./polaris";
import { adapter as primer } from "./primer";
import { adapter as spectrum } from "./spectrum";

export const ADAPTERS: SourceAdapter[] = [material, carbon, primer, fluent, polaris, spectrum, atlassian, antd, mui, govuk, generic];

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

export function adapterForSystem(slug: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.systems.includes(slug));
}
