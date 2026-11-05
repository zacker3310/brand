import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading the component catalog</span>
        <div className="space-y-3 border-b border-border/70 pb-8">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-14 w-72" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-2/3 max-w-xl" />
        </div>
        <div className="mt-8 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="hidden space-y-6 lg:block">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                {Array.from({ length: 4 }).map((__, j) => (
                  <Skeleton key={j} className="h-6 w-full" />
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <div className="flex gap-2.5">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-9 flex-1" />
            </div>
            <Skeleton className="h-4 w-64" />
            <div className="divide-y divide-border/60">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="grid gap-6 py-4 md:grid-cols-[15rem_minmax(0,1fr)_7rem]">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-20 md:justify-self-end" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
