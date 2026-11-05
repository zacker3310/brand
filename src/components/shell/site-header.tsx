import Link from "next/link";
import { AtlasMark } from "./atlas-mark";
import { CommandPaletteTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <MobileNav />
        <Link href="/" className="group flex items-center gap-2 rounded-md pr-2" aria-label="ATLAS home">
          <AtlasMark className="size-5 text-foreground transition-transform duration-500 group-hover:rotate-[30deg]" />
          <span className="font-mono text-[13px] font-semibold tracking-[0.24em]">ATLAS</span>
        </Link>
        <SiteNav />
        <div className="ml-auto flex items-center gap-2">
          <CommandPaletteTrigger />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
