import { PageContainer } from "@/components/atlas";
import { Skeleton } from "@/components/ui/skeleton";

export default function SystemDetailLoading() {
  return (
    <PageContainer className="space-y-8">
      <div aria-busy="true" aria-live="polite" className="space-y-8">
        <span className="sr-only">Loading design system</span>
        <div className="space-y-6 border-b border-border/70 pb-8">
          <Skeleton className="h-3 w-40" />
          <div className="flex items-start gap-4">
            <Skeleton className="hidden size-14 rounded-lg sm:block" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-14 w-[28rem] max-w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
            </div>
          </div>
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <div className="lg:grid lg:grid-cols-[176px_minmax(0,1fr)] lg:gap-10">
          <div className="hidden space-y-2 lg:block">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <div className="space-y-10">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-80 max-w-full" />
                <Skeleton className="h-48 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
