"use client";

import { useCommandPalette } from "@/components/shell/command-palette";
import { Kbd } from "@/components/ui/kbd";

/** "or press ⌘K" hint that also opens the palette when clicked. */
export function PaletteHint() {
  const { setOpen } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground"
      aria-keyshortcuts="Meta+K Control+K"
    >
      or press <Kbd className="font-mono">⌘K</Kbd> anywhere to jump to a system, component or token
    </button>
  );
}
