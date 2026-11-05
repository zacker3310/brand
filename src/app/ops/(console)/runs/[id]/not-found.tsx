import Link from "next/link";
import { EmptyState } from "@/components/atlas";

export default function RunNotFound() {
  return (
    <EmptyState
      title="Run not found"
      description="No ingestion run has this id. It may have been removed with its system."
      action={
        <Link href="/ops/runs" className="text-sm font-medium text-primary hover:underline">
          All runs
        </Link>
      }
    />
  );
}
