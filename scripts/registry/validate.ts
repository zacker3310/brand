/**
 * Validates registry files against the RegistryEntry contract and cross-file invariants.
 *
 *   npx tsx scripts/registry/validate.ts                      # all data/registry/*.json
 *   npx tsx scripts/registry/validate.ts data/registry/batch-01.json
 *
 * Invariants: contract-valid; unique slugs; every non-null URL field has an ok http/page/package check
 * for that URL (or its finalUrl); duplicateOf/replacesSlug point to existing entries; reports the
 * verified count (target: exactly 100 distinct verified systems across all files).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RegistryEntry } from "../../src/lib/contracts";

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("data/registry")
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => path.join("data/registry", f));

let invalid = 0;
const all: RegistryEntry[] = [];
const problems: string[] = [];
for (const f of files) {
  let arr: unknown[];
  try {
    arr = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    problems.push(`${f}: unreadable JSON (${(e as Error).message})`);
    continue;
  }
  if (!Array.isArray(arr)) {
    problems.push(`${f}: not an array`);
    continue;
  }
  arr.forEach((raw, i) => {
    const r = RegistryEntry.safeParse(raw);
    if (!r.success) {
      invalid++;
      const slug = (raw as { slug?: string })?.slug ?? `#${i}`;
      problems.push(`${f}: ${slug}: ${r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
      return;
    }
    all.push(r.data);
  });
}

const bySlug = new Map<string, RegistryEntry>();
for (const e of all) {
  if (bySlug.has(e.slug)) problems.push(`duplicate slug: ${e.slug}`);
  bySlug.set(e.slug, e);
}
const urlFields = ["homepageUrl", "docsUrl", "repositoryUrl", "storybookUrl"] as const;
const warnings: string[] = [];
const norm = (u: string) => u.replace(/\/$/, "");
const hasPassing = (e: RegistryEntry, u: string) => e.checks.some((c) => c.ok && (norm(c.url) === norm(u) || (c.finalUrl && norm(c.finalUrl) === norm(u))));
for (const e of all) {
  if (e.registryStatus === "verified") {
    for (const f of urlFields) {
      const u = e[f];
      if (!u) continue;
      if (!hasPassing(e, u)) problems.push(`${e.slug}: ${f} ${u} has no passing check`);
    }
    // Figma policy: figma.com rejects automated clients (403), so a figmaUrl is accepted when either the
    // URL itself verifies, or a passing page-content check on an official page records that it links this exact URL.
    if (e.figmaUrl) {
      const figmaUrl = e.figmaUrl;
      const linked = e.checks.some((c) => c.ok && c.field === "figmaUrl" && c.method === "page-content" && (c.note ?? "").includes(figmaUrl));
      if (!hasPassing(e, figmaUrl) && !linked) problems.push(`${e.slug}: figmaUrl ${figmaUrl} neither verifies nor is recorded as linked from an official page`);
    }
    if (e.organization.websiteUrl && !hasPassing(e, e.organization.websiteUrl)) warnings.push(`${e.slug}: organization.websiteUrl has no passing check`);
    if (e.license?.url && !hasPassing(e, e.license.url)) warnings.push(`${e.slug}: license.url has no passing check`);
    if (!e.docsUrl) problems.push(`${e.slug}: verified but docsUrl is null`);
  }
  if (e.registryStatus === "duplicate" && (!e.duplicateOf || !bySlug.has(e.duplicateOf))) problems.push(`${e.slug}: duplicateOf ${e.duplicateOf} missing`);
  if (e.replacesSlug && !bySlug.has(e.replacesSlug)) problems.push(`${e.slug}: replacesSlug ${e.replacesSlug} not in registry (ok if that batch is not written yet)`);
}
const counts = all.reduce<Record<string, number>>((m, e) => ((m[e.registryStatus] = (m[e.registryStatus] ?? 0) + 1), m), {});
console.log(JSON.stringify({ files: files.length, entries: all.length, invalid, counts, verified: counts.verified ?? 0, problems, warnings }, null, 2));
process.exit(invalid > 0 ? 1 : 0);
