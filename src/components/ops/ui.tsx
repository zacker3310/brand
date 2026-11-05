import { CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { cn, formatCount, relativeTime } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Status pills                                                                 */
/* -------------------------------------------------------------------------- */

type Tone = "ok" | "active" | "warn" | "bad" | "muted" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "border-verified/25 bg-verified-soft text-verified",
  active: "border-info/25 bg-info-soft text-info",
  warn: "border-inferred/30 bg-inferred-soft text-inferred",
  bad: "border-conflicting/30 bg-conflicting-soft text-conflicting",
  muted: "border-dashed border-unavailable/40 bg-transparent text-unavailable",
  neutral: "border-border bg-muted text-muted-foreground",
};

const STATUS_TONE: Record<string, Tone> = {
  // runs
  pending: "neutral",
  running: "active",
  succeeded: "ok",
  partial: "warn",
  failed: "bad",
  cancelled: "muted",
  // jobs
  queued: "neutral",
  dead: "bad",
  // ingestion status
  indexed: "ok",
  metadata_only: "neutral",
  not_started: "muted",
  blocked: "bad",
  unsupported: "muted",
  // registry
  verified: "ok",
  rejected: "bad",
  duplicate: "warn",
  replaced: "muted",
  candidate: "neutral",
  // validation
  valid: "ok",
  warning: "warn",
  invalid: "bad",
  conflict: "bad",
  // severity
  error: "bad",
  // documents
  active_doc: "ok",
  gone: "muted",
};

export function StatusPill({ status, className, label }: { status: string; className?: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", TONE[tone], className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full bg-current", status === "running" && "animate-pulse")} />
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout bits                                                                  */
/* -------------------------------------------------------------------------- */

export function Tile({
  label,
  value,
  hint,
  href,
  tone,
  className,
}: {
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  href?: string;
  tone?: "bad" | "warn" | "ok";
  className?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-1.5 text-2xl font-semibold tracking-tight",
          tone === "bad" && "text-conflicting",
          tone === "warn" && "text-inferred",
          tone === "ok" && "text-verified",
        )}
      >
        {typeof value === "number" ? formatCount(value) : value}
      </p>
      {hint && <div className="mt-1 text-[11px] text-subtle-foreground">{hint}</div>}
    </>
  );
  const cls = cn("block rounded-xl border bg-card p-4 transition-colors", href && "hover:border-foreground/20 focus-visible:border-ring", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal scroll container for wide tables; first column can be made sticky with `stickyFirst`. */
export function TableFrame({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto rounded-xl border bg-card focus-visible:outline-2", className)}>
      {children}
    </div>
  );
}

export const th = "h-9 px-3 text-left align-middle text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase";
export const td = "px-3 py-2.5 align-top text-[13px]";
export const stickyCell = "sticky left-0 z-[1] bg-card shadow-[1px_0_0_var(--border)]";

export function Meter({ value, max, className, tone = "neutral", label }: { value: number; max: number; className?: string; tone?: "neutral" | "ok" | "warn" | "bad"; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "neutral" && "bg-foreground/60",
          tone === "ok" && "bg-verified",
          tone === "warn" && "bg-inferred",
          tone === "bad" && "bg-conflicting",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Time({ at, className, fallback = "never" }: { at: string | null; className?: string; fallback?: string }) {
  if (!at) return <span className={cn("text-subtle-foreground", className)}>{fallback}</span>;
  return (
    <time dateTime={at} title={new Date(at).toISOString().replace("T", " ").slice(0, 19) + " UTC"} className={cn("whitespace-nowrap", className)}>
      {relativeTime(at)}
    </time>
  );
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rs).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function Mono({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn("font-mono text-[12px]", className)} title={title}>
      {children}
    </span>
  );
}

export function ShortId({ id, href }: { id: string; href?: string }) {
  const s = <Mono title={id}>{id.slice(0, 8)}</Mono>;
  return href ? (
    <Link href={href} className="hover:underline">
      {s}
    </Link>
  ) : (
    s
  );
}

/* -------------------------------------------------------------------------- */
/* Notices (flash via ?notice=, whitelisted)                                   */
/* -------------------------------------------------------------------------- */

const NOTICES: Record<string, { tone: "ok" | "info" | "bad"; text: (p: Record<string, string>) => string }> = {
  retried: { tone: "ok", text: (p) => `Job ${p.job?.slice(0, 8) ?? ""} requeued with attempts reset. The worker will pick it up.` },
  "retry-deduped": { tone: "info", text: (p) => `Another live job already holds this job's dedupe key; showing job ${p.job?.slice(0, 8) ?? ""} instead.` },
  "retry-refused": { tone: "bad", text: () => "Only failed, dead or cancelled jobs can be retried." },
  cancelled: { tone: "ok", text: (p) => `Job ${p.job?.slice(0, 8) ?? ""} cancelled. A running handler stops at its next heartbeat; published records are untouched.` },
  "cancel-refused": { tone: "bad", text: () => "Only queued or running jobs can be cancelled." },
  "job-missing": { tone: "bad", text: () => "That job no longer exists." },
  resolved: { tone: "ok", text: (p) => `Marked ${p.n ?? "0"} error${p.n === "1" ? "" : "s"} resolved.` },
  reopened: { tone: "ok", text: () => "Error reopened." },
  enqueued: { tone: "ok", text: (p) => `Run ${p.run?.slice(0, 8) ?? ""} enqueued for ${p.system ?? "the system"}. It starts when a worker (npm run worker) claims it.` },
  "enqueue-deduped": { tone: "info", text: (p) => `${p.system ?? "This system"} already has an active run (${p.run?.slice(0, 8) ?? ""}); nothing new was enqueued.` },
  "no-adapter": { tone: "bad", text: (p) => `No ingestion adapter handles ${p.system ?? "this system"}; it stays indexed at metadata level.` },
  invalid: { tone: "bad", text: () => "The request was invalid." },
};

export function OpsNotice({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const code = typeof sp.notice === "string" ? sp.notice : null;
  const n = code ? NOTICES[code] : null;
  if (!n) return null;
  const params = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const Icon = n.tone === "ok" ? CheckCircle2Icon : n.tone === "bad" ? CircleAlertIcon : InfoIcon;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        n.tone === "ok" && "border-verified/25 bg-verified-soft text-foreground",
        n.tone === "info" && "border-info/25 bg-info-soft text-foreground",
        n.tone === "bad" && "border-conflicting/30 bg-conflicting-soft text-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", n.tone === "ok" ? "text-verified" : n.tone === "bad" ? "text-conflicting" : "text-info")} aria-hidden />
      {n.text(params)}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination (links; works without JS)                                         */
/* -------------------------------------------------------------------------- */

export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="tabular">
        {formatCount(from)}–{formatCount(to)} of {formatCount(total)}
      </span>
      <span className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 hover:text-foreground" rel="prev">
            <ChevronLeftIcon className="size-3.5" aria-hidden /> Prev
          </Link>
        ) : (
          <span className="inline-flex h-7 items-center gap-1 rounded-md border px-2 opacity-40" aria-disabled="true">
            <ChevronLeftIcon className="size-3.5" aria-hidden /> Prev
          </span>
        )}
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 hover:text-foreground" rel="next">
            Next <ChevronRightIcon className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <span className="inline-flex h-7 items-center gap-1 rounded-md border px-2 opacity-40" aria-disabled="true">
            Next <ChevronRightIcon className="size-3.5" aria-hidden />
          </span>
        )}
      </span>
    </nav>
  );
}

/** Build a query string from params, dropping empties. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

export function pageParam(v: string | string[] | undefined): number {
  const n = Number(one(v));
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export function SectionTitle({ children, count, id, description, actions }: { children: React.ReactNode; count?: number; id?: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="space-y-0.5">
        <h2 id={id} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {children}
          {count !== undefined && <span className="tabular font-mono text-xs font-normal text-subtle-foreground">{formatCount(count)}</span>}
        </h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
