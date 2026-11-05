import Link from "next/link";
import { SECONDARY_NAV } from "./nav-config";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/70">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-10 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl space-y-2">
          <p className="font-mono text-xs tracking-[0.2em] text-foreground uppercase">Atlas</p>
          <p>
            A navigational index of design systems. ATLAS stores concise, source-attributed facts and links to official
            documentation. It is not a mirror: names, trademarks and documentation belong to their owners.
          </p>
          <p className="text-xs text-subtle-foreground">
            Every published claim links to its source. Verified, inferred and missing data are labelled separately.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-5">
          {SECONDARY_NAV.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
