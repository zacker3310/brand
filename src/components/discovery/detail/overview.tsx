import Link from "next/link";
import { MissingValue, SourceLink, VerificationBadge } from "@/components/atlas";
import { SYSTEM_CATEGORY_LABELS } from "@/lib/contracts";
import { cn, hostname } from "@/lib/utils";
import type { FactEvidence, SystemDetail } from "@/server/queries/systems";
import { Chip, MaintenanceBadge } from "../badges";
import { DOC_ACCESS_LABELS } from "../lib/directory";
import { formatDate } from "../lib/format";
import { EvidenceDisclosure, aggregateState } from "./evidence-disclosure";

interface Fact {
  label: string;
  value: React.ReactNode;
  evidence: FactEvidence[];
  note?: string;
}

function byField(rows: FactEvidence[], ...fields: string[]): FactEvidence[] {
  return rows.filter((r) => fields.includes(r.field));
}

function UrlFact({ url, evidence }: { url: string | null; evidence: FactEvidence[] }) {
  if (url) return <SourceLink href={url}>{hostname(url) + displayPath(url)}</SourceLink>;
  // a URL that was researched but could not be confirmed is "unavailable", not missing
  if (aggregateState(evidence) === "unavailable") return <VerificationBadge state="unavailable" detail="A candidate URL was found but could not be confirmed (see evidence)." />;
  return <MissingValue state="not-extracted" />;
}

function displayPath(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "");
    if (p.length <= 1) return "";
    return p.length > 36 ? `${p.slice(0, 34)}…` : p;
  } catch {
    return "";
  }
}

/** Summary + key facts. Each fact carries its own evidence, expandable inline. */
export function OverviewSection({ detail }: { detail: SystemDetail }) {
  const { core, factEvidence: ev, frameworks, platforms, tags } = detail;
  const packageEvidence = ev.filter((e) => e.field.startsWith("package:"));
  const uiFrameworks = frameworks.filter((f) => f.kind !== "design");
  const facts: Fact[] = [
    {
      label: "Organization",
      value: core.organization ? (
        core.organization.websiteUrl ? (
          <SourceLink href={core.organization.websiteUrl}>{core.organization.name}</SourceLink>
        ) : (
          core.organization.name
        )
      ) : (
        <MissingValue state="not-extracted" />
      ),
      evidence: byField(ev, "organization", "organization.websiteUrl"),
    },
    {
      label: "Category",
      value: SYSTEM_CATEGORY_LABELS[core.category],
      evidence: [],
      note: "ATLAS registry classification; reasoning in Registry notes",
    },
    { label: "Homepage", value: <UrlFact url={core.homepageUrl} evidence={byField(ev, "homepageUrl")} />, evidence: byField(ev, "homepageUrl") },
    {
      label: "Documentation",
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <UrlFact url={core.docsUrl} evidence={byField(ev, "docsUrl")} />
          <span className="text-xs text-muted-foreground">{DOC_ACCESS_LABELS[core.docAccess]}</span>
        </span>
      ),
      evidence: byField(ev, "docsUrl"),
    },
    { label: "Repository", value: <UrlFact url={core.repositoryUrl} evidence={byField(ev, "repositoryUrl")} />, evidence: byField(ev, "repositoryUrl") },
    { label: "Storybook", value: <UrlFact url={core.storybookUrl} evidence={byField(ev, "storybookUrl")} />, evidence: byField(ev, "storybookUrl") },
    { label: "Figma", value: <UrlFact url={core.figmaUrl} evidence={byField(ev, "figmaUrl")} />, evidence: byField(ev, "figmaUrl") },
    {
      label: "License",
      value: core.license ? (
        <span className="flex flex-wrap items-center gap-2">
          {core.license.url ? <SourceLink href={core.license.url}>{core.license.name}</SourceLink> : core.license.name}
          {core.license.spdxId && <span className="font-mono text-xs text-muted-foreground">{core.license.spdxId}</span>}
        </span>
      ) : (
        <MissingValue state="not-extracted" />
      ),
      evidence: byField(ev, "license"),
    },
    { label: "Maintenance", value: <MaintenanceBadge status={core.maintenance} />, evidence: byField(ev, "maintenance") },
    {
      label: "Latest version",
      value: core.latestVersion ? (
        <span>
          <span className="font-mono">{core.latestVersion}</span>
          {core.latestReleaseAt && <span className="text-xs text-muted-foreground"> · {formatDate(core.latestReleaseAt)}</span>}
        </span>
      ) : (
        <MissingValue state="not-extracted" />
      ),
      // version facts come from adapter runs or from package-registry checks that state the version
      evidence: [
        ...byField(ev, "latestVersion"),
        ...(core.latestVersion ? packageEvidence.filter((e) => e.excerpt?.includes(`latest ${core.latestVersion}`)) : []),
      ],
    },
    {
      label: "Packages",
      value: core.packages.length ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {core.packages.map((p) => (
            <li key={p.name}>
              <SourceLink href={p.url} className="font-mono text-xs">
                {p.name}
              </SourceLink>
            </li>
          ))}
        </ul>
      ) : (
        <MissingValue state="not-extracted" />
      ),
      evidence: packageEvidence,
    },
    {
      label: "Frameworks",
      value: uiFrameworks.length ? (
        <span>
          {uiFrameworks.map((f, i) => (
            <span key={f.slug}>
              {i > 0 && ", "}
              <span className={cn(f.state !== "verified" && "text-muted-foreground")}>{f.name}</span>
            </span>
          ))}
          <a href="#frameworks" className="ml-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
            details
          </a>
        </span>
      ) : (
        <MissingValue state="not-extracted" />
      ),
      evidence: byField(ev, "frameworks"),
    },
    {
      label: "Platforms",
      value: platforms.length ? platforms.map((p) => p.name).join(", ") : <MissingValue state="not-extracted" />,
      evidence: byField(ev, "platforms"),
    },
    {
      label: "Tags",
      value: tags.length ? (
        <ul className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <li key={t.slug}>
              <Link href={`/systems?tag=${t.slug}`} className="rounded-md focus-visible:outline-2">
                <Chip className={cn("hover:text-foreground", t.state !== "verified" && "border-dashed")} title={`${t.name} · ${t.state}`}>
                  {t.name}
                </Chip>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <MissingValue state="not-extracted" />
      ),
      evidence: byField(ev, "tags"),
      note: tags.some((t) => t.state !== "verified") ? "Dashed tags are ATLAS-inferred" : undefined,
    },
  ];

  return (
    <div className="space-y-5">
      {core.summary ? (
        <p className="max-w-3xl text-[15px] leading-relaxed text-foreground/90">{core.summary}</p>
      ) : (
        <MissingValue state="not-extracted" />
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        <dl className="divide-y divide-border/70">
          {facts.map((f) => (
            <div key={f.label} className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start">
              <dt className="pt-px text-xs font-medium text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 text-sm">
                {f.value}
                {f.note && <p className="mt-0.5 text-[11px] text-muted-foreground">{f.note}</p>}
              </dd>
              <dd className="sm:max-w-[26rem] sm:justify-self-end sm:text-right [&_ul]:text-left">
                {f.label === "Category" ? (
                  <span className="text-[11px] text-muted-foreground">Classification</span>
                ) : (
                  <EvidenceDisclosure rows={f.evidence} emptyLabel="No evidence row" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Philosophy & principles: ATLAS-authored synthesis with the documented principle names and their sources. */
export function PhilosophySection({ detail }: { detail: SystemDetail }) {
  const { core, factEvidence } = detail;
  const evidence = factEvidence.filter((e) => e.field === "philosophy" || e.field === "principles");
  if (!core.philosophy && !core.principles?.length) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <MissingValue state="not-extracted" />
        <span>ATLAS has not extracted a philosophy or principles for {core.name}. The official documentation may describe them{core.docsUrl ? "" : "."}</span>
        {core.docsUrl && <SourceLink href={core.docsUrl}>Read the official docs</SourceLink>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div className="space-y-3">
        {core.philosophy ? (
          <p className="max-w-3xl text-[15px] leading-relaxed text-foreground/90">{core.philosophy}</p>
        ) : (
          <MissingValue state="not-extracted" />
        )}
        <EvidenceDisclosure rows={evidence} />
        <p className="text-[11px] text-muted-foreground">ATLAS-authored synthesis of documented statements; quoted text is attributed to the source.</p>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Documented principles</h3>
        {core.principles?.length ? (
          <ol className="space-y-1.5">
            {core.principles.map((p, i) => (
              <li key={p.name} className="flex gap-2.5 text-sm">
                <span className="tabular w-4 shrink-0 pt-px font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <SourceLink href={p.sourceUrl}>{p.name}</SourceLink>
              </li>
            ))}
          </ol>
        ) : (
          <MissingValue state="not-extracted" />
        )}
      </div>
    </div>
  );
}
