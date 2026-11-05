import { SourceLink } from "@/components/atlas/source-link";
import { SystemMark } from "@/components/atlas/system-mark";
import { COMPARISON_DISCLAIMER } from "@/lib/scoring/export";
import { hostname } from "@/lib/utils";

export interface CreditItem {
  slug: string;
  name: string;
  url: string | null;
  retrievedAt: string | null;
  note?: string;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** "Data from <official docs> · retrieved <date>" per system, plus the ownership disclaimer. */
export function SourcesCredit({ items }: { items: CreditItem[] }) {
  return (
    <section aria-labelledby="sources-title" className="space-y-3 border-t pt-6">
      <h2 id="sources-title" className="type-eyebrow">
        Sources
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.slug} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
            <SystemMark name={i.name} slug={i.slug} size="sm" className="size-5 text-[8px]" />
            <span className="min-w-0 leading-5">
              <span className="font-medium text-foreground/90">{i.name}</span> · Data from{" "}
              {i.url ? (
                <SourceLink href={i.url} className="text-xs">
                  {hostname(i.url) ?? i.url}
                </SourceLink>
              ) : (
                "registry research"
              )}
              {i.retrievedAt ? ` · retrieved ${fmt(i.retrievedAt)}` : " · retrieval date not recorded"}
              {i.note ? ` · ${i.note}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="max-w-3xl text-xs leading-relaxed text-subtle-foreground">{COMPARISON_DISCLAIMER}</p>
    </section>
  );
}
