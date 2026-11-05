/**
 * Static scan of @primer/react's compiled CSS modules (dist/<Component>/*.css) for CSS custom
 * property usages (`var(--token, fallback)`). Text processing only; nothing is evaluated.
 */

export interface CssVarUsage {
  varName: string; // "--button-default-bgColor-rest"
  property: string; // "background-color" (or a custom property it feeds)
}

export function parseCssVarUsages(css: string): CssVarUsage[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const seen = new Set<string>();
  const out: CssVarUsage[] = [];
  for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of block[1]!.split(";")) {
      const idx = decl.indexOf(":");
      if (idx <= 0) continue;
      const property = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1);
      if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(property)) continue;
      for (const m of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        const varName = m[1]!;
        const key = `${varName}|${property}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ varName, property });
      }
    }
  }
  out.sort((a, b) => a.varName.localeCompare(b.varName) || a.property.localeCompare(b.property));
  return out;
}
