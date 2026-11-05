/**
 * Ingestion engine facade. STUB: replaced by the engine workstream. Signatures are the contract.
 */
export interface RunOptions {
  kind?: "full" | "incremental";
  triggeredBy?: string;
  limit?: number;
  dryRun?: boolean;
}

export async function enqueueSystemRun(_systemSlug: string, _opts: RunOptions = {}): Promise<{ runId: string; jobId: string }> {
  throw new Error("engine not implemented");
}
