/**
 * Token usage of Polaris React components from the package's compiled stylesheet
 * (@shopify/polaris build/esm/styles.css). Rules are attributed to the component named by the
 * rightmost `.Polaris-<Component>` class of each selector (BEM: `.Polaris-Button--variantPrimary`,
 * `.Polaris-Button__Icon`); every `var(--p-*)` in a declaration is a usage of that Polaris token.
 * Static text scan; nothing is executed.
 */
import { findCssVarReferences } from "@/lib/tokens/refs";

export interface CssTokenUsage {
  tokenName: string;
  property: string;
}

const CLASS = /\.Polaris-([A-Z][A-Za-z0-9]*)/g;

function subjectComponent(selector: string): string | null {
  let last: string | null = null;
  for (const m of selector.matchAll(CLASS)) last = m[1]!;
  return last;
}

/** component name -> sorted unique usages (capped per component). */
export function parseReactCssUsages(css: string, cap = 200): Record<string, CssTokenUsage[]> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const byComp = new Map<string, Map<string, CssTokenUsage>>();
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    const comps = new Set(selectors.map(subjectComponent).filter((c): c is string => !!c));
    if (!comps.size) continue;
    for (const decl of m[2]!.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const property = decl.slice(0, i).trim();
      const value = decl.slice(i + 1);
      if (!property || !value.includes("var(--p-")) continue;
      for (const ref of findCssVarReferences(value)) {
        if (!ref.startsWith("--p-")) continue;
        const tokenName = ref.slice(4);
        for (const c of comps) {
          let mm = byComp.get(c);
          if (!mm) byComp.set(c, (mm = new Map()));
          mm.set(`${tokenName}|${property}`, { tokenName, property });
        }
      }
    }
  }
  const out: Record<string, CssTokenUsage[]> = {};
  for (const c of [...byComp.keys()].sort()) {
    out[c] = [...byComp.get(c)!.values()]
      .sort((a, b) => (a.tokenName === b.tokenName ? (a.property < b.property ? -1 : 1) : a.tokenName < b.tokenName ? -1 : 1))
      .slice(0, cap);
  }
  return out;
}
