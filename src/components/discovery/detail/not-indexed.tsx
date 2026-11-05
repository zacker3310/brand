import Link from "next/link";
import { BoxIcon, CheckIcon, PaletteIcon, PersonStandingIcon, PuzzleIcon } from "lucide-react";
import { CoverageChip, SourceLink } from "@/components/atlas";
import type { SystemDetail } from "@/server/queries/systems";
import { checkFieldLabel, formatDate } from "../lib/format";

const KINDS = [
  { id: "components", label: "Components", icon: BoxIcon, what: "names, canonical types, variants, props, states" },
  { id: "tokens", label: "Tokens", icon: PaletteIcon, what: "token sets, themes, values and aliases" },
  { id: "patterns", label: "Patterns", icon: PuzzleIcon, what: "documented UX patterns and their components" },
  { id: "accessibility", label: "Accessibility", icon: PersonStandingIcon, what: "per-component guidance, keyboard support, ARIA patterns" },
];

/**
 * Intentional state for metadata-only systems: what has NOT been extracted (counts unknown, not
 * zero) next to what IS verified (registry checks that passed), so the page never reads as empty.
 */
export function NotIndexedPanel({ detail }: { detail: SystemDetail }) {
  const { core } = detail;
  const passed = core.registryChecks.filter((c) => c.ok);
  const failed = core.registryChecks.filter((c) => !c.ok);
  const fields = [...new Set(passed.map((c) => checkFieldLabel(c.field)))];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-xl border border-dashed p-4 sm:p-5">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Deep ingestion has not been performed for {core.name}.</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {core.adapterId
              ? `An adapter (${core.adapterId}) is assigned but has not published records yet.`
              : "No ATLAS adapter parses its official sources yet."}{" "}
            Until it does, ATLAS cannot say how many components, tokens or patterns it documents. Empty here means unknown, not none.
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <li key={k.id} id={k.id} className="hatch scroll-mt-28 rounded-lg border border-dashed bg-card/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[13px] font-medium">
                  <k.icon className="size-3.5 text-muted-foreground" aria-hidden /> {k.label}
                </span>
                <CoverageChip state="not-extracted" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{k.what}</p>
            </li>
          ))}
        </ul>
        {core.docsUrl && (
          <p className="text-xs text-muted-foreground">
            Meanwhile, the authoritative reference is the <SourceLink href={core.docsUrl}>official documentation</SourceLink>.
          </p>
        )}
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
        <h3 className="text-xs font-medium text-muted-foreground">What is verified</h3>
        <p className="text-sm">
          <span className="tabular text-2xl font-semibold tracking-tight">{passed.length}</span>
          <span className="text-muted-foreground"> of {core.registryChecks.length} registry checks passed</span>
          {core.lastVerifiedAt && <span className="block text-xs text-muted-foreground">last run {formatDate(core.lastVerifiedAt)}</span>}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <li key={f} className="inline-flex items-center gap-1 rounded-md border border-verified/25 bg-verified-soft px-1.5 py-0.5 text-[11px] text-verified">
              <CheckIcon className="size-3" aria-hidden /> {f}
            </li>
          ))}
        </ul>
        {failed.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {failed.length} check{failed.length === 1 ? "" : "s"} could not be confirmed ({[...new Set(failed.map((c) => checkFieldLabel(c.field)))].join(", ")}); those facts are shown
            as unavailable.
          </p>
        )}
        <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">
          Each fact&apos;s evidence is listed in <a href="#overview" className="underline underline-offset-2 hover:text-foreground">Overview</a>. Browse{" "}
          <Link href="/systems?depth=indexed" className="underline underline-offset-2 hover:text-foreground">
            deeply indexed systems
          </Link>{" "}
          for component-level data.
        </p>
      </div>
    </div>
  );
}
