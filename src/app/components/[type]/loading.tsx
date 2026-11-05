import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading component type</span>
        <Skeleton className="mb-6 h-4 w-56" />
        <div className="grid gap-8 border-b border-border/70 pb-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-16 w-80" />
            <Skeleton className="h-5 w-full max-w-xl" />
            <Skeleton className="h-9 w-64" />
          </div>
          <div className="space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    </PageContainer>
  );
}
