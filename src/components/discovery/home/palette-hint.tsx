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
      className="hidden rounded-md text-left text-xs text-muted-foreground transition-colors hover:text-foreground sm:inline"
      aria-keyshortcuts="Meta+K Control+K"
    >
      or press <Kbd className="mx-0.5 font-mono align-[1px]">⌘K</Kbd> anywhere to jump to a system, component or token
    </button>
  );
}
