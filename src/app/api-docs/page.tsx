import { DownloadIcon, FileJsonIcon } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PageContainer } from "@/components/atlas";
import { CACHE } from "@/server/api/http";
import { jsonSchemaOf } from "@/server/api/openapi";
import { API_ENDPOINTS, API_GROUPS, runExample } from "@/server/api/registry";
import type { ApiEndpoint, ResolveResult } from "@/server/api/serve";
import { cn } from "@/lib/utils";
import { CopyButton } from "./_components/copy-button";
import { JsonView } from "./_components/json-view";

export const metadata: Metadata = {
  title: "API",
  description: "The ATLAS REST API: design systems, components, tokens, patterns, collections, ingestion status and exports, with live examples.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ep = ApiEndpoint<any, any, any>;

const AUTH_LABEL = {
  public: { label: "Public", hint: "No credentials." },
  owner: { label: "Owner-scoped", hint: "Uses the atlas_owner cookie (anonymous identity) of the caller." },
  admin: { label: "Admin", hint: "Authorization: Bearer ATLAS_ADMIN_TOKEN (loopback only when the token is unset, outside production)." },
} as const;

const anchor = (ep: Ep) => `ep-${ep.id}`;
const groupId = (g: string) => `g-${g.toLowerCase().replace(/[^a-z]+/g, "-")}`;

function bodyOf(r: ResolveResult | null): unknown {
  if (!r) return null;
  if (r.kind === "list") return { data: r.data, page: r.page, pageSize: r.pageSize, total: r.total };
  if (r.kind === "item") return { data: r.data };
  if (r.kind === "not-found") return { error: { code: "not_found", message: `${r.what} is not in the ATLAS index.` } };
  if (r.kind === "error") return { error: { code: r.code, message: r.message } };
  return null;
}

async function examples(): Promise<Map<string, { body: unknown; error: string | null }>> {
  const out = new Map<string, { body: unknown; error: string | null }>();
  await Promise.all(
    API_ENDPOINTS.filter((e) => e.example).map(async (ep) => {
      try {
        out.set(ep.id, { body: bodyOf(await runExample(ep)), error: null });
      } catch (e) {
        console.error(`[api-docs] example ${ep.id} failed`, e);
        out.set(ep.id, { body: null, error: "The live example could not be captured right now." });
      }
    }),
  );
  return out;
}

export default async function ApiDocsPage() {
  await connection();
  const ex = await examples();
  const capturedAt = new Date();
  const byGroup = API_GROUPS.map((g) => ({ group: g, eps: API_ENDPOINTS.filter((e) => e.group === g) })).filter((g) => g.eps.length);

  return (
    <PageContainer>
      <header className="border-b pb-10">
        <div className="max-w-3xl space-y-4">
        <p className="type-eyebrow">Developers</p>
        <h1 className="type-display text-4xl sm:text-6xl">REST API</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          The same data, labels and provenance as the site, as JSON. {API_ENDPOINTS.length} endpoints, generated from one route registry: parameters below are read from the Zod schemas
          that validate requests, and every example response is captured from the live database when this page renders.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/openapi.json" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent">
            <FileJsonIcon className="size-4" aria-hidden /> OpenAPI 3.1
          </a>
          <a href="/api/export/systems.csv" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent">
            <DownloadIcon className="size-4" aria-hidden /> systems.csv
          </a>
          <a href="/api/export/components.csv" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent">
            <DownloadIcon className="size-4" aria-hidden /> components.csv
          </a>
        </div>
      </div>
      </header>

      <div className="mt-10 grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Endpoints" className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-8rem)] space-y-5 overflow-y-auto pr-2 text-sm">
            <a href="#conventions" className="block text-muted-foreground hover:text-foreground">
              Conventions
            </a>
            {byGroup.map(({ group, eps }) => (
              <div key={group} className="space-y-1.5">
                <a href={`#${groupId(group)}`} className="type-eyebrow block hover:text-foreground">
                  {group}
                </a>
                <ul className="space-y-1">
                  {eps.map((ep) => (
                    <li key={ep.id}>
                      <a href={`#${anchor(ep)}`} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
                        <MethodTag method={ep.method} small />
                        <span className="truncate">{ep.summary}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-16">
          <section id="conventions" aria-labelledby="conventions-title" className="scroll-mt-24 space-y-5">
            <h2 id="conventions-title" className="text-xl font-semibold tracking-tight">
              Conventions
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <Convention title="List" code={`{ "data": [...], "page": 1,\n  "pageSize": 24, "total": 100 }`} />
              <Convention title="Single item" code={`{ "data": { ... } }`} />
              <Convention title="Error" code={`{ "error": { "code": "invalid_request",\n  "message": "...", "issues": [...] } }`} />
            </div>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              <Rule k="Pagination">page (1-based) and pageSize (max 100). total counts every match.</Rule>
              <Rule k="Validation">Unknown parameters and invalid values return 400 with issues; nothing is silently ignored.</Rule>
              <Rule k="Caching">
                Catalog <code className="font-mono text-[12px]">{CACHE.catalog}</code>; status <code className="font-mono text-[12px]">{CACHE.status}</code>; owner and admin data are never cached.
              </Rule>
              <Rule k="Honesty">null means unknown. Coverage maps say whether a field is documented, documented as none, not documented, not extracted or inferred.</Rule>
              <Rule k="Provenance">Detail endpoints include evidence rows: source URL, retrieval time, content hash, extraction method, location.</Rule>
              <Rule k="Licensing">Names and trademarks belong to their owners. Token values are withheld unless the set’s license permits redistribution.</Rule>
            </ul>
          </section>

          {byGroup.map(({ group, eps }) => (
            <section key={group} id={groupId(group)} aria-labelledby={`${groupId(group)}-title`} className="scroll-mt-24 space-y-6">
              <h2 id={`${groupId(group)}-title`} className="border-b pb-3 text-xl font-semibold tracking-tight">
                {group}
              </h2>
              {eps.map((ep) => (
                <Endpoint key={ep.id} ep={ep} example={ex.get(ep.id)} capturedAt={capturedAt} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

function Endpoint({ ep, example, capturedAt }: { ep: Ep; example?: { body: unknown; error: string | null }; capturedAt: Date }) {
  const params = [
    ...rows(ep.pathParams, "path"),
    ...rows(ep.query, "query"),
  ];
  const body = rows(ep.body, "body");
  const auth = AUTH_LABEL[ep.auth];
  const curl =
    ep.method === "GET"
      ? `curl -s "$ATLAS${ep.example?.request ?? ep.path.replace(/\{(\w+)\}/g, ":$1")}"`
      : `curl -s -X POST "$ATLAS${ep.path.replace(/\{(\w+)\}/g, ":$1")}"${ep.auth === "admin" ? ' \\\n  -H "Authorization: Bearer $ATLAS_ADMIN_TOKEN"' : ""}${ep.body ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${exampleBody(ep)}'` : ""}`;
  const downloadable = ep.responseKind === "file" && ep.auth === "public";
  return (
    <article id={anchor(ep)} aria-labelledby={`${anchor(ep)}-title`} className="scroll-mt-24 overflow-hidden rounded-xl border bg-card">
      <header className="space-y-2 border-b px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <MethodTag method={ep.method} />
          <code className="min-w-0 font-mono text-[13px] font-medium break-all">{ep.path}</code>
        </div>
        <h3 id={`${anchor(ep)}-title`} className="text-base font-semibold tracking-tight">
          {ep.summary}
        </h3>
        <p className="text-sm text-muted-foreground">{ep.description}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span title={auth.hint}>
            <span className="text-subtle-foreground">Auth</span> {auth.label}
          </span>
          <span>
            <span className="text-subtle-foreground">Returns</span> <code className="font-mono">{ep.returns}</code>
          </span>
          {ep.errors.length > 0 && (
            <span>
              <span className="text-subtle-foreground">Errors</span> <span className="font-mono">{ep.errors.join(" · ")}</span>
            </span>
          )}
          <span>
            <span className="text-subtle-foreground">Cache</span> <span className="font-mono">{ep.cache}</span>
          </span>
        </p>
      </header>
      <div className="grid gap-0 xl:grid-cols-2">
        <div className="min-w-0 space-y-4 px-4 py-4 sm:px-5">
          {params.length > 0 ? <ParamTable title="Parameters" rows={params} /> : <p className="text-sm text-muted-foreground">No parameters.</p>}
          {body.length > 0 && <ParamTable title="JSON body" rows={body} />}
          {ep.auth === "owner" && <p className="text-xs text-muted-foreground">{auth.hint}</p>}
        </div>
        <div className="min-w-0 space-y-3 border-t px-4 py-4 sm:px-5 xl:border-t-0 xl:border-l">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Request</p>
              <CopyButton text={curl.replace("$ATLAS", "")} label={`Copy request for ${ep.summary}`} />
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed">
              <code>{curl}</code>
            </pre>
          </div>
          {example ? (
            example.error ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{example.error}</p>
            ) : (
              <div className="space-y-1.5">
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span>Live response {ep.example?.note ? <span className="font-normal text-subtle-foreground">· {ep.example.note}</span> : null}</span>
                  <span className="font-normal text-subtle-foreground">
                    captured <time dateTime={capturedAt.toISOString()}>{capturedAt.toISOString().slice(11, 19)} UTC</time> · abbreviated
                  </span>
                </p>
                <JsonView value={example.body} label={`Example response for ${ep.summary}`} />
              </div>
            )
          ) : downloadable ? (
            <p className="text-sm text-muted-foreground">
              File download.{" "}
              {["json", "csv"].map((f, i) => (
                <span key={f}>
                  {i > 0 && " · "}
                  <a className="link-underline font-mono text-[13px] text-foreground" href={ep.path.replace("{format}", f)}>
                    {ep.path.replace("{format}", f).replace("/api/export/", "")}
                  </a>
                </span>
              ))}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {ep.method === "POST" ? "No live example: this endpoint changes state, so the docs never call it." : "No live example: this endpoint’s data is private to each caller."}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

interface ParamRow {
  name: string;
  in: "path" | "query" | "body";
  type: string;
  required: boolean;
  def: string | null;
  description: string | null;
}

function typeOf(s: Record<string, unknown>): string {
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(" | ");
  const t = s.type as string | undefined;
  const fmt = s.format as string | undefined;
  const bits: string[] = [];
  if (t) bits.push(t);
  if (fmt) bits.push(fmt);
  if (typeof s.minimum === "number" && typeof s.maximum === "number" && s.maximum < 1e9) bits.push(`${s.minimum}–${s.maximum}`);
  else if (typeof s.maximum === "number" && s.maximum < 1e9) bits.push(`≤ ${s.maximum}`);
  if (typeof s.maxLength === "number") bits.push(`≤ ${s.maxLength} chars`);
  if (typeof s.pattern === "string" && !fmt) bits.push(/a-z0-9/.test(s.pattern) ? "slug" : "pattern");
  return bits.join(", ") || "string";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows(schema: any, where: ParamRow["in"]): ParamRow[] {
  if (!schema) return [];
  const js = jsonSchemaOf(schema);
  return Object.entries(js.properties ?? {}).map(([name, s]) => ({
    name,
    in: where,
    type: typeOf(s),
    required: where === "path" || (js.required ?? []).includes(name),
    def: s.default === undefined ? null : JSON.stringify(s.default),
    description: (s.description as string | undefined) ?? null,
  }));
}

function exampleBody(ep: Ep): string {
  const js = jsonSchemaOf(ep.body);
  const obj: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(js.properties ?? {})) {
    if (!(js.required ?? []).includes(k)) continue;
    obj[k] = Array.isArray(s.enum) ? (s.enum as unknown[])[0] : s.format === "uuid" ? "<uuid>" : s.type === "boolean" ? true : `<${k}>`;
  }
  return JSON.stringify(obj);
}

function ParamTable({ title, rows }: { title: string; rows: ParamRow[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={`${r.in}-${r.name}`} className="space-y-1 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className="font-mono text-[12.5px] font-medium">{r.name}</code>
              <span className="font-mono text-[11px] text-subtle-foreground">{r.in}</span>
              <span className="font-mono text-[11px] break-all text-info">{r.type}</span>
              {r.required ? <span className="text-[11px] font-medium text-foreground/80">required</span> : null}
              {r.def !== null && <span className="font-mono text-[11px] text-muted-foreground">default {r.def}</span>}
            </div>
            {r.description && <p className="text-[13px] text-muted-foreground">{r.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MethodTag({ method, small }: { method: "GET" | "POST"; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded border font-mono font-semibold tracking-wide",
        small ? "w-9 py-px text-[9.5px]" : "px-1.5 py-0.5 text-[11px]",
        method === "GET" ? "border-info/30 bg-info-soft text-info" : "border-inferred/30 bg-inferred-soft text-inferred",
      )}
    >
      {method}
    </span>
  );
}

function Convention({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="overflow-x-auto rounded-lg border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Rule({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[13px] font-medium">{k}</p>
      <p className="text-[13px] text-muted-foreground">{children}</p>
    </li>
  );
}

