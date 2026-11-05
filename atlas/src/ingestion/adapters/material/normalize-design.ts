/**
 * material-design (Material Design 3, m3.material.io) component modeling.
 *
 * m3.material.io is client-rendered, so each component record carries only what the server
 * HTML states (title -> name, meta description -> description, page URL) plus links to the
 * official M3 component tokens (token database export shipped in material-web). Interaction
 * states come from the token groups the M3 token files name explicitly ("(Hovered)",
 * "(Disabled)", ...). The association token file -> M3 component is an ATLAS mapping, so the
 * tokens/states coverage is "inferred". Everything else is marked "not-extracted".
 */
import type { CoverageState, EvidenceInput, NormalizedComponent } from "@/lib/contracts";

type NormalizedState = NormalizedComponent["states"][number];
type CoverageMap = Record<string, CoverageState>;
import { canonicalState } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { titleMatchesSlug, type M3PageMeta } from "./m3-html";
import { classifyName } from "./normalize-web";
import { clip, evidence, sortBy, uniq, type Prov } from "./shared";

/**
 * ATLAS mapping from M3 token file stem (minus "md-comp-"/"md-") to the M3 component page slug.
 * Ordered: first matching prefix wins. Unlisted stems (banner, data-table, scrim, select,
 * autocomplete, menu-button, bottom-app-bar, sheet-floating, drag-handle, test-table) stay
 * unlinked rather than guessed.
 */
export const M3_TOKEN_STEM_TO_COMPONENT: [RegExp, string][] = [
  [/^fab-menu/, "fab-menu"],
  [/^extended-fab/, "extended-fab"],
  [/^fab(-|$)/, "floating-action-button"],
  [/^button-group/, "button-groups"],
  [/^split-button/, "split-button"],
  [/^(filled-|filled-tonal-|outlined-)?icon-button/, "icon-buttons"],
  [/^outlined-segmented-button/, "segmented-buttons"],
  [/^(button(-|$)|elevated-button|filled-button|filled-tonal-button|outlined-button|text-button)/, "buttons"],
  [/^(top-)?app-bar/, "app-bars"],
  [/^badge/, "badges"],
  [/^(assist|filter|input|suggestion)-chip/, "chips"],
  [/^(elevated|filled|outlined)-card/, "cards"],
  [/^carousel/, "carousel"],
  [/^checkbox/, "checkbox"],
  [/^(circular-|linear-)?progress-indicator/, "progress-indicators"],
  [/^date-/, "date-pickers"],
  [/^(full-screen-)?dialog/, "dialogs"],
  [/^divider/, "divider"],
  [/^(filled|outlined)-text-field/, "text-fields"],
  [/^list(-|$)/, "lists"],
  [/^loading-indicator/, "loading-indicator"],
  [/^menus?(-|$)/, "menus"],
  [/^nav(igation)?-bar/, "navigation-bar"],
  [/^nav(igation)?-rail/, "navigation-rail"],
  [/^navigation-drawer/, "navigation-drawer"],
  [/^(plain|rich)-tooltip/, "tooltips"],
  [/^(primary|secondary)-navigation-tab/, "tabs"],
  [/^radio-button/, "radio-button"],
  [/^search-(bar|view)/, "search"],
  [/^sheet-bottom/, "bottom-sheets"],
  [/^sheet-side/, "side-sheets"],
  [/^slider/, "sliders"],
  [/^snackbar/, "snackbar"],
  [/^switch/, "switch"],
  [/^time-(input|picker)/, "time-pickers"],
  [/^toolbar/, "toolbars"],
];

export function m3ComponentForStem(stem: string): string | null {
  if (!/^md-(comp-)?/.test(stem) || /^md-(ref|sys)-/.test(stem)) return null;
  const rest = stem.replace(/^md-(comp-)?/, "");
  for (const [re, slug] of M3_TOKEN_STEM_TO_COMPONENT) if (re.test(rest)) return slug;
  return null;
}

/** Interaction-state names from M3 token group labels ("Color / Focused - Selected" -> Focused, Selected). */
export function statesFromGroups(groups: string[]): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    for (const part of g.split(/\s*\/\s*|\s+-\s+/)) {
      const p = part.replace(/\[Deprecated\]\s*/gi, "").trim();
      if (p && canonicalState(p.toLowerCase())) out.add(p);
    }
  }
  return [...out];
}

export interface M3PageInput {
  prov: Prov;
  slug: string;
  meta: M3PageMeta;
  tabs: string[];
}

export interface M3TokenLink {
  stem: string;
  prov: Prov;
  names: string[];
  groups: string[];
}

function titleCase(slug: string) {
  const s = slug.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalizeM3Components(pages: M3PageInput[], links: M3TokenLink[]): { components: NormalizedComponent[]; warnings: string[] } {
  const warnings: string[] = [];
  const byComponent = new Map<string, M3TokenLink[]>();
  for (const l of sortBy(links, (x) => x.stem)) {
    const c = m3ComponentForStem(l.stem);
    if (!c) continue;
    byComponent.set(c, [...(byComponent.get(c) ?? []), l]);
  }
  const components: NormalizedComponent[] = [];
  for (const p of sortBy(pages, (x) => x.slug)) {
    const ev: EvidenceInput[] = [];
    const coverage: CoverageMap = {
      description: "not-extracted",
      variants: "not-extracted",
      states: "not-extracted",
      sizes: "not-extracted",
      properties: "not-extracted",
      accessibility: "not-extracted",
      keyboard: "not-extracted",
      responsive: "not-extracted",
      tokens: "not-extracted",
      examples: "not-extracted",
      frameworks: "not-extracted",
      relationships: "not-extracted",
    };
    const titleOk = !!p.meta.name && titleMatchesSlug(p.meta.name, p.slug);
    const name = titleOk ? p.meta.name! : titleCase(p.slug);
    if (!titleOk) warnings.push(`m3 ${p.slug}: page title "${p.meta.title}" does not match URL; name taken from URL slug, description withheld`);
    ev.push(
      evidence(p.prov, "*", "m3-html-meta", {
        location: `${p.prov.file} <title>`,
        title: p.meta.title,
        excerpt: titleOk ? p.meta.title : `URL slug ${p.slug} (page title did not match)`,
        state: titleOk ? "verified" : "inferred",
        confidence: titleOk ? 0.95 : 0.6,
      }),
    );
    let description: string | null = null;
    if (titleOk && p.meta.description) {
      description = clip(p.meta.description, 280);
      coverage.description = "documented";
      ev.push(evidence(p.prov, "description", "m3-html-meta", { location: `${p.prov.file} <meta name=description>`, excerpt: description }));
    }
    const links = byComponent.get(p.slug) ?? [];
    const tokenUsages = uniq(links.flatMap((l) => l.names))
      .sort()
      .map((tokenName) => ({ tokenName, property: null }));
    const states: NormalizedState[] = [];
    if (links.length) {
      coverage.tokens = "inferred";
      for (const l of links) {
        ev.push(
          evidence(l.prov, "tokens", "m3-sass-vars", {
            location: l.prov.file,
            excerpt: `${l.names.length} tokens linked to ${p.slug} by ATLAS file mapping (${l.stem})`,
            state: "inferred",
            confidence: 0.85,
          }),
        );
      }
      // One state per canonical meaning; M3 files label the same state "Focus"/"Focused" etc.,
      // so keep the label used by the most token files (ties: alphabetical).
      const tally = new Map<string, { label: string; files: M3TokenLink[] }[]>();
      for (const l of links) {
        for (const label of statesFromGroups(l.groups)) {
          const canon = canonicalState(label.toLowerCase()) ?? label.toLowerCase();
          const arr = tally.get(canon) ?? [];
          const rec = arr.find((r) => r.label === label);
          if (rec) rec.files.push(l);
          else arr.push({ label, files: [l] });
          tally.set(canon, arr);
        }
      }
      for (const [canon, arr] of tally) {
        const best = [...arr].sort((a, b) => b.files.length - a.files.length || (a.label < b.label ? -1 : 1))[0]!;
        const allFiles = uniq(arr.flatMap((r) => r.files.map((f) => f.stem)));
        states.push({
          name: best.label,
          canonical: canon,
          description: clip(`State named in M3 component token groups (${allFiles.length} file${allFiles.length > 1 ? "s" : ""}, e.g. ${allFiles[0]}).`, 300),
          sourceUrl: best.files[0]!.prov.sourceUrl,
        });
      }
      if (states.length) {
        coverage.states = "inferred";
        ev.push(
          evidence(links[0]!.prov, "states", "m3-sass-vars", {
            location: links.map((l) => l.prov.file).join(", ").slice(0, 400),
            excerpt: `Token groups name states: ${states.map((s) => s.name).join(", ")}`,
            state: "inferred",
            confidence: 0.8,
          }),
        );
      }
    }
    const cls = classifyName(name);
    components.push({
      slug: slugify(p.slug),
      name,
      aliases: [],
      description,
      docsUrl: p.prov.sourceUrl,
      sourceCodeUrl: null,
      lifecycle: "unknown",
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
      frameworks: [],
      variants: [],
      states: sortBy(states, (s) => s.name),
      sizes: null,
      properties: [],
      accessibility: null,
      examples: [],
      relationships: [],
      tokenUsages,
      responsiveGuidance: null,
      coverage,
      evidence: ev,
    });
  }
  return { components, warnings };
}
