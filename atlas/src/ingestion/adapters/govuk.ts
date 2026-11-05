/** STUB: replaced by the govuk adapter workstream. */
import type { SourceAdapter } from "../types";

export const adapter: SourceAdapter = {
  id: "govuk",
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
