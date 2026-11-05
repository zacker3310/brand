/** Display formatting for discovery surfaces. Pure; deterministic (UTC) so server output is stable. */

const DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const DATETIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : DATETIME.format(date);
}

export function isoOrNull(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Compact counts for meters: 2,744 -> "2.7k". Exact value belongs in an accessible label. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

export function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Human labels for change_event kinds. */
export const CHANGE_KIND_LABELS: Record<string, string> = {
  created: "Added",
  updated: "Updated",
  removed: "Retired",
  "source-changed": "Source changed",
  verified: "Verified",
  "status-changed": "Status changed",
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  design_system: "System record",
  component: "Component",
  token_set: "Token set",
  pattern: "Pattern",
  source_document: "Source document",
  token: "Token",
  source: "Source",
};

/** Registry check field -> fact label ("package:@carbon/react" -> "Package @carbon/react"). */
export function checkFieldLabel(field: string): string {
  if (field.startsWith("package:")) return `Package ${field.slice("package:".length)}`;
  const map: Record<string, string> = {
    homepageUrl: "Homepage",
    docsUrl: "Documentation",
    repositoryUrl: "Repository",
    figmaUrl: "Figma",
    storybookUrl: "Storybook",
    license: "License",
    maintenance: "Maintenance",
    organization: "Organization",
    "organization.websiteUrl": "Organization website",
    frameworks: "Frameworks",
    platforms: "Platforms",
    tags: "Tags",
    aliases: "Aliases",
    summary: "Summary",
    relatedSlugs: "Related systems",
    latestVersion: "Latest version",
    audit: "Registry audit",
    philosophy: "Philosophy",
    principles: "Principles",
    "*": "Whole record",
  };
  return map[field] ?? field;
}
