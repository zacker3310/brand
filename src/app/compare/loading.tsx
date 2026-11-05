import { PageContainer } from "@/components/atlas/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Matrix-shaped skeleton: header, toolbar, sticky column header and grouped rows. */
export default function CompareLoading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite" className="space-y-8">
        <span className="sr-only">Loading comparison</span>
        <div className="space-y-3 border-b border-border/70 pb-8">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-9 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="hidden lg:block">
          <div className="grid grid-cols-[13rem_repeat(3,minmax(0,1fr))] gap-px overflow-hidden rounded-lg border bg-border">
            {Array.from({ length: 4 * 9 }).map((_, i) => (
              <div key={i} className="bg-background p-3">
                <Skeleton className={i % 4 === 0 ? "h-4 w-24" : i < 4 ? "h-9 w-40" : "h-4 w-3/4"} />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 lg:hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
