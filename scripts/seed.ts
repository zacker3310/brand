/**
 * npm run db:seed
 *   Seeds ATLAS reference data from src/lib/taxonomy (categories, component/pattern types,
 *   frameworks, platforms) and imports every data/registry/*.json file. Idempotent.
 *
 *   tsx scripts/seed.ts [--dir data/registry] [--file path.json ...] [--json] [--reference-only]
 */
import { closeDb } from "../src/db/client";
import { importRegistry, registryFiles } from "../src/ingestion/registry/import";
import { seedReferenceData } from "../src/ingestion/registry/reference";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const json = process.argv.includes("--json");
  const reference = await seedReferenceData();
  if (!json) {
    console.log("reference data:");
    for (const [k, v] of Object.entries(reference)) if (k !== "notes") console.log(`  ${k.padEnd(15)} ${JSON.stringify(v)}`);
    for (const n of reference.notes) console.log(`  note: ${n}`);
  }
  if (process.argv.includes("--reference-only")) return;
  const files = process.argv.flatMap((a, i) => (a === "--file" && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
  const report = await importRegistry(files.length ? { files } : { files: registryFiles(arg("--dir") ?? "data/registry") });
  if (json) {
    console.log(JSON.stringify({ reference, registry: report }, null, 2));
  } else {
    console.log(`registry: ${report.files.length} file(s), ${report.entries} entries, ${report.imported} imported`);
    console.log(`  created ${report.created.length}, updated ${report.updated.length}, unchanged ${report.unchanged.length}, invalid ${report.invalid.length}, skipped ${report.skipped.length}`);
    if (report.updated.length) console.log(`  updated: ${report.updated.join(", ")}`);
    for (const i of report.invalid) console.log(`  INVALID ${i.file}#${i.index} ${i.slug ?? ""}: ${i.problems.join("; ")}`);
    for (const s of report.skipped) console.log(`  SKIPPED ${s.file}#${s.index} ${s.slug ?? ""}: ${s.problems.join("; ")}`);
    const w = [...new Set(report.warnings)];
    for (const x of w.slice(0, 50)) console.log(`  warning: ${x}`);
    if (w.length > 50) console.log(`  ... ${w.length - 50} more warnings`);
  }
  if (report.invalid.length) process.exitCode = 2;
  // Taxonomy / framework / category search documents exist only after a reindex.
  if (!process.argv.includes("--no-reindex")) {
    const { reindexAll } = await import("../src/server/search");
    const r = await reindexAll();
    if (!json) console.log(`search index: ${JSON.stringify(r)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
