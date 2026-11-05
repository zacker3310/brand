import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading tokens</span>
        <div className="space-y-3 border-b border-border/70 pb-8">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-12 w-80 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <div className="space-y-6">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-10 w-full" />
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[9rem_1fr] gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="hidden h-96 rounded-xl xl:block" />
        </div>
      </div>
    </PageContainer>
  );
}
