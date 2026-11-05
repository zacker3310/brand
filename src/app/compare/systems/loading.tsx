import { PageContainer } from "@/components/atlas/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function SystemCompareLoading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-live="polite" className="space-y-8">
        <span className="sr-only">Scoring systems</span>
        <div className="space-y-3 border-b border-border/70 pb-8">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-12 w-[28rem] max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="overflow-hidden rounded-xl border">
          {Array.from({ length: 9 }).map((_, r) => (
            <div key={r} className="grid grid-cols-[10rem_repeat(3,minmax(0,1fr))] gap-4 border-b p-3 last:border-b-0 sm:grid-cols-[14rem_repeat(4,minmax(0,1fr))]">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 4 }).map((_, c) => (
                <div key={c} className={c === 3 ? "hidden space-y-2 sm:block" : "space-y-2"}>
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-1 w-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
