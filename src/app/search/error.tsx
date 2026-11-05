"use client";

import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function SearchError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <EmptyState
        icon={AlertTriangleIcon}
        title="Search failed"
        description={
          <>
            The search index couldn&apos;t answer this query. Browsing the directory still works.{" "}
            {error.digest && <span className="font-mono text-xs">ref {error.digest}</span>}
          </>
        }
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={reset}>
              Try again
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/systems">Browse systems</Link>
            </Button>
          </div>
        }
      />
    </PageContainer>
  );
}
