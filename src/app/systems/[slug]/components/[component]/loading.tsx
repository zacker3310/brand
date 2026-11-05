import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading component</span>
        <Skeleton className="mb-6 h-4 w-72" />
        <div className="grid gap-8 border-b border-border/70 pb-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="space-y-5">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-16 w-80" />
            <Skeleton className="h-5 w-96 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <Skeleton className="h-52 rounded-xl" />
        </div>
        <div className="mt-10 grid gap-12 lg:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="hidden space-y-2 lg:block">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <div className="space-y-10">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-28 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
