import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <PageContainer className="space-y-6">
      <div aria-busy="true" aria-live="polite" className="space-y-6">
        <span className="sr-only">Searching</span>
        <div className="space-y-4 border-b border-border/70 pb-6">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-80 max-w-full" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="hidden space-y-5 lg:block">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                {Array.from({ length: 4 }).map((__, j) => (
                  <Skeleton key={j} className="h-5 w-full" />
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-0 py-3">
                <Skeleton className="size-7 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
