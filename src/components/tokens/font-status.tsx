"use client";

import { useEffect, useState } from "react";

/**
 * Reports whether the first family of a font stack is available on this device. ATLAS does not load
 * design systems' font files, so specimens render in whatever the browser resolves; this says which.
 * Detection compares text metrics against generic fallbacks (a heuristic; labelled as such).
 */
const cache = new Map<string, boolean>();

function detect(family: string): boolean {
  const hit = cache.get(family);
  if (hit !== undefined) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlli1WQ@#";
  const quoted = `"${family.replace(/"/g, "")}"`;
  let available = false;
  for (const base of ["monospace", "serif", "sans-serif"]) {
    ctx.font = `72px ${base}`;
    const w0 = ctx.measureText(sample).width;
    ctx.font = `72px ${quoted}, ${base}`;
    const w1 = ctx.measureText(sample).width;
    if (Math.abs(w1 - w0) > 0.5) {
      available = true;
      break;
    }
  }
  cache.set(family, available);
  return available;
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|inherit|initial|math|emoji)$/i;

export function FontStatus({ family }: { family: string | null }) {
  const [state, setState] = useState<"unknown" | "available" | "missing">("unknown");
  useEffect(() => {
    if (!family || GENERIC.test(family)) return;
    const run = () => setState(detect(family) ? "available" : "missing");
    if (document.fonts?.ready) void document.fonts.ready.then(run);
    else run();
  }, [family]);
  if (!family) return null;
  if (GENERIC.test(family)) return <span className="text-[11px] text-muted-foreground">Generic family; rendered by your browser.</span>;
  if (state === "unknown") return <span className="text-[11px] text-muted-foreground">Rendered with fonts available on this device.</span>;
  if (state === "available") return <span className="text-[11px] text-muted-foreground">{family} is available on this device.</span>;
  return (
    <span className="text-[11px] text-inferred">
      {family} is not installed here; a fallback from the stack is shown. <span className="text-muted-foreground">(detected by text metrics)</span>
    </span>
  );
}
