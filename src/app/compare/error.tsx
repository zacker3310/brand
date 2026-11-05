"use client";

import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageContainer } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";

export default function CompareError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <EmptyState
        icon={AlertTriangleIcon}
        title="The comparison couldn't be built"
        description={
          <>
            ATLAS failed to load the catalog data for this comparison. Your selection is still in the URL, so retrying or sharing it is safe.
            {error.digest && <span className="mt-1 block font-mono text-xs">ref {error.digest}</span>}
          </>
        }
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={reset}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href="/compare">Start over</Link>
            </Button>
          </div>
        }
      />
    </PageContainer>
  );
}
