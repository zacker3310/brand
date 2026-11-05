import { LogOutIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { PageContainer } from "@/components/atlas";
import { OpsNav } from "@/components/ops/ops-nav";
import { Button } from "@/components/ui/button";
import { getAdminAccess } from "@/server/admin";
import { opsOverview } from "@/server/queries/ops";
import { logoutAction } from "../actions";

export const metadata: Metadata = {
  title: { default: "Operations", template: "%s · Operations · ATLAS" },
  robots: { index: false, follow: false },
};

/**
 * Chrome for the internal console. Authorization is NOT done here (layouts don't re-run on
 * client navigation): every page calls requireAdminPage() and every action requireAdmin().
 * The layout only renders data when access is granted.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminAccess();
  const o = access.ok ? await opsOverview() : null;
  const attention = o
    ? {
        "/ops/errors": o.errors.openErrors,
        "/ops/queue": (o.jobs.failed ?? 0) + (o.jobs.dead ?? 0),
        "/ops/quarantine": o.quarantined,
      }
    : undefined;
  return (
    <PageContainer className="pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="type-eyebrow text-muted-foreground">Internal · Operations</p>
          {access.ok && (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              {access.mode === "token" ? <ShieldCheckIcon className="size-3 text-verified" aria-hidden /> : <ShieldAlertIcon className="size-3 text-inferred" aria-hidden />}
              {access.mode === "token" ? "Signed in with admin token" : "Localhost access (no token)"}
            </span>
          )}
        </div>
        {access.ok && access.mode === "token" && (
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              <LogOutIcon aria-hidden /> Sign out
            </Button>
          </form>
        )}
      </div>
      {access.ok && access.mode === "localhost" && (
        <div role="note" className="mb-5 flex items-start gap-2.5 rounded-lg border border-inferred/30 bg-inferred-soft px-3 py-2.5 text-sm">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-inferred" aria-hidden />
          <p>
            <span className="font-medium">ATLAS_ADMIN_TOKEN is not set.</span>{" "}
            <span className="text-foreground/80">
              Operations is open to loopback requests only, a development convenience that trusts request headers. Set the token before exposing this server; production refuses admin access without it.
            </span>
          </p>
        </div>
      )}
      {access.ok && <OpsNav counts={attention} />}
      <div className="pt-8">{children}</div>
    </PageContainer>
  );
}
