import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { catalogHref, PAGE_SIZE, pageWindow, type CatalogParams } from "./lib/params";

export function CatalogPagination({ params, total }: { params: CatalogParams; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const page = Math.min(params.page, pages);
  const item = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] tabular transition-colors";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-2">
      <p className="tabular text-xs text-muted-foreground">
        Page {page} of {pages}
      </p>
      <ul className="flex items-center gap-1">
        <li>
          {page > 1 ? (
            <Link href={catalogHref(params, { page: page - 1 })} className={cn(item, "hover:bg-accent")} aria-label="Previous page">
              <ChevronLeftIcon className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={cn(item, "text-muted-foreground/50")} aria-hidden>
              <ChevronLeftIcon className="size-4" />
            </span>
          )}
        </li>
        {pageWindow(page, pages).map((p, i) =>
          p === "gap" ? (
            <li key={`gap-${i}`} aria-hidden className="px-1 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={p} className="hidden sm:block">
              <Link
                href={catalogHref(params, { page: p })}
                aria-current={p === page ? "page" : undefined}
                className={cn(item, p === page ? "bg-foreground text-background" : "hover:bg-accent")}
              >
                {p}
              </Link>
            </li>
          ),
        )}
        <li>
          {page < pages ? (
            <Link href={catalogHref(params, { page: page + 1 })} className={cn(item, "hover:bg-accent")} aria-label="Next page">
              <ChevronRightIcon className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={cn(item, "text-muted-foreground/50")} aria-hidden>
              <ChevronRightIcon className="size-4" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
