import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-8" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading patterns</span>
        <div className="space-y-3 border-b border-border/70 pb-8">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-12 w-72 max-w-full" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
