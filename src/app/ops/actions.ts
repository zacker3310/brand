"use server";

/**
 * Ops Server Actions. Every action calls requireAdmin() first: Server Actions are reachable by
 * direct POST, so nothing relies on the page or layout having checked. None of them runs
 * ingestion: they requeue/cancel jobs (src/ingestion/engine/queue) or mark errors resolved.
 * "Enqueue run" lives in enqueue-action.ts so only /ops/systems loads the adapter registry.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { designSystems, ingestionErrors } from "@/db/schema";
import { cancel, getJob, retry } from "@/ingestion/engine/queue";
import { AdminAuthError, adminMode, adminToken, endAdminSession, requireAdmin, safeNext, startAdminSession, tokensEqual } from "@/server/admin";

const Id = z.uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

/** Back to the page the form was on, with a whitelisted notice code. */
function back(fd: FormData, notice: string, extra: Record<string, string> = {}): never {
  const to = safeNext(str(fd, "returnTo"));
  const u = new URL(to, "http://x");
  u.searchParams.set("notice", notice);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  redirect(`${u.pathname}${u.search}`);
}

async function guard(fd: FormData) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) redirect(`/ops/login?next=${encodeURIComponent(safeNext(str(fd, "returnTo")))}&reason=${e.reason}`);
    throw e;
  }
}

export async function retryJobAction(fd: FormData): Promise<void> {
  await guard(fd);
  const id = Id.safeParse(str(fd, "jobId"));
  if (!id.success) back(fd, "invalid");
  const before = await getJob(id.data);
  if (!before) back(fd, "job-missing");
  const job = await retry(id.data);
  revalidatePath("/ops", "layout");
  if (!job) back(fd, "retry-refused", { job: id.data });
  back(fd, job.id === id.data ? "retried" : "retry-deduped", { job: job.id });
}

export async function cancelJobAction(fd: FormData): Promise<void> {
  await guard(fd);
  const id = Id.safeParse(str(fd, "jobId"));
  if (!id.success) back(fd, "invalid");
  const ok = await cancel(id.data);
  revalidatePath("/ops", "layout");
  back(fd, ok ? "cancelled" : "cancel-refused", { job: id.data });
}

const ErrorGroupInput = z.object({
  system: z.string().regex(/^(_none|[a-z0-9][a-z0-9-]{0,99})$/),
  stage: z.string().min(1).max(40),
  code: z.string().min(1).max(80),
});

/** Mark every open error in one (system, stage, code) group resolved. */
export async function resolveErrorGroupAction(fd: FormData): Promise<void> {
  await guard(fd);
  const g = ErrorGroupInput.safeParse({ system: str(fd, "system"), stage: str(fd, "stage"), code: str(fd, "code") });
  if (!g.success) back(fd, "invalid");
  const db = getDb();
  const systemCond =
    g.data.system === "_none"
      ? isNull(ingestionErrors.designSystemId)
      : eq(ingestionErrors.designSystemId, sql`(select ${designSystems.id} from ${designSystems} where ${designSystems.slug} = ${g.data.system})`);
  const rows = await db
    .update(ingestionErrors)
    .set({ resolvedAt: new Date() })
    .where(and(systemCond, eq(ingestionErrors.stage, g.data.stage), eq(ingestionErrors.code, g.data.code), isNull(ingestionErrors.resolvedAt)))
    .returning({ id: ingestionErrors.id });
  revalidatePath("/ops", "layout");
  back(fd, "resolved", { n: String(rows.length) });
}

export async function resolveErrorAction(fd: FormData): Promise<void> {
  await guard(fd);
  const id = Id.safeParse(str(fd, "errorId"));
  if (!id.success) back(fd, "invalid");
  const reopen = str(fd, "reopen") === "1";
  const rows = await getDb()
    .update(ingestionErrors)
    .set({ resolvedAt: reopen ? null : new Date() })
    .where(eq(ingestionErrors.id, id.data))
    .returning({ id: ingestionErrors.id });
  revalidatePath("/ops", "layout");
  back(fd, reopen ? "reopened" : "resolved", { n: String(rows.length) });
}

/* -------------------------------------------------------------------------- */
/* Session                                                                      */
/* -------------------------------------------------------------------------- */

export interface LoginState {
  error: string | null;
}

export async function loginAction(_prev: LoginState | null, fd: FormData): Promise<LoginState> {
  const token = adminToken();
  if (adminMode() !== "token" || !token) return { error: "Token sign-in is not enabled: ATLAS_ADMIN_TOKEN is not set on this server." };
  const presented = (str(fd, "token") ?? "").trim();
  if (!presented || !tokensEqual(presented, token)) {
    await new Promise((r) => setTimeout(r, 400)); // blunt online guessing
    return { error: "That token is not valid." };
  }
  await startAdminSession();
  redirect(safeNext(str(fd, "next")));
}

export async function logoutAction(): Promise<void> {
  await endAdminSession();
  redirect("/ops/login?reason=signed-out");
}
