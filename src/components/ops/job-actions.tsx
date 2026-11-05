import { RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelJobAction, retryJobAction } from "@/app/ops/actions";

/** Retry (failed/dead/cancelled) or Cancel (queued/running). Plain forms: no JS required. */
export function JobActions({ jobId, status, returnTo }: { jobId: string; status: string; returnTo: string }) {
  const canRetry = status === "failed" || status === "dead" || status === "cancelled";
  const canCancel = status === "queued" || status === "running";
  if (!canRetry && !canCancel) return null;
  return (
    <form action={canRetry ? retryJobAction : cancelJobAction} className="inline-flex">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {canRetry ? (
        <Button type="submit" size="xs" variant="outline" aria-label={`Retry job ${jobId.slice(0, 8)}`}>
          <RotateCcwIcon aria-hidden /> Retry
        </Button>
      ) : (
        <Button type="submit" size="xs" variant="outline" className="hover:text-destructive" aria-label={`Cancel job ${jobId.slice(0, 8)}`}>
          <XIcon aria-hidden /> Cancel
        </Button>
      )}
    </form>
  );
}
