/** STUB: replaced by the material adapter workstream. */
import type { SourceAdapter } from "../types";

export const adapter: SourceAdapter = {
  id: "material",
  version: "0.0.0",
  systems: [],
  description: "not implemented",
  async discover() {
    return [];
  },
  async parse() {
    return null;
  },
  async normalize(ctx) {
    return { systemSlug: ctx.systemSlug, components: [], tokenSets: [], patterns: [], facts: null };
  },
};
