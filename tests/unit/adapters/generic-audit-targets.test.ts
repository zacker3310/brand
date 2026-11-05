/**
 * Regression checks for the target-config fixes of the generic inventory audit (docs/audit/generic.md).
 * Pure config semantics (no network): include/exclude matching and display-name choice under each
 * system's current target.
 */
import { describe, expect, it } from "vitest";
import { chooseName, compileTarget, humanizeSegment, matchOne } from "@/ingestion/adapters/generic/extract";
import { GENERIC_TARGETS } from "@/ingestion/adapters/generic/targets";
import type { GenericTarget } from "@/ingestion/adapters/generic/types";

const target = (slug: string): GenericTarget => {
  const t = GENERIC_TARGETS.find((x) => x.slug === slug);
  if (!t) throw new Error(`no generic target ${slug}`);
  return t;
};

describe("generic audit fixes: vuetify", () => {
  const t = target("vuetify");
  const c = compileTarget(t);
  const dir = "packages/docs/src/pages/en/components";

  it("includes the Data tables section through its introduction page only", () => {
    expect(matchOne(`${dir}/data-tables/introduction.md`, c)).toBe("data-tables");
    expect(matchOne(`${dir}/data-tables/basics.md`, c)).toBeNull();
    expect(matchOne(`${dir}/data-tables/server-side-tables.md`, c)).toBeNull();
    expect(matchOne(`${dir}/buttons.md`, c)).toBe("buttons");
  });

  it("excludes the components index and the disabled month date-picker page", () => {
    expect(matchOne(`${dir}/all.md`, c)).toBeNull();
    expect(matchOne(`${dir}/date-pickers-month.md`, c)).toBeNull();
    expect(matchOne(`${dir}/date-pickers.md`, c)).toBe("date-pickers");
  });

  it("names the Data tables page without its section suffix", () => {
    const page = { title: null, h1: "Data table - Introduction", h1Own: null };
    expect(chooseName("data-tables", page, null, c.titleSuffix).name).toBe("Data table");
    // Other headings are untouched.
    expect(chooseName("date-pickers", { title: null, h1: "Date pickers", h1Own: null }, null, c.titleSuffix).name).toBe("Date pickers");
  });
});

describe("generic audit fixes: react-bootstrap", () => {
  const c = compileTarget(target("react-bootstrap"));

  it("does not cut 'Tabbed components' to 'Tabbed'; the Tabs page falls back to its segment", () => {
    const page = { title: "Tabbed components | React Bootstrap", h1: "Tabbed components", h1Own: null };
    expect(chooseName("tabs", page, null, c.titleSuffix).name).toBe("Tabs");
  });

  it("keeps the other page titles", () => {
    expect(chooseName("buttons", { title: "Buttons | React Bootstrap", h1: "Buttons", h1Own: null }, null, c.titleSuffix).name).toBe("Buttons");
    expect(chooseName("overlays", { title: "Overlay | React Bootstrap", h1: "Overlay", h1Own: null }, null, c.titleSuffix).name).toBe("Overlay");
  });
});

describe("generic audit fixes: Prime nav pages", () => {
  // The nav page itself is not fetched as a component page, so its own entry is named from the
  // humanized segment: it must be a component whose docs name is that humanized segment.
  it.each([
    ["primeng", "Accordion"],
    ["primereact", "Accordion"],
    ["primevue", "Accordion"],
  ])("%s navUrl is a single-word component page", (slug, name) => {
    const t = target(slug);
    const seg = matchOne(t.navUrl!, compileTarget(t));
    expect(seg).not.toBeNull();
    expect(humanizeSegment(seg!)).toBe(name);
  });
});
