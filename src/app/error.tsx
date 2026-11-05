"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <EmptyState
        icon={AlertTriangleIcon}
        title="Something went wrong loading this view"
        description={
          <>
            The catalog data couldn&apos;t be loaded. {error.digest && <span className="font-mono text-xs">ref {error.digest}</span>}
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
