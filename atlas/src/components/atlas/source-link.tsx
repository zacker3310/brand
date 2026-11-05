import { ArrowUpRightIcon } from "lucide-react";
import { cn, hostname } from "@/lib/utils";

/** External link to an official source. Always opens in a new tab with noopener/noreferrer. */
export function SourceLink({
  href,
  children,
  className,
  showHost = false,
}: {
  href: string;
  children?: React.ReactNode;
  className?: string;
  showHost?: boolean;
}) {
  const host = hostname(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("group inline-flex items-center gap-1 text-sm text-foreground/90 hover:text-foreground", className)}
    >
      <span className="link-underline">{children ?? host ?? href}</span>
      {showHost && children && host && <span className="text-xs text-muted-foreground">{host}</span>}
      <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
