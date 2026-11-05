/**
 * atlassian.design/llms-components.txt: an auto-generated Markdown index of ADS components
 * ("## @atlaskit/<pkg> Package" > "### <Export> component" with "- **Status:** <phase>" bullets).
 * Only the explicit release status (and categories) per export is read; prose and code are ignored.
 */

export interface LlmsComponentEntry {
  packageName: string;
  exportName: string;
  status: string | null;
  categories: string[];
  /** 1-based line of the "### ... component" heading. */
  line: number;
}

export function parseLlmsComponents(body: string): LlmsComponentEntry[] {
  const out: LlmsComponentEntry[] = [];
  let pkg: string | null = null;
  let cur: LlmsComponentEntry | null = null;
  let inFence = false;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const p = /^##\s+(@atlaskit\/[a-z0-9._-]+)\s+Package\s*$/.exec(line);
    if (p) {
      pkg = p[1]!;
      cur = null;
      continue;
    }
    const c = /^###\s+([A-Za-z0-9_.]+)\s+component\s*$/.exec(line);
    if (c && pkg) {
      cur = { packageName: pkg, exportName: c[1]!, status: null, categories: [], line: i + 1 };
      out.push(cur);
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      if (/^#{1,3}\s/.test(line)) cur = null;
      continue;
    }
    if (!cur) continue;
    const s = /^-\s+\*\*Status:\*\*\s*(.+?)\s*$/.exec(line);
    if (s) cur.status = s[1]!.toLowerCase();
    const k = /^-\s+\*\*Categories:\*\*\s*(.+?)\s*$/.exec(line);
    if (k)
      cur.categories = k[1]!
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
  }
  return out;
}
