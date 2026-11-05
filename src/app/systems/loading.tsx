import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function SystemsLoading() {
  return (
    <PageContainer className="space-y-6">
      <div aria-busy="true" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading design systems</span>
        <div className="space-y-3 border-b border-border/70 pb-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-12 w-72 max-w-full" />
          <Skeleton className="h-4 w-[34rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
        <div className="flex gap-3">
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="hidden h-9 w-56 rounded-lg sm:block" />
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[232px_minmax(0,1fr)]">
          <div className="hidden space-y-6 lg:block">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                {Array.from({ length: 4 }).map((__, j) => (
                  <Skeleton key={j} className="h-5 w-full" />
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 w-48" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-xl border p-4">
                  <div className="flex gap-3">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
