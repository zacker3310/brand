import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite" className="space-y-10">
        <span className="sr-only">Loading collections</span>
        <div className="space-y-3 border-b pb-8">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </PageContainer>
  );
}
