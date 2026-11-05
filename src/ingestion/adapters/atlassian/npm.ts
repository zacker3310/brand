/**
 * npm registry metadata for @atlaskit packages: `GET /<pkg>/latest` version manifests and full
 * packuments (for publish times). Pure JSON parsing; nothing is executed.
 */

export interface WebsiteSubPage {
  id: string;
  title: string;
  status: string | null;
  statusDescription: string | null;
}

export interface NpmManifestInfo {
  name: string;
  version: string;
  description: string | null;
  license: string | null;
  homepage: string | null;
  repository: string | null;
  deprecated: string | null;
  peerDependencies: string[];
  /** Release time of `version` (packuments only). */
  publishedAt: string | null;
  /** `atlassian.website` docs metadata (name, category, status, sub pages). */
  website: { name: string | null; category: string | null; status: string | null; statusDescription: string | null; subPages: WebsiteSubPage[] } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function statusOf(v: unknown): { status: string | null; description: string | null } {
  if (typeof v === "string") return { status: str(v), description: null };
  if (isObj(v)) return { status: str(v.type), description: str(v.description) };
  return { status: null, description: null };
}

function fromVersionManifest(m: Record<string, unknown>, publishedAt: string | null): NpmManifestInfo | null {
  const name = str(m.name);
  const version = str(m.version);
  if (!name || !version) return null;
  const repo = m.repository;
  const atl = isObj(m.atlassian) ? m.atlassian : null;
  const site = atl && isObj(atl.website) ? atl.website : null;
  const st = site ? statusOf(site.status) : { status: null, description: null };
  return {
    name,
    version,
    description: str(m.description),
    license: str(m.license) ?? (isObj(m.license) ? str(m.license.type) : null),
    homepage: str(m.homepage),
    repository: typeof repo === "string" ? str(repo) : isObj(repo) ? str(repo.url) : null,
    deprecated: str(m.deprecated),
    peerDependencies: isObj(m.peerDependencies) ? Object.keys(m.peerDependencies).sort() : [],
    publishedAt,
    website: site
      ? {
          name: str(site.name),
          category: str(site.category),
          status: st.status,
          statusDescription: st.description,
          subPages: (Array.isArray(site.subPages) ? site.subPages : [])
            .filter(isObj)
            .map((sp) => {
              const s = statusOf(sp.status);
              return { id: str(sp.id) ?? "", title: str(sp.title) ?? "", status: s.status, statusDescription: s.description };
            })
            .filter((sp) => sp.id && sp.title),
        }
      : null,
  };
}

/** Parse a `/<pkg>/latest` version manifest. */
export function parseNpmManifest(body: string): NpmManifestInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  return isObj(data) ? fromVersionManifest(data, null) : null;
}

/** Parse a full packument; returns the `dist-tags.latest` version's manifest with its publish time. */
export function parseNpmPackument(body: string): NpmManifestInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;
  const tags = isObj(data["dist-tags"]) ? data["dist-tags"] : {};
  const latest = str(tags.latest);
  const versions = isObj(data.versions) ? data.versions : {};
  const v = latest ? versions[latest] : undefined;
  if (!latest || !isObj(v)) return null;
  const time = isObj(data.time) ? data.time : {};
  return fromVersionManifest(v, str(time[latest]));
}
