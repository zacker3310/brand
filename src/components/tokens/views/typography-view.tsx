import { VerificationBadge } from "@/components/atlas";
import type { ExplorerToken } from "@/server/queries/tokens";
import { naturalCompare } from "../lib/natural";
import { authoredLabel, previewValue, primaryFamily, typographyFieldOf, typographyScalar, typographySpec, type TypographySpec } from "../lib/values";
import { AliasStateBadge } from "../alias-state";
import { FontStatus } from "../font-status";
import { GroupHeader, GroupList, GroupSection, relName, TokenAnchor, type ViewProps } from "./shared";

const SAMPLE = "The quick brown fox jumps over the lazy dog";
const MAX_PX = 96;

type Field = Exclude<keyof TypographySpec, "unevaluated" | "fontSizePx">;
const FIELD_LABEL: Record<Field, string> = {
  fontFamily: "family",
  fontSize: "size",
  fontWeight: "weight",
  lineHeight: "line height",
  letterSpacing: "tracking",
  fontStyle: "style",
};

function specStyle(spec: TypographySpec): React.CSSProperties {
  const px = spec.fontSizePx;
  return {
    fontFamily: spec.fontFamily ?? undefined,
    fontSize: px !== null ? `${Math.min(px, MAX_PX)}px` : (spec.fontSize ?? undefined),
    fontWeight: spec.fontWeight ?? undefined,
    lineHeight: spec.lineHeight ?? undefined,
    letterSpacing: spec.letterSpacing ?? undefined,
    fontStyle: spec.fontStyle ?? undefined,
  };
}

function Meta({ spec }: { spec: TypographySpec }) {
  const parts = (Object.keys(FIELD_LABEL) as Field[]).filter((f) => spec[f]).map((f) => `${FIELD_LABEL[f]} ${spec[f]}`);
  return <p className="truncate font-mono text-[11px] text-muted-foreground" title={parts.join(" · ")}>{parts.join(" · ") || "no evaluable properties"}</p>;
}

function Specimen({ spec, children, notes }: { spec: TypographySpec; children: React.ReactNode; notes?: React.ReactNode }) {
  const capped = spec.fontSizePx !== null && spec.fontSizePx > MAX_PX;
  return (
    <div className="min-w-0 space-y-2 rounded-lg border bg-card p-4">
      {children}
      <Meta spec={spec} />
      <p className="overflow-hidden text-ellipsis whitespace-nowrap text-foreground" style={specStyle(spec)}>
        {SAMPLE}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <FontStatus family={primaryFamily(spec.fontFamily)} stack={spec.fontFamily} />
        {capped && <span className="text-[11px] text-muted-foreground">Shown at {MAX_PX}px (authored {spec.fontSize}).</span>}
        {spec.unevaluated.length > 0 && (
          <span className="text-[11px] text-inferred">Not applied (unevaluated in source): {spec.unevaluated.join(", ")}.</span>
        )}
        {notes}
      </div>
    </div>
  );
}

interface Composition {
  prefix: string;
  members: ExplorerToken[];
  spec: TypographySpec;
}

/** Compose specimens from sibling scalar tokens sharing a parent path (an ATLAS inference, labelled). */
function compose(tokens: ExplorerToken[]): { compositions: Composition[]; rest: ExplorerToken[] } {
  const buckets = new Map<string, ExplorerToken[]>();
  for (const t of tokens) {
    if (t.path.length < 2) continue;
    const k = t.path.slice(0, -1).join(".");
    const arr = buckets.get(k) ?? [];
    arr.push(t);
    buckets.set(k, arr);
  }
  const used = new Set<string>();
  const compositions: Composition[] = [];
  for (const [prefix, members] of buckets) {
    const spec: TypographySpec = { fontFamily: null, fontSize: null, fontSizePx: null, fontWeight: null, lineHeight: null, letterSpacing: null, fontStyle: null, unevaluated: [] };
    let fields = 0;
    for (const t of [...members].sort((a, b) => naturalCompare(a.name, b.name))) {
      const f = typographyFieldOf(t.path[t.path.length - 1] ?? "", t.type);
      if (!f || spec[f]) continue;
      const v = typographyScalar(f, previewValue(t));
      if (v === null) continue;
      spec[f] = v;
      fields++;
    }
    if (fields >= 2 && (spec.fontSize || spec.fontFamily)) {
      spec.fontSizePx = spec.fontSize ? (typographySpec({ fontSize: spec.fontSize })?.fontSizePx ?? null) : null;
      compositions.push({ prefix, members, spec });
      for (const m of members) used.add(m.id);
    }
  }
  return { compositions: compositions.sort((a, b) => naturalCompare(a.prefix, b.prefix)), rest: tokens.filter((t) => !used.has(t.id)) };
}

export function TypographyView(p: ViewProps) {
  return (
    <GroupList
      p={p}
      render={(g) => {
        const tokens = g.list.map((r) => p.tokens.get(r.id)).filter((t): t is ExplorerToken => !!t);
        const composites: { t: ExplorerToken; spec: TypographySpec }[] = [];
        const scalars: ExplorerToken[] = [];
        for (const t of tokens) {
          const spec = typographySpec(previewValue(t));
          if (spec) composites.push({ t, spec });
          else scalars.push(t);
        }
        const { compositions, rest } = compose(scalars);
        return (
          <GroupSection g={g}>
            <GroupHeader g={g} set={g.setId ? p.setById.get(g.setId) : undefined} multiSet={p.multiSet} />
            {(composites.length > 0 || compositions.length > 0) && (
              <div className="grid gap-3 lg:grid-cols-2">
                {composites.map(({ t, spec }) => (
                  <Specimen key={t.id} spec={spec}>
                    <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="block truncate rounded font-mono text-[12.5px] font-medium hover:underline" title={t.name}>
                      {relName(t.name, g.label)}
                    </TokenAnchor>
                  </Specimen>
                ))}
                {compositions.map((c) => (
                  <Specimen
                    key={c.prefix}
                    spec={c.spec}
                    notes={
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <VerificationBadge state="inferred" compact detail="ATLAS composed this specimen from sibling tokens that share a path prefix. The source defines them as separate tokens." />
                        Composed from {c.members.length} sibling tokens
                      </span>
                    }
                  >
                    <p className="truncate font-mono text-[12.5px] font-medium" title={c.prefix}>
                      {relName(c.prefix, g.label)}
                    </p>
                    <ul className="flex flex-wrap gap-1">
                      {c.members.map((m) => (
                        <li key={m.id}>
                          <TokenAnchor id={m.id} href={p.hrefFor(m.id)} className="inline-block rounded border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground" title={m.name}>
                            {m.path[m.path.length - 1]}
                          </TokenAnchor>
                        </li>
                      ))}
                    </ul>
                  </Specimen>
                ))}
              </div>
            )}
            {rest.length > 0 && (
              <ul className="divide-y divide-border/60 rounded-lg border">
                {rest.map((t) => (
                  <ScalarRow key={t.id} t={t} p={p} label={g.label} />
                ))}
              </ul>
            )}
          </GroupSection>
        );
      }}
    />
  );
}

function ScalarRow({ t, p, label }: { t: ExplorerToken; p: ViewProps; label: string }) {
  const v = previewValue(t);
  const field = typographyFieldOf(t.path[t.path.length - 1] ?? "", t.type, t.path);
  const css = field ? typographyScalar(field, v) : null;
  const display = t.valueText ?? authoredLabel(t.rawValue, t.type);
  let preview: React.ReactNode = null;
  if (css && field === "fontFamily") preview = <span style={{ fontFamily: css }} className="truncate text-base">Aa Bb Cc 0123</span>;
  else if (css && field === "fontSize") {
    const px = typographySpec({ fontSize: css })?.fontSizePx ?? null;
    preview = <span style={{ fontSize: px !== null ? `${Math.min(px, 64)}px` : css }} className="leading-none">Ag</span>;
  } else if (css && field === "fontWeight") preview = <span style={{ fontWeight: css }} className="text-xl leading-none">Ag</span>;
  else if (css && field === "letterSpacing") preview = <span style={{ letterSpacing: css }} className="text-sm uppercase">Tracking</span>;
  else if (css && field === "lineHeight")
    preview = (
      <span style={{ lineHeight: css }} className="block w-28 text-[10px] text-muted-foreground">
        Line height sample wraps over two lines
      </span>
    );
  return (
    <li className="min-w-0">
      <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/60 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_8rem]">
        <span className="min-w-0">
          <span className="block truncate font-mono text-[12.5px]" title={t.name}>
            {relName(t.name, label)}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground" title={display}>
            {display || "—"}
          </span>
        </span>
        <span className="hidden min-w-0 overflow-hidden sm:block">{preview ?? <span className="text-[11px] text-muted-foreground">{field ? "Not previewable" : "No preview for this property"}</span>}</span>
        <span className="flex justify-end">{t.aliasState && t.aliasState !== "resolved" && <AliasStateBadge state={t.aliasState} compact tooltip={false} />}</span>
      </TokenAnchor>
    </li>
  );
}
