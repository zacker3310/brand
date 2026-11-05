import { Button } from "@/components/ui/button";
import { FacetGroup } from "./facet-group";
import { DEPTH_DESCRIPTIONS, FACET_TITLES, type Depth, type FacetKey, type FacetOption } from "./lib/directory";

const ORDER: { key: FacetKey; visible?: number; description?: string }[] = [
  { key: "depth", description: "How much ATLAS has extracted from official sources." },
  { key: "category" },
  { key: "framework" },
  { key: "platform", visible: 6 },
  { key: "licenseType" },
  { key: "license", visible: 5 },
  { key: "maintenance" },
  { key: "access" },
  { key: "tag", visible: 8 },
];

/** Facet sidebar: plain checkboxes in the surrounding GET form. */
export function DirectoryFilters({ facets }: { facets: Record<FacetKey, FacetOption[]> }) {
  return (
    <div className="space-y-6">
      {ORDER.map(({ key, visible, description }) => (
        <FacetGroup
          key={key}
          name={key}
          title={FACET_TITLES[key]}
          visible={visible}
          description={description}
          options={facets[key].map((o) => ({ ...o, hint: key === "depth" ? DEPTH_DESCRIPTIONS[o.value as Depth] : undefined }))}
        />
      ))}
      <Button type="submit" size="sm" variant="outline" className="w-full group-data-[enhanced]/form:hidden">
        Apply filters
      </Button>
    </div>
  );
}
