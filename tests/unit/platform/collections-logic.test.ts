import { describe, expect, it } from "vitest";
import { CollectionInput, EntityRef, ItemInput, TagsInput } from "@/components/collections/schema";
import { typeCountsText } from "@/components/collections/entity-meta";
import { ownerIdFromCookie } from "@/server/identity";
import { reorder } from "@/server/queries/collections";

describe("collection inputs", () => {
  it("trims names and nulls empty descriptions", () => {
    expect(CollectionInput.parse({ name: "  Date pickers  ", description: "" })).toEqual({ name: "Date pickers", description: null });
    expect(CollectionInput.safeParse({ name: "   " }).success).toBe(false);
    expect(CollectionInput.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("normalizes tags from a comma list", () => {
    expect(TagsInput.parse("A11y, review , review,  Needs Work")).toEqual(["a11y", "review", "needs-work"]);
    expect(TagsInput.parse(undefined)).toEqual([]);
    expect(TagsInput.safeParse("<script>").success).toBe(false);
    expect(TagsInput.safeParse(Array.from({ length: 13 }, (_, i) => `t${i}`)).success).toBe(false);
  });
  it("item input nulls empty notes", () => {
    expect(ItemInput.parse({ note: "", tags: "x" })).toEqual({ note: null, tags: ["x"] });
  });
  it("entity refs need a known type and a UUID", () => {
    expect(EntityRef.safeParse({ entityType: "component", entityId: "7a13c9de-9ab6-466a-9378-89dddd9d0842" }).success).toBe(true);
    expect(EntityRef.safeParse({ entityType: "component", entityId: "button" }).success).toBe(false);
    expect(EntityRef.safeParse({ entityType: "page", entityId: "7a13c9de-9ab6-466a-9378-89dddd9d0842" }).success).toBe(false);
  });
});

describe("reorder", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves up/down/top/bottom", () => {
    expect(reorder(ids, "c", "up")).toEqual(["a", "c", "b", "d"]);
    expect(reorder(ids, "b", "down")).toEqual(["a", "c", "b", "d"]);
    expect(reorder(ids, "d", "top")).toEqual(["d", "a", "b", "c"]);
    expect(reorder(ids, "a", "bottom")).toEqual(["b", "c", "d", "a"]);
  });
  it("is a no-op at the edges and for unknown ids", () => {
    expect(reorder(ids, "a", "up")).toEqual(ids);
    expect(reorder(ids, "d", "down")).toEqual(ids);
    expect(reorder(ids, "zz", "up")).toEqual(ids);
  });
});

describe("identity", () => {
  it("accepts only UUID cookie values", () => {
    expect(ownerIdFromCookie("11111111-1111-4111-8111-111111111111")).toBe("anon:11111111-1111-4111-8111-111111111111");
    expect(ownerIdFromCookie("ATLAS")).toBe(null);
    expect(ownerIdFromCookie("11111111-1111-4111-8111-111111111111; drop")).toBe(null);
    expect(ownerIdFromCookie(undefined)).toBe(null);
  });
});

describe("typeCountsText", () => {
  it("lists non-zero counts in a stable order with plurals", () => {
    expect(typeCountsText({ token: 1, system: 3, component: 0 })).toBe("3 design systems · 1 token");
    expect(typeCountsText({})).toBe("");
  });
});
