import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading collection</span>
        <Skeleton className="h-4 w-40" />
        <div className="space-y-3 border-b pb-8">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-96 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
        <div className="divide-y rounded-xl border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-4">
              <Skeleton className="size-7 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
