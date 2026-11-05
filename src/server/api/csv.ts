/**
 * CSV serialization (RFC 4180) for ATLAS exports. Pure; unit-tested.
 *
 *  - Fields containing comma, quote, CR or LF are quoted; quotes are doubled.
 *  - Spreadsheet formula injection is neutralised: string cells starting with = + - @ TAB or CR
 *    are prefixed with an apostrophe (OWASP CSV injection guidance). Numbers are left as-is.
 *  - Arrays are joined with " | "; null/undefined become empty cells.
 *  - Optional leading metadata lines start with "# " (pandas: read_csv(..., comment="#")).
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) s = v.toISOString();
  else if (Array.isArray(v)) s = v.map((x) => (x === null || x === undefined ? "" : String(x))).join(" | ");
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], meta: string[] = []): string {
  const lines: string[] = [];
  for (const m of meta) lines.push(`# ${m.replace(/[\r\n]+/g, " ")}`);
  lines.push(columns.map((c) => csvCell(c.header)).join(","));
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function csvResponse(body: string, filename: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
