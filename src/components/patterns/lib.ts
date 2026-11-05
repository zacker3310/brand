/**
 * Pure helpers for the Pattern Library.
 */
import { classifyPatternName } from "@/lib/taxonomy";

export interface ClassificationInfo {
  state: "verified" | "inferred" | "unverified";
  label: string;
  /** How the mapping was made (reconstructed with the same deterministic classifier the engine uses). */
  detail: string;
}

/**
 * The engine maps patterns to a type either because the adapter declared it, or with the deterministic
 * name classifier (classifyPatternName). The method is not stored on the row, so it is re-derived here:
 * if re-running the classifier yields the stored type, that is the method; otherwise the adapter declared it.
 */
export function classificationInfo(p: { name: string; classificationState: string; type: { slug: string; name: string } | null }): ClassificationInfo {
  if (!p.type) {
    return {
      state: "unverified",
      label: "Unclassified",
      detail: "Not mapped to an ATLAS pattern type: the name matched no type in the taxonomy and the source does not declare one.",
    };
  }
  if (p.classificationState === "verified") {
    return { state: "verified", label: "Verified", detail: `Mapped to ${p.type.name} because the source itself identifies the pattern.` };
  }
  const cls = classifyPatternName(p.name);
  if (cls && cls.slug === p.type.slug) {
    return {
      state: "inferred",
      label: "Inferred",
      detail: `Mapped to ${p.type.name} by ATLAS name matching (${cls.method}). This is a heuristic, not a claim made by the source.`,
    };
  }
  return { state: "inferred", label: "Inferred", detail: `Mapped to ${p.type.name} by the ingestion adapter. Treat as a heuristic, not a source claim.` };
}

/** "https://primer.style/product/scenario-patterns/copy/" -> "product / scenario-patterns" (the docs section). */
export function docsSection(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return parts.slice(0, -1).join(" / ");
  } catch {
    return null;
  }
}

/** First sentence(s) up to n characters, cut at a word boundary. */
export function excerpt(text: string | null | undefined, n = 180): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > n * 0.6 ? at : n).replace(/[,;:.\s]+$/, "")}…`;
}

export const patternTypeHref = (slug: string) => `/patterns/${encodeURIComponent(slug)}`;
export const patternHref = (system: string, slug: string) => `/systems/${encodeURIComponent(system)}/patterns/${encodeURIComponent(slug)}`;
export const componentHref = (system: string, slug: string) => `/systems/${encodeURIComponent(system)}/components/${encodeURIComponent(slug)}`;
