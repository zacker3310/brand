"use client";

import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

/** Shared error boundary body for catalog routes. `retry` re-fetches the segment (Next 16). */
export function CatalogRouteError({
  error,
  retry,
  title,
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title: string;
  backHref: string;
  backLabel: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <EmptyState
        icon={AlertTriangleIcon}
        title={title}
        description={
          <>
            The index could not be read just now. Nothing was changed. Retry, or come back in a moment.
            {error.digest && <span className="mt-1 block font-mono text-xs text-muted-foreground">ref {error.digest}</span>}
          </>
        }
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => retry()}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={backHref}>{backLabel}</Link>
            </Button>
          </div>
        }
      />
    </PageContainer>
  );
}
