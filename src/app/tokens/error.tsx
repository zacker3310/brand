"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function TokensError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <EmptyState
        icon={AlertTriangleIcon}
        title="The token explorer could not load"
        description={
          <>
            Token data could not be read from the catalog. Nothing is shown rather than partial or stale values.{" "}
            {error.digest && <span className="font-mono text-xs">ref {error.digest}</span>}
          </>
        }
        action={
          <Button size="sm" variant="outline" onClick={() => retry()}>
            Try again
          </Button>
        }
      />
    </PageContainer>
  );
}
