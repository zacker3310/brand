/** Regression tests for shared-code fixes requested by the phase C audits (docs/audit/deep-1.md, deep-2.md). */
import { describe, expect, it } from "vitest";
import { sentencesMatching } from "@/ingestion/adapters/govuk/docs";
import { classifyPatternName } from "@/lib/taxonomy";
import { toCssColor } from "@/lib/tokens/color";

describe("audit follow-ups", () => {
  it("toCssColor strips float noise from scaled channels (deep-1: Primer hsl strings)", () => {
    expect(toCssColor({ colorSpace: "hsl", components: [4.3, 26.2, 42], hex: "#87534f" })).toBe("hsl(4.3 26.2% 42%)");
    expect(toCssColor("oklch(0.7 0.1 120)")).toBe("oklch(0.7 0.1 120)");
  });

  it("'Confirmation pages' (end-of-transaction pages) is not a dialog pattern (deep-1)", () => {
    expect(classifyPatternName("Confirmation pages")?.slug).not.toBe("dialogs-and-confirmation");
    expect(classifyPatternName("Confirmation dialog")?.slug).toBe("dialogs-and-confirmation");
  });

  it("a bare list item is not accessibility guidance (deep-2 R1: NHS footer)", () => {
    expect(sentencesMatching(["accessibility"], /accessib\w*/i, 6)).toEqual([]);
    expect(sentencesMatching(["Make sure the footer links are accessible to keyboard users."], /accessib\w*/i, 6)).toHaveLength(1);
  });
});
