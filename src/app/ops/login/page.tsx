import { LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/atlas";
import { OpsLoginForm } from "@/components/ops/login-form";
import { adminMode, getAdminAccess, safeNext } from "@/server/admin";

export const metadata: Metadata = { title: "Operations sign-in", robots: { index: false, follow: false } };

export default async function OpsLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/ops");
  const reason = typeof sp.reason === "string" ? sp.reason : null;
  const mode = adminMode();
  const access = await getAdminAccess();
  if (access.ok && reason !== "signed-out") redirect(next);

  return (
    <PageContainer className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-full border bg-surface-1 text-muted-foreground">
            <LockIcon className="size-4" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground">Internal ingestion console: queue, runs, errors and data quality.</p>
        </div>
        {mode === "token" ? (
          <div className="space-y-3 rounded-xl border bg-card p-5">
            {reason === "signed-out" && <p className="text-sm text-muted-foreground" role="status">You are signed out.</p>}
            {reason === "login-required" && <p className="text-sm text-muted-foreground" role="status">Sign in to continue.</p>}
            <OpsLoginForm next={next} />
            <p className="text-xs text-muted-foreground">The session cookie is httpOnly, scoped to /ops, signed with the token and expires after 12 hours. API clients send Authorization: Bearer.</p>
          </div>
        ) : mode === "localhost" ? (
          <div className="space-y-2 rounded-xl border bg-card p-5 text-sm" role="alert">
            <p className="font-medium">Only available from this machine</p>
            <p className="text-muted-foreground">
              ATLAS_ADMIN_TOKEN is not set, so Operations answers loopback requests (localhost) only. This request did not come from a loopback address. Set
              ATLAS_ADMIN_TOKEN on the server to enable token sign-in.
            </p>
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border bg-card p-5 text-sm" role="alert">
            <p className="font-medium">Operations is disabled</p>
            <p className="text-muted-foreground">This production deployment has no ATLAS_ADMIN_TOKEN, so every admin request is refused. Set the token to enable Operations.</p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
