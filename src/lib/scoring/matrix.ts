/**
 * Builds the component comparison matrix: groups of rows, one cell per system. Pure and
 * JSON-serializable; rendered by src/components/compare/* and serialized by ./export.ts.
 *
 * Empty-cell semantics (the honesty contract):
 *  - A field with no stored value shows the field's coverage state. A field the source claims to
 *    document but for which nothing is stored is shown as "not-extracted" (unknown), never "none".
 *  - A value missing from a list the source documents (e.g. no "loading" among documented states)
 *    is "not-documented": absent documentation, not absent capability.
 *  - Columns without a component (system not indexed, or no component classified as the type) show
 *    "not-extracted" everywhere.
 */
import type { CoverageState } from "@/lib/contracts";
import { toCssColor } from "@/lib/tokens/color";
import { alignProps, compareKeys, splitKeys, STATE_ORDER } from "./align";
import type {
  CellValue,
  CompareTypeInfo,
  ComparisonColumn,
  ComponentDetail,
  ComponentMatrix,
  ComponentTokenView,
  MatrixCell,
  MatrixGroup,
  MatrixRow,
  Swatch,
} from "./types";

export const PROPS_VISIBLE = 12;
export const TOKENS_PER_CATEGORY = 6;
export const TOKEN_CATEGORY_ORDER = ["color", "typography", "spacing", "shape", "elevation", "motion", "opacity", "layout", "other"];

export const componentHref = (system: string, slug: string) => `/systems/${encodeURIComponent(system)}/components/${encodeURIComponent(slug)}`;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Value missing from a list the source documents (or ATLAS inferred): absent documentation. */
export function absentFrom(state: CoverageState): CoverageState {
  return state === "documented" || state === "inferred" ? "not-documented" : state;
}

/** Whole field has no stored value: trust the coverage state, except a "documented" claim with no data. */
export function emptyField(state: CoverageState): CoverageState {
  return state === "documented" || state === "inferred" ? "not-extracted" : state;
}

const covCell = (state: CoverageState, note?: string): MatrixCell => ({ value: { kind: "coverage", state, ...(note ? { note } : {}) }, cmp: `cov:${state}` });
const cell = (value: CellValue, cmp: string): MatrixCell => ({ value, cmp });

export function fieldCoverage(c: ComponentDetail, field: string): CoverageState {
  return c.coverage[field] ?? "not-extracted";
}

function a11yCoverage(c: ComponentDetail, sub: string, fallbackField: string): CoverageState {
  if (c.accessibility) return c.accessibility.coverage[sub] ?? (sub === "keyboard" ? fieldCoverage(c, "keyboard") : "not-extracted");
  return fieldCoverage(c, fallbackField);
}

const MISSING_NOTE: Record<string, string> = {
  "not-indexed": "ATLAS has not indexed this system's components.",
  "no-component": "No indexed component of this system is classified as this type.",
};

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Swatches for a color token: one per theme value (deduplicated), at most 4. */
export function tokenSwatches(t: ComponentTokenView): Swatch[] {
  if (t.category !== "color") return [];
  const out: Swatch[] = [];
  const push = (raw: unknown, label: string) => {
    if (out.length >= 4) return;
    const css = toCssColor(raw);
    if (css && !out.some((s) => s.css === css)) out.push({ css, label });
  };
  for (const v of t.values) {
    if (isObj(v.resolved) && "$themes" in v.resolved && isObj(v.resolved.$themes)) {
      for (const [set, raw] of Object.entries(v.resolved.$themes)) push(raw, set);
    } else {
      push(v.resolved ?? v.valueText, v.theme ?? v.set);
    }
  }
  return out;
}

function tokenValueText(t: ComponentTokenView): string | null {
  const texts = [...new Set(t.values.map((v) => v.valueText).filter((x): x is string => !!x))];
  if (!texts.length) return null;
  const firstText = texts[0]!.length > 60 ? `${texts[0]!.slice(0, 57)}…` : texts[0]!;
  return texts.length > 1 ? `${firstText} (+${texts.length - 1} theme value${texts.length > 2 ? "s" : ""})` : firstText;
}

/* -------------------------------------------------------------------------- */

interface Ctx {
  type: CompareTypeInfo;
  columns: ComparisonColumn[];
}

function row(ctx: Ctx, id: string, label: string, fn: (c: ComponentDetail, col: ComparisonColumn) => MatrixCell, extra: Partial<MatrixRow> = {}): MatrixRow {
  const cells: Record<string, MatrixCell> = {};
  for (const col of ctx.columns) {
    cells[col.system.slug] = col.component ? fn(col.component, col) : covCell("not-extracted", MISSING_NOTE[col.missing ?? "no-component"]);
  }
  const keys = Object.values(cells).map((c) => c.cmp);
  const same = ctx.columns.length >= 2 && keys.every((k) => k === keys[0]);
  return { id, label, cells, same, ...extra };
}

function group(id: string, title: string, rows: MatrixRow[], extra: Partial<MatrixGroup> = {}): MatrixGroup {
  return { id, title, rows, allSame: rows.every((r) => r.same), overflowCount: rows.filter((r) => r.overflow).length, ...extra };
}

const sortedKey = (xs: string[]) => [...new Set(xs.map(norm))].sort().join("|");
const looksLikeCode = (s: string) => /[<>{}()=]|^[a-z]+(-[a-z0-9]+)+$|^[a-z]+[A-Z]/.test(s);

function namingGroup(ctx: Ctx): MatrixGroup {
  return group("naming", "Naming", [
    row(ctx, "name", "Component name", (c, col) => cell({ kind: "link", label: c.name, href: componentHref(col.system.slug, c.slug) }, `name:${norm(c.name)}`)),
    row(ctx, "aliases", "Source terminology", (c) =>
      c.aliases.length
        ? cell({ kind: "chips", items: c.aliases.map((a) => ({ label: a })), mono: c.aliases.some(looksLikeCode) }, `al:${sortedKey(c.aliases)}`)
        : covCell("not-extracted", "No alternative names recorded from the source."),
    ),
    row(ctx, "classification", `Classified as ${ctx.type.name}`, (c) =>
      cell({ kind: "classification", state: c.classification.state, method: c.classification.method, confidence: c.classification.confidence, typeName: ctx.type.name }, `cls:${c.classification.state}`),
    ),
    row(ctx, "lifecycle", "Lifecycle", (c) => (c.lifecycle && c.lifecycle !== "unknown" ? cell({ kind: "text", text: cap(c.lifecycle) }, `lc:${c.lifecycle}`) : covCell("not-extracted"))),
  ]);
}

function descriptionGroup(ctx: Ctx): MatrixGroup {
  return group("description", "Description", [
    row(ctx, "description", "Summary", (c) =>
      c.description
        ? cell({ kind: "description", text: c.description, href: c.docsUrl, inferred: fieldCoverage(c, "description") === "inferred" }, `d:${norm(c.description)}`)
        : covCell(emptyField(fieldCoverage(c, "description"))),
    ),
  ]);
}

function variantsGroup(ctx: Ctx): MatrixGroup {
  const axisFreq = new Map<string, number>();
  for (const col of ctx.columns) for (const ax of new Set(col.component?.variants.map((v) => v.axis) ?? [])) axisFreq.set(ax, (axisFreq.get(ax) ?? 0) + 1);
  const axes = [...axisFreq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a);
  const rows: MatrixRow[] = [
    row(ctx, "variant-count", "Variants documented", (c) =>
      c.variants.length
        ? cell({ kind: "count", value: c.variants.length, detail: `${new Set(c.variants.map((v) => v.axis)).size} axis` + (new Set(c.variants.map((v) => v.axis)).size === 1 ? "" : "es") }, `vc:${c.variants.length}`)
        : covCell(emptyField(fieldCoverage(c, "variants"))),
    ),
  ];
  for (const axis of axes) {
    rows.push(
      row(
        ctx,
        `axis:${axis}`,
        cap(axis),
        (c) => {
          const vs = c.variants.filter((v) => v.axis === axis);
          const cov = fieldCoverage(c, "variants");
          if (vs.length)
            return cell(
              { kind: "chips", items: vs.map((v) => ({ label: v.name, hint: v.description ?? undefined })), inferred: cov === "inferred" },
              `ax:${sortedKey(vs.map((v) => v.name))}`,
            );
          return covCell(c.variants.length ? absentFrom(cov) : emptyField(cov));
        },
        { hint: "Variant axis as named by the source" },
      ),
    );
  }
  return group("variants", "Variants", rows, { description: "Grouped by the axis each source names (variant, type, appearance…)." });
}

function sizesGroup(ctx: Ctx): MatrixGroup {
  return group("sizes", "Sizes", [
    row(ctx, "sizes", "Sizes", (c) => {
      if (c.sizes === null) return covCell(emptyField(fieldCoverage(c, "sizes")));
      if (c.sizes.length === 0) return covCell("documented-none");
      return cell({ kind: "chips", items: c.sizes.map((s) => ({ label: s })), inferred: fieldCoverage(c, "sizes") === "inferred" }, `sz:${sortedKey(c.sizes)}`);
    }),
  ]);
}

function statesGroup(ctx: Ctx): MatrixGroup {
  const present = new Set<string>();
  let anyOther = false;
  for (const col of ctx.columns)
    for (const s of col.component?.states ?? []) {
      if (s.canonical) present.add(s.canonical);
      else anyOther = true;
    }
  const order = (s: string) => (STATE_ORDER.indexOf(s) === -1 ? 99 : STATE_ORDER.indexOf(s));
  const canon = [...present].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const rows = canon.map((st) =>
    row(
      ctx,
      `state:${st}`,
      cap(st),
      (c) => {
        const names = c.states.filter((s) => s.canonical === st);
        const cov = fieldCoverage(c, "states");
        if (names.length) return cell({ kind: "chips", items: names.map((s) => ({ label: s.name, hint: s.description ?? undefined })), inferred: cov === "inferred" }, "has");
        return covCell(c.states.length ? absentFrom(cov) : emptyField(cov));
      },
      { hint: "Canonical state" },
    ),
  );
  if (anyOther) {
    rows.push(
      row(ctx, "state:other", "Other states", (c) => {
        const others = c.states.filter((s) => !s.canonical);
        const cov = fieldCoverage(c, "states");
        if (others.length) return cell({ kind: "chips", items: others.map((s) => ({ label: s.name, hint: s.description ?? undefined })), inferred: cov === "inferred" }, `os:${sortedKey(others.map((s) => s.name))}`);
        return covCell(c.states.length ? absentFrom(cov) : emptyField(cov));
      }, { hint: "Not mapped to a canonical state" }),
    );
  }
  if (!rows.length) rows.push(row(ctx, "states", "States", (c) => covCell(emptyField(fieldCoverage(c, "states")))));
  return group("states", "States", rows, { description: "Rows are the union of canonical states; cells show each system's own state name." });
}

function apiGroup(ctx: Ctx): MatrixGroup {
  const rows: MatrixRow[] = [
    row(ctx, "implementations", "Implementations", (c) => {
      if (!c.properties.length) return covCell(emptyField(fieldCoverage(c, "properties")));
      const counts = new Map<string, number>();
      for (const p of c.properties) counts.set(p.implementation, (counts.get(p.implementation) ?? 0) + 1);
      const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([impl, n]) => ({ label: `${impl} · ${n} props` }));
      return cell({ kind: "chips", items, mono: true }, `impl:${sortedKey([...counts.keys()])}`);
    }, { hint: "Prop count per implementation" }),
  ];
  const all = ctx.columns.flatMap((col) => (col.component?.properties ?? []).map((p) => ({ ...p, system: col.system.slug })));
  const aligned = alignProps(all);
  aligned.forEach((a, i) => {
    rows.push(
      row(
        ctx,
        `prop:${a.key}`,
        a.label,
        (c, col) => {
          const entries = a.bySystem[col.system.slug];
          if (entries?.length)
            return cell(
              { kind: "props", entries: entries.map((e) => ({ implementation: e.implementation, name: e.name, type: e.type, defaultValue: e.defaultValue, required: e.required, deprecated: e.deprecated })) },
              "has",
            );
          const cov = fieldCoverage(c, "properties");
          return covCell(c.properties.length ? absentFrom(cov) : emptyField(cov));
        },
        { alignment: { method: a.method, names: a.names }, overflow: i >= PROPS_VISIBLE },
      ),
    );
  });
  return group("api", "API", rows, {
    description: "Props aligned across systems by exact or normalized name.",
    note: "Aligned by name (inferred): a shared name does not guarantee shared behaviour, and equivalent props may use different names.",
  });
}

function accessibilityGroup(ctx: Ctx): MatrixGroup {
  const a = (c: ComponentDetail) => c.accessibility;
  return group(
    "accessibility",
    "Accessibility",
    [
      row(ctx, "aria-pattern", "ARIA pattern (documented)", (c) => {
        const v = a(c)?.ariaPattern;
        return v ? cell({ kind: "text", text: v, mono: true }, `ap:${norm(v)}`) : covCell(emptyField(a11yCoverage(c, "ariaPattern", "accessibility")));
      }),
      row(ctx, "roles", "Roles", (c) => {
        const v = a(c)?.roles;
        return v?.length ? cell({ kind: "chips", items: v.map((r) => ({ label: r })), mono: true }, `ro:${sortedKey(v)}`) : covCell(emptyField(a11yCoverage(c, "roles", "accessibility")));
      }),
      row(ctx, "keyboard", "Keyboard interactions", (c) => {
        const v = a(c)?.keyboard;
        return v?.length ? cell({ kind: "keyboard", entries: v }, `kb:${v.length}`) : covCell(emptyField(a11yCoverage(c, "keyboard", "keyboard")));
      }),
      row(ctx, "guidance", "Guidance", (c) => {
        const v = a(c)?.guidance;
        return v ? cell({ kind: "description", text: v, href: a(c)?.docsUrl ?? null }, `g:${norm(v)}`) : covCell(emptyField(a11yCoverage(c, "guidance", "accessibility")));
      }),
      row(ctx, "screen-reader", "Screen reader", (c) => {
        const v = a(c)?.screenReader;
        return v ? cell({ kind: "text", text: v, clamp: true }, `sr:${norm(v)}`) : covCell(emptyField(a11yCoverage(c, "screenReader", "accessibility")));
      }),
      row(ctx, "focus", "Focus management", (c) => {
        const v = a(c)?.focusManagement;
        return v ? cell({ kind: "text", text: v, clamp: true }, `fm:${norm(v)}`) : covCell(emptyField(a11yCoverage(c, "focusManagement", "accessibility")));
      }),
      row(ctx, "wcag", "WCAG criteria", (c) => {
        const v = a(c)?.wcagCriteria;
        return v?.length ? cell({ kind: "chips", items: v.map((r) => ({ label: r })), mono: true }, `w:${sortedKey(v)}`) : covCell(emptyField(a11yCoverage(c, "wcagCriteria", "accessibility")));
      }),
    ],
    { description: "As documented by each system's accessibility guidance." },
  );
}

function tokensGroup(ctx: Ctx): MatrixGroup {
  const cats = new Set<string>();
  for (const col of ctx.columns) for (const t of col.component?.tokens ?? []) cats.add(t.category);
  const order = (c: string) => (TOKEN_CATEGORY_ORDER.indexOf(c) === -1 ? 99 : TOKEN_CATEGORY_ORDER.indexOf(c));
  const rows: MatrixRow[] = [
    row(ctx, "token-count", "Associated tokens", (c) => {
      if (!c.tokens.length) return covCell(emptyField(fieldCoverage(c, "tokens")));
      const n = new Set(c.tokens.map((t) => t.category)).size;
      return cell({ kind: "count", value: c.tokens.length, detail: `${n} categor${n === 1 ? "y" : "ies"}` }, `tc:${c.tokens.length}`);
    }),
  ];
  for (const cat of [...cats].sort((a, b) => order(a) - order(b))) {
    rows.push(
      row(ctx, `tokens:${cat}`, `${cap(cat)} tokens`, (c, col) => {
        const ts = c.tokens.filter((t) => t.category === cat).sort((a, b) => a.name.localeCompare(b.name));
        const cov = fieldCoverage(c, "tokens");
        if (!ts.length) return covCell(c.tokens.length ? absentFrom(cov) : emptyField(cov));
        return cell(
          {
            kind: "tokens",
            total: ts.length,
            shown: ts.slice(0, TOKENS_PER_CATEGORY).map((t) => ({
              name: t.name,
              valueText: tokenValueText(t),
              swatches: tokenSwatches(t),
              aliasState: t.values[0]?.aliasState ?? null,
              properties: t.properties.slice(0, 3),
            })),
            moreHref: ts.length > TOKENS_PER_CATEGORY ? `${componentHref(col.system.slug, c.slug)}#tokens` : null,
          },
          "has",
        );
      }),
    );
  }
  return group("tokens", "Design tokens", rows, { description: "Tokens each source associates with the component, with resolved values per theme." });
}

function interactionGroup(ctx: Ctx): MatrixGroup {
  const keyboardOf = (c: ComponentDetail | null) => c?.accessibility?.keyboard ?? [];
  const keys = new Set<string>();
  for (const col of ctx.columns) for (const k of keyboardOf(col.component)) for (const key of splitKeys(k.keys)) keys.add(key);
  const apg: MatrixRow = {
    id: "apg",
    label: "Reference pattern",
    hint: "ATLAS reference (WAI-ARIA APG)",
    span: ctx.type.ariaPattern
      ? { kind: "text", text: ctx.type.ariaPattern, mono: true, meta: `WAI-ARIA Authoring Practices pattern ATLAS maps to ${ctx.type.name}. A reference, not a claim by any system.` }
      : { kind: "text", text: "No APG pattern mapped", meta: `ATLAS does not map ${ctx.type.name} to a WAI-ARIA Authoring Practices pattern.` },
    cells: {},
    same: true,
  };
  const rows: MatrixRow[] = [apg];
  for (const key of [...keys].sort(compareKeys)) {
    rows.push(
      row(ctx, `key:${key}`, key, (c) => {
        const entries = keyboardOf(c).filter((k) => splitKeys(k.keys).includes(key));
        if (entries.length) return cell({ kind: "keyboard", entries: dedupeKeyboard(entries) }, "has");
        const cov = a11yCoverage(c, "keyboard", "keyboard");
        return covCell(keyboardOf(c).length ? absentFrom(cov) : emptyField(cov));
      }, { hint: "Documented key" }),
    );
  }
  if (rows.length === 1) {
    rows.push(row(ctx, "keys", "Documented keys", (c) => covCell(emptyField(a11yCoverage(c, "keyboard", "keyboard")))));
  }
  return group("interaction", "Interaction conventions", rows, { description: "Documented keyboard behaviour aligned by key (key alignment is an ATLAS inference)." });
}

function dedupeKeyboard(entries: { keys: string; action: string }[]) {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = norm(e.action);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function responsiveGroup(ctx: Ctx): MatrixGroup {
  return group("responsive", "Responsive guidance", [
    row(ctx, "responsive", "Responsive behaviour", (c) =>
      c.responsiveGuidance ? cell({ kind: "text", text: c.responsiveGuidance, clamp: true }, `rg:${norm(c.responsiveGuidance)}`) : covCell(emptyField(fieldCoverage(c, "responsive"))),
    ),
  ]);
}

function frameworksGroup(ctx: Ctx): MatrixGroup {
  return group("frameworks", "Frameworks", [
    row(ctx, "frameworks", "Implementations", (c) =>
      c.frameworks.length
        ? cell(
            { kind: "chips", items: c.frameworks.map((f) => ({ label: f.name, hint: [f.packageName, f.importName].filter(Boolean).join(" · ") || undefined })) },
            `fw:${sortedKey(c.frameworks.map((f) => f.slug))}`,
          )
        : covCell(emptyField(fieldCoverage(c, "frameworks"))),
    ),
  ]);
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function docsGroup(ctx: Ctx): MatrixGroup {
  return group("docs", "Documentation links", [
    row(ctx, "docs", "Component docs", (c) => (c.docsUrl ? cell({ kind: "link", label: host(c.docsUrl), href: c.docsUrl }, "has") : covCell("not-extracted"))),
    row(ctx, "a11y-docs", "Accessibility docs", (c) =>
      c.accessibility?.docsUrl ? cell({ kind: "link", label: host(c.accessibility.docsUrl), href: c.accessibility.docsUrl }, "has") : covCell(emptyField(fieldCoverage(c, "accessibility"))),
    ),
    row(ctx, "source", "Source code", (c) => (c.sourceCodeUrl ? cell({ kind: "link", label: host(c.sourceCodeUrl), href: c.sourceCodeUrl }, "has") : covCell("not-extracted"))),
    row(ctx, "examples", "Examples", (c) => {
      const counts = Object.entries(c.exampleCounts).filter(([, n]) => n > 0);
      if (!counts.length) return covCell(emptyField(fieldCoverage(c, "examples")));
      const linked = c.examples.filter((e) => e.url);
      const meta = counts.map(([k, n]) => `${n} ${k.replace(/-/g, " ")}${n === 1 ? "" : "s"}`).join(" · ");
      return cell({ kind: "links", links: linked.slice(0, 3).map((e) => ({ label: e.title, href: e.url! })), meta }, "has");
    }),
  ]);
}

function evidenceGroup(ctx: Ctx): MatrixGroup {
  return group("evidence", "Evidence", [
    row(ctx, "evidence", "Evidence records", (c) =>
      cell({ kind: "count", value: c.evidence.count, detail: `${c.evidence.sources} source URL${c.evidence.sources === 1 ? "" : "s"}` }, `ev:${c.evidence.count}`),
    ),
    row(ctx, "retrieved", "Last retrieved", (c) =>
      c.evidence.lastRetrievedAt ? cell({ kind: "text", text: c.evidence.lastRetrievedAt.slice(0, 10), mono: true, meta: c.evidence.hosts.join(", ") || undefined }, `rt:${c.evidence.lastRetrievedAt.slice(0, 10)}`) : covCell("not-extracted"),
    ),
    row(ctx, "methods", "Extraction methods", (c) =>
      c.evidence.methods.length ? cell({ kind: "chips", items: c.evidence.methods.map((m) => ({ label: m })), mono: true }, `em:${sortedKey(c.evidence.methods)}`) : covCell("not-extracted"),
    ),
  ]);
}

export function buildComponentMatrix(type: CompareTypeInfo, columns: ComparisonColumn[]): ComponentMatrix {
  const ctx: Ctx = { type, columns };
  const groups = [
    namingGroup(ctx),
    descriptionGroup(ctx),
    variantsGroup(ctx),
    sizesGroup(ctx),
    statesGroup(ctx),
    apiGroup(ctx),
    accessibilityGroup(ctx),
    tokensGroup(ctx),
    interactionGroup(ctx),
    responsiveGroup(ctx),
    frameworksGroup(ctx),
    docsGroup(ctx),
    evidenceGroup(ctx),
  ];
  const rows = groups.flatMap((g) => g.rows).filter((r) => !r.span);
  return { columns: columns.map((c) => c.system.slug), groups, rowCount: rows.length, differingRowCount: rows.filter((r) => !r.same).length };
}
