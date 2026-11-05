import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/server/api/csv";
import { EXPORT_DISCLAIMER, exportMeta, exportMetaLines } from "@/server/api/meta";

describe("csvCell", () => {
  it("quotes fields with commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
  });
  it("renders null/undefined as empty and keeps numbers/booleans", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("true");
  });
  it("neutralises spreadsheet formula injection in strings only", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("=a,b")).toBe(`"'=a,b"`);
  });
  it("joins arrays and serializes dates/objects", () => {
    expect(csvCell(["react", "vue"])).toBe("react | vue");
    expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("toCsv", () => {
  it("writes # metadata lines, a header and CRLF rows", () => {
    const out = toCsv([{ n: "Button", u: "https://x.dev/a,b" }], [
      { header: "name", value: (r) => r.n },
      { header: "url", value: (r) => r.u },
    ], ["first\nline", "second"]);
    expect(out).toBe('# first line\r\n# second\r\nname,url\r\nButton,"https://x.dev/a,b"\r\n');
  });
  it("carries the ownership disclaimer in export metadata", () => {
    const m = exportMeta("systems", 3, ["n1"], new Date("2026-11-05T00:00:00Z"));
    expect(m.disclaimer).toBe(EXPORT_DISCLAIMER);
    expect(EXPORT_DISCLAIMER).toContain("not a license grant");
    const lines = exportMetaLines(m);
    expect(lines).toContain("records: 3");
    expect(lines.some((l) => l.startsWith("disclaimer: Names, trademarks and documentation belong to their owners"))).toBe(true);
    expect(lines).toContain("note: n1");
  });
});
