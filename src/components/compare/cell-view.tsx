import Link from "next/link";
import { CoverageChip } from "@/components/atlas/coverage-chip";
import { SourceLink } from "@/components/atlas/source-link";
import { VerificationBadge } from "@/components/atlas/verification-badge";
import type { CellValue } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";
import { INFERRED_TEXT } from "./tone";

const chipClass = "inline-flex max-w-full items-center rounded border border-border/80 bg-surface-1 px-1.5 py-0.5 text-xs leading-4 break-words";

const ALIAS_TEXT: Record<string, string> = {
  external: "references a token outside this system",
  unresolved: "alias could not be resolved",
  cycle: "circular alias",
};

function InferredMark() {
  return <VerificationBadge state="inferred" compact className={INFERRED_TEXT} detail="ATLAS inferred this value from the source (heuristic), rather than the source stating it." />;
}

/** Renders one comparison cell. Server component (interactive bits are small client leaves). */
export function CellView({ value }: { value: CellValue }) {
  switch (value.kind) {
    case "coverage":
      return <CoverageChip state={value.state} />;

    case "text":
      return (
        <div className="space-y-1">
          <p className={cn("break-words", value.mono ? "font-mono text-xs" : "text-[13px] leading-relaxed", value.clamp && "line-clamp-4")}>
            {value.text} {value.inferred && <InferredMark />}
          </p>
          {value.meta && <p className="text-xs leading-snug text-muted-foreground">{value.meta}</p>}
        </div>
      );

    case "description":
      return (
        <div className="space-y-1.5">
          <p className="line-clamp-5 text-[13px] leading-relaxed text-foreground/90">
            {value.text} {value.inferred && <InferredMark />}
          </p>
          {value.href && (
            <SourceLink href={value.href} className="text-xs text-muted-foreground">
              Source
            </SourceLink>
          )}
        </div>
      );

    case "link":
      return value.href.startsWith("/") ? (
        <Link href={value.href} className="link-underline text-[13px] font-medium break-words">
          {value.label}
        </Link>
      ) : (
        <SourceLink href={value.href} className="max-w-full text-[13px] break-all">
          {value.label}
        </SourceLink>
      );

    case "chips":
      return (
        <div className="space-y-1">
          <ul className="flex flex-wrap gap-1">
            {value.items.map((c, i) => (
              <li key={`${c.label}-${i}`} className={cn(chipClass, value.mono && "font-mono text-[11px]")} title={c.hint}>
                {c.label}
              </li>
            ))}
            {value.inferred && (
              <li className="inline-flex items-center">
                <InferredMark />
              </li>
            )}
          </ul>
          {value.meta && <p className="text-xs text-muted-foreground">{value.meta}</p>}
        </div>
      );

    case "classification":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <VerificationBadge
            state={value.state}
            className={value.state === "inferred" ? INFERRED_TEXT : undefined}
            detail={`${value.state === "verified" ? "Declared by the source" : "Inferred by ATLAS taxonomy matching"}${value.method ? ` · method ${value.method}` : ""} · confidence ${Math.round(value.confidence * 100)}%`}
          />
          <span className="tabular font-mono text-[11px] text-muted-foreground">{Math.round(value.confidence * 100)}%</span>
        </div>
      );

    case "props":
      return (
        <ul className="space-y-1.5">
          {value.entries.map((e, i) => (
            <li key={`${e.implementation}-${e.name}-${i}`} className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <code className="font-mono text-xs font-medium break-all">{e.name}</code>
                <span className="font-mono text-[10px] text-muted-foreground">{e.implementation}</span>
                {e.required && <span className="text-[10px] font-medium text-foreground/80">required</span>}
                {e.deprecated && <span className="text-[10px] font-medium text-conflicting">deprecated</span>}
              </div>
              {(e.type || e.defaultValue) && (
                <div className="font-mono text-[11px] leading-snug break-words text-muted-foreground">
                  {e.type ?? <span className="text-muted-foreground">type not documented</span>}
                  {e.defaultValue && <span className="text-foreground/70"> = {e.defaultValue}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      );

    case "keyboard":
      return (
        <ul className="space-y-1.5">
          {value.entries.slice(0, 6).map((e, i) => (
            <li key={i} className="text-[13px] leading-snug">
              {!value.hideKeys && (
                <span className="mr-1.5 inline-flex flex-wrap gap-1 align-middle">
                  {e.keys.split(/\s*\/\s*/).map((k) => (
                    <kbd key={k} className="rounded border border-border bg-surface-1 px-1 py-px font-mono text-[10px] leading-4 text-foreground/90">
                      {k}
                    </kbd>
                  ))}
                </span>
              )}
              <span className={value.hideKeys ? "text-foreground/85" : "text-muted-foreground"}>{e.action}</span>
            </li>
          ))}
          {value.entries.length > 6 && <li className="text-xs text-muted-foreground">+{value.entries.length - 6} more interactions</li>}
        </ul>
      );

    case "tokens":
      return (
        <div className="space-y-1.5">
          <ul className="space-y-1">
            {value.shown.map((t) => (
              <li key={t.name} className="flex min-w-0 items-start gap-2">
                {t.swatches.length > 0 && (
                  <span className="mt-0.5 flex shrink-0 -space-x-1" aria-hidden>
                    {t.swatches.slice(0, 3).map((s) => (
                      <span key={s.css + s.label} className="checker size-3.5 overflow-hidden rounded-full ring-1 ring-border ring-offset-0" title={`${s.label}: ${s.css}`}>
                        <span className="block size-full" style={{ background: s.css }} />
                      </span>
                    ))}
                  </span>
                )}
                <span className="min-w-0">
                  <code className="block font-mono text-[11px] leading-4 break-all text-foreground/90">{t.name}</code>
                  {t.valueText ? (
                    <span className="block font-mono text-[10.5px] leading-4 break-words text-muted-foreground">{t.valueText}</span>
                  ) : (
                    <span className="block text-[10.5px] leading-4 text-muted-foreground italic">{ALIAS_TEXT[t.aliasState ?? ""] ?? "value not resolved"}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="tabular text-xs text-muted-foreground">
            {value.total} token{value.total === 1 ? "" : "s"}
            {value.moreHref && (
              <>
                {" · "}
                <Link href={value.moreHref} className="link-underline">
                  all on component page
                </Link>
              </>
            )}
          </p>
        </div>
      );

    case "links":
      return (
        <div className="space-y-1">
          {value.meta && <p className="text-xs text-muted-foreground">{value.meta}</p>}
          <ul className="space-y-0.5">
            {value.links.map((l) => (
              <li key={l.href} className="min-w-0">
                <SourceLink href={l.href} className="max-w-full text-xs">
                  <span className="line-clamp-1 break-all">{l.label}</span>
                </SourceLink>
              </li>
            ))}
          </ul>
        </div>
      );

    case "count":
      return (
        <div className="flex items-baseline gap-2">
          <span className="tabular text-base font-semibold tracking-tight">{value.value.toLocaleString("en-US")}</span>
          {value.detail && <span className="text-xs text-muted-foreground">{value.detail}</span>}
        </div>
      );
  }
}
