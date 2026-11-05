import { afterEach, describe, expect, it } from "vitest";
import { getSearchProvider, registerSearchProvider, setSearchProviderOverride } from "@/server/search/provider";
import { search, suggest } from "@/server/search";
import type { ParsedQuery, ProviderSearchResult, SearchProvider } from "@/server/search/types";

/** A trivial in-memory provider: proves callers don't change when ATLAS_SEARCH_PROVIDER does. */
function memoryProvider(seen: ParsedQuery[]): SearchProvider {
  return {
    name: "memory",
    async upsert(docs) {
      return docs.length;
    },
    async removeStale() {
      return 0;
    },
    async search(q): Promise<ProviderSearchResult> {
      seen.push(q);
      // nothing matches until filters are relaxed, to exercise the facade's relaxation
      if (q.filters.types) return { total: 0, hits: [], facets: {} };
      return {
        total: 1,
        hits: [{ entityType: "component-type", entityId: "00000000-0000-0000-0000-000000000001", title: "Pagination", subtitle: null, url: "/components/pagination", systemSlug: null, score: 1, highlight: null, facets: {} }],
        facets: { entityType: [{ value: "component-type", count: 1 }] },
      };
    },
    async suggest(prefix) {
      return [{ title: `${prefix}!`, subtitle: null, url: "/x", entityType: "system" }];
    },
  };
}

afterEach(() => {
  delete process.env.ATLAS_SEARCH_PROVIDER;
  setSearchProviderOverride(null);
});

describe("search provider selection", () => {
  it("defaults to postgres and rejects unknown providers", () => {
    expect(getSearchProvider().name).toBe("postgres");
    process.env.ATLAS_SEARCH_PROVIDER = "typesense";
    expect(() => getSearchProvider()).toThrow(/Unknown ATLAS_SEARCH_PROVIDER "typesense"/);
  });

  it("routes the facade through a registered provider chosen by env", async () => {
    const seen: ParsedQuery[] = [];
    registerSearchProvider("memory", () => memoryProvider(seen));
    process.env.ATLAS_SEARCH_PROVIDER = "memory";
    const r = await search({ q: "pagination tokens", limit: 20, offset: 0 });
    expect(seen).toHaveLength(2); // first with the interpreted token filter, then relaxed
    expect(seen[0]!.filters.types).toEqual(["token"]);
    expect(seen[1]!.filters.types).toBeNull();
    expect(r).toMatchObject({ total: 1, interpretedFilters: { types: ["token"], relaxed: ["filters"] } });
    expect(r.hits[0]!.title).toBe("Pagination");
    expect(await suggest("abc")).toEqual([{ title: "abc!", subtitle: null, url: "/x", entityType: "system" }]);
    expect(await suggest("  ")).toEqual([]);
  });
});
