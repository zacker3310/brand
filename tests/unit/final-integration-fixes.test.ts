/** Regression tests for shared-code fixes requested by the phase C audits (docs/audit/deep-1.md, deep-2.md). */
import { describe, expect, it } from "vitest";
import { sentencesMatching } from "@/ingestion/adapters/govuk/docs";
import { PoliteFetcher } from "@/ingestion/http";
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

  it("an unreachable robots.txt blocks only briefly; a retry re-checks it (thumbprint re-ingest)", async () => {
    let robotsDown = true;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/robots.txt")) return new Response("unavailable", { status: robotsDown ? 503 : 404 });
      return new Response("<html><title>x</title></html>", { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const short = new PoliteFetcher({ fetchImpl, cacheDir: null, hostDelayMs: 0, robotsUnreachableTtlMs: 0 });
    expect(await short.isAllowed("https://ds.example.com/components")).toBe(false); // RFC 9309: unreachable => disallow
    robotsDown = false;
    expect(await short.isAllowed("https://ds.example.com/components")).toBe(true); // re-checked: 404 => allow all
    robotsDown = true;
    const long = new PoliteFetcher({ fetchImpl, cacheDir: null, hostDelayMs: 0, robotsUnreachableTtlMs: 60_000 });
    expect(await long.isAllowed("https://ds.example.com/components")).toBe(false);
    robotsDown = false;
    expect(await long.isAllowed("https://ds.example.com/components")).toBe(false); // still within the short TTL
  });
});
