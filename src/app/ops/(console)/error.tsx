"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function OpsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <EmptyState
      icon={AlertTriangleIcon}
      title="This operations view failed to load"
      description={
        <>
          The query behind it errored; nothing was changed. Check the server log{error.digest ? <> for <span className="font-mono text-xs">ref {error.digest}</span></> : null}.
        </>
      }
      action={
        <Button size="sm" variant="outline" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}
