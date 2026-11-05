/**
 * Token promotion: upsert sets (system+slug) and tokens (set+name); delete tokens no longer in a
 * re-extracted set (change_event with counts). Then resolve aliases across every published set of
 * the system and diff-sync resolved values and token_alias rows (no-ops when nothing changed).
 *
 * Resolution scope of a set S: S's own tokens, then other sets with the same theme, then
 * theme-agnostic sets (theme null). Earlier scopes win name collisions (light/dark share names).
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { NormalizedToken, NormalizedTokenSet } from "@/lib/contracts";
import { tokenAliases, tokenSets, tokens } from "@/db/schema";
import { diffPayload } from "../diff";
import { upsertEvidence } from "../evidence";
import { contentHash } from "../hash";
import { formatTokenValue, resolutionColumns, resolveTokenGraph, tokenAliasRows, type GraphTokenInput, type TokenResolution } from "../tokens";
import type { ValidatedEntity } from "../validate";
import { bulkUpdate, ensureLicense, inSavepoint, newCounters, previousPayload, writeChange, type Counters, type PromoteContext } from "./promote-common";

type TokenRow = typeof tokens.$inferInsert;

function tokenRow(setId: string, systemId: string, t: NormalizedToken): TokenRow {
  return {
    tokenSetId: setId,
    designSystemId: systemId,
    name: t.name,
    path: t.path,
    cssVar: t.cssVar ?? null,
    category: t.category,
    type: t.type ?? null,
    tier: t.tier ?? null,
    tierState: t.tierState,
    rawValue: t.rawValue ?? null,
    isAlias: t.references.length > 0,
    description: t.description ?? null,
    deprecated: t.deprecated,
    location: t.location ?? null,
  };
}

const rowFingerprint = (r: Pick<TokenRow, "path" | "cssVar" | "category" | "type" | "tier" | "tierState" | "rawValue" | "isAlias" | "description" | "deprecated" | "location">) =>
  contentHash([r.path, r.cssVar ?? null, r.category, r.type ?? null, r.tier ?? null, r.tierState, r.rawValue ?? null, r.isAlias ?? false, r.description ?? null, r.deprecated ?? false, r.location ?? null]);

export interface TokenPromotion {
  counters: Counters;
  tokensAdded: number;
  tokensUpdated: number;
  tokensRemoved: number;
  promotedKeys: Set<string>;
}

export async function promoteTokenSets(pc: PromoteContext, entities: ValidatedEntity[], allKeys: Set<string>): Promise<TokenPromotion> {
  const tx = pc.tx;
  const counters = newCounters();
  const out: TokenPromotion = { counters, tokensAdded: 0, tokensUpdated: 0, tokensRemoved: 0, promotedKeys: new Set() };
  const existingSets = new Map(
    (
      await tx
        .select({ id: tokenSets.id, slug: tokenSets.slug, contentHash: tokenSets.contentHash, publishState: tokenSets.publishState, tokenCount: tokenSets.tokenCount })
        .from(tokenSets)
        .where(eq(tokenSets.designSystemId, pc.systemId))
    ).map((r) => [r.slug, r]),
  );
  /** References per (setId, token name) for alias resolution of sets in this bundle. */
  const refsBySet = new Map<string, Map<string, string[]>>();

  for (const e of entities) {
    const s = e.payload as unknown as NormalizedTokenSet;
    const dropped = new Set(e.droppedTokens ?? []);
    const seen = new Set<string>();
    const list = s.tokens.filter((t) => !dropped.has(t.name) && !seen.has(t.name) && (seen.add(t.name), true));
    const prev = existingSets.get(e.key);
    const ok = await inSavepoint(pc, e, async () => {
      const licenseId = s.license ? await ensureLicense(tx, s.license) : pc.licenseId;
      const setHash = contentHash({ p: e.hash, dropped: [...dropped].sort(), licenseId });
      if (prev && prev.contentHash === setHash && prev.publishState === "published") {
        refsBySet.set(prev.id, new Map(list.map((t) => [t.name, t.references])));
        counters.unchanged++;
        return;
      }
      const values = {
        designSystemId: pc.systemId,
        slug: s.slug,
        name: s.name,
        theme: s.theme ?? null,
        format: s.format,
        sourceUrl: s.sourceUrl,
        packageName: s.packageName ?? null,
        packageVersion: s.packageVersion ?? null,
        licenseId,
        redistribution: s.redistribution,
        tokenCount: list.length,
        publishState: "published" as const,
        contentHash: setHash,
      };
      const { designSystemId: _d, slug: _s, ...updatable } = values;
      const [row] = await tx
        .insert(tokenSets)
        .values(values)
        .onConflictDoUpdate({ target: [tokenSets.designSystemId, tokenSets.slug], set: { ...updatable, updatedAt: sql`now()` } })
        .returning({ id: tokenSets.id });
      const setId = row!.id;
      refsBySet.set(setId, new Map(list.map((t) => [t.name, t.references])));

      const current = await tx
        .select({ id: tokens.id, name: tokens.name, path: tokens.path, cssVar: tokens.cssVar, category: tokens.category, type: tokens.type, tier: tokens.tier, tierState: tokens.tierState, rawValue: tokens.rawValue, isAlias: tokens.isAlias, description: tokens.description, deprecated: tokens.deprecated, location: tokens.location })
        .from(tokens)
        .where(eq(tokens.tokenSetId, setId));
      const have = new Map(current.map((r) => [r.name, r]));
      const rows = list.map((t) => tokenRow(setId, pc.systemId, t));
      const changedRows = rows.filter((r) => {
        const h = have.get(r.name);
        return !h || rowFingerprint(h) !== rowFingerprint(r);
      });
      const added = changedRows.filter((r) => !have.has(r.name)).length;
      const updated = changedRows.length - added;
      for (let i = 0; i < changedRows.length; i += 500) {
        await tx
          .insert(tokens)
          .values(changedRows.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [tokens.tokenSetId, tokens.name],
            set: {
              path: sql`excluded.path`,
              cssVar: sql`excluded.css_var`,
              category: sql`excluded.category`,
              type: sql`excluded.type`,
              tier: sql`excluded.tier`,
              tierState: sql`excluded.tier_state`,
              rawValue: sql`excluded.raw_value`,
              isAlias: sql`excluded.is_alias`,
              description: sql`excluded.description`,
              deprecated: sql`excluded.deprecated`,
              location: sql`excluded.location`,
            },
          });
      }
      let removed = 0;
      if (pc.allowTokenDeletion) {
        const names = new Set(list.map((t) => t.name));
        const gone = current.filter((r) => !names.has(r.name)).map((r) => r.id);
        for (let i = 0; i < gone.length; i += 1000) await tx.delete(tokens).where(inArray(tokens.id, gone.slice(i, i + 1000)));
        removed = gone.length;
      }
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(tokens).where(eq(tokens.tokenSetId, setId))) as [{ n: number }];
      if (n !== list.length) await tx.update(tokenSets).set({ tokenCount: n }).where(eq(tokenSets.id, setId));
      await upsertEvidence(tx, { subjectType: "token_set", subjectId: setId, designSystemId: pc.systemId, evidence: s.evidence, lookup: pc.lookup, fallbackDate: pc.runDate, replace: true });
      out.tokensAdded += added;
      out.tokensUpdated += updated;
      out.tokensRemoved += removed;
      const countChange = { field: "tokens", before: prev?.tokenCount ?? 0, after: n, summary: `tokens: +${added} -${removed} ~${updated} (${n} total)` };
      if (!prev) {
        await writeChange(pc, { entityType: "token_set", entityId: setId, entityLabel: s.name, changeKind: "created", fieldChanges: [countChange] });
        counters.created++;
      } else {
        const before = await previousPayload(pc, "token-set", e.key);
        const changes = diffPayload(before, e.payload).filter((c) => c.field !== "tokens");
        if (prev.publishState !== "published") changes.unshift({ field: "publishState", before: prev.publishState, after: "published", summary: `publishState: ${prev.publishState} -> published` });
        await writeChange(pc, { entityType: "token_set", entityId: setId, entityLabel: s.name, changeKind: "updated", fieldChanges: [countChange, ...changes] });
        counters.updated++;
      }
    });
    if (ok) out.promotedKeys.add(e.key);
  }

  if (pc.allowRemovals) {
    const gone = await tx
      .update(tokenSets)
      .set({ publishState: "retired", updatedAt: sql`now()` })
      .where(and(eq(tokenSets.designSystemId, pc.systemId), eq(tokenSets.publishState, "published"), allKeys.size ? notInArray(tokenSets.slug, [...allKeys]) : sql`true`))
      .returning({ id: tokenSets.id, name: tokenSets.name });
    for (const g of gone) {
      await writeChange(pc, { entityType: "token_set", entityId: g.id, entityLabel: g.name, changeKind: "removed", fieldChanges: [{ field: "publishState", before: "published", after: "retired", summary: "token set not present in source; retired" }] });
      counters.removed++;
    }
  }

  await resolveSystemTokens(pc, refsBySet);
  return out;
}

interface ScopeToken {
  id: string;
  setId: string;
  name: string;
  cssVar: string | null;
  rawValue: unknown;
  type: string | null;
  references: string[];
  resolvedValue: unknown;
  valueText: string | null;
  isAlias: boolean;
  aliasState: string | null;
}

interface ThemeVariant {
  label: string; // themed set slug, e.g. "m3-sys-color-dark", "theme-g100"
  graph: Map<string, TokenResolution>;
  byName: Map<string, ScopeToken>;
}

/**
 * For a theme-agnostic set S, one resolution context per themed set T:
 * S, then theme-agnostic sets, then T, then T's sibling sets of the same theme.
 */
function themedVariants(
  s: { id: string; theme: string | null; slug: string },
  sets: { id: string; theme: string | null; slug: string }[],
  bySet: Map<string, ScopeToken[]>,
): ThemeVariant[] {
  const themed = sets.filter((o) => o.theme !== null && (bySet.get(o.id)?.length ?? 0) > 0);
  if (!themed.length) return [];
  const base = sets.filter((o) => o.id !== s.id && o.theme === null);
  return themed
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((t) => {
      const siblings = themed.filter((o) => o.id !== t.id && o.theme === t.theme);
      const scope: ScopeToken[] = [];
      const taken = new Set<string>();
      for (const g of [s, ...base, t, ...siblings]) {
        for (const tok of bySet.get(g.id) ?? []) {
          if (taken.has(tok.name)) continue;
          taken.add(tok.name);
          scope.push(tok);
        }
      }
      return {
        label: t.slug,
        graph: resolveTokenGraph(scope.map((x): GraphTokenInput => ({ name: x.name, rawValue: x.rawValue, references: x.references, cssVar: x.cssVar }))),
        byName: new Map(scope.map((x) => [x.name, x])),
      };
    });
}

/** Resolve aliases for every published token of the system and diff-sync results. */
export async function resolveSystemTokens(pc: PromoteContext, refsBySet: Map<string, Map<string, string[]>>) {
  const tx = pc.tx;
  const sets = await tx
    .select({ id: tokenSets.id, theme: tokenSets.theme, slug: tokenSets.slug })
    .from(tokenSets)
    .where(and(eq(tokenSets.designSystemId, pc.systemId), eq(tokenSets.publishState, "published")));
  if (!sets.length) return;
  const setIds = sets.map((s) => s.id);
  const rows = await tx
    .select({ id: tokens.id, setId: tokens.tokenSetId, name: tokens.name, cssVar: tokens.cssVar, rawValue: tokens.rawValue, type: tokens.type, resolvedValue: tokens.resolvedValue, valueText: tokens.valueText, isAlias: tokens.isAlias, aliasState: tokens.aliasState })
    .from(tokens)
    .where(inArray(tokens.tokenSetId, setIds));
  const aliasRows = await tx
    .select({ id: tokenAliases.id, tokenId: tokenAliases.tokenId, targetRef: tokenAliases.targetRef, targetTokenId: tokenAliases.targetTokenId, state: tokenAliases.state, depth: tokenAliases.depth })
    .from(tokenAliases)
    .innerJoin(tokens, eq(tokens.id, tokenAliases.tokenId))
    .where(eq(tokens.designSystemId, pc.systemId));
  const storedRefs = new Map<string, string[]>();
  for (const a of aliasRows) {
    const l = storedRefs.get(a.tokenId) ?? [];
    l.push(a.targetRef);
    storedRefs.set(a.tokenId, l);
  }
  const bySet = new Map<string, ScopeToken[]>();
  for (const r of rows) {
    const refs = refsBySet.get(r.setId)?.get(r.name) ?? storedRefs.get(r.id) ?? [];
    const t: ScopeToken = { ...r, references: refs };
    const l = bySet.get(r.setId) ?? [];
    l.push(t);
    bySet.set(r.setId, l);
  }

  const updates: Record<string, unknown>[] = [];
  const desiredAliases = new Map<string, { tokenId: string; targetRef: string; targetTokenId: string | null; state: string; depth: number | null }>();
  for (const s of sets) {
    const own = bySet.get(s.id) ?? [];
    if (!own.length) continue;
    const sameTheme = sets.filter((o) => o.id !== s.id && o.theme === s.theme && s.theme !== null);
    const base = sets.filter((o) => o.id !== s.id && o.theme === null);
    const scope: ScopeToken[] = [];
    const taken = new Set<string>();
    for (const group of [[s], sameTheme, base]) {
      for (const g of group) {
        for (const t of bySet.get(g.id) ?? []) {
          if (taken.has(t.name)) continue;
          taken.add(t.name);
          scope.push(t);
        }
      }
    }
    const byName = new Map(scope.map((t) => [t.name, t]));
    const graph = resolveTokenGraph(scope.map((t): GraphTokenInput => ({ name: t.name, rawValue: t.rawValue, references: t.references, cssVar: t.cssVar })));
    // Theme-agnostic sets (e.g. component tokens) often reference semantic tokens that only exist in themed sets
    // (light/dark). Those are not "external": they resolve differently per theme. Resolve them once per themed set.
    const variants = s.theme === null ? themedVariants(s, sets, bySet) : [];
    for (const t of own) {
      const res: TokenResolution | undefined = graph.get(t.name);
      const cols = resolutionColumns(res);
      let resolvedValue = res ? (cols.resolvedValue ?? null) : (t.rawValue ?? null);
      const isAlias = res ? cols.isAlias : false;
      let aliasState: string | null = res ? cols.aliasState : null;
      let valueText = formatTokenValue(resolvedValue, t.type);
      let themedTarget: { byName: Map<string, ScopeToken>; res: TokenResolution } | null = null;
      if (variants.length && res && (cols.aliasState === "external" || cols.aliasState === "unresolved")) {
        const perTheme: { label: string; value: unknown; byName: Map<string, ScopeToken>; res: TokenResolution }[] = [];
        for (const v of variants) {
          const vr = v.graph.get(t.name);
          if (vr && vr.state === "resolved" && vr.resolvedValue !== undefined) perTheme.push({ label: v.label, value: vr.resolvedValue, byName: v.byName, res: vr });
        }
        if (perTheme.length) {
          const distinct = new Set(perTheme.map((p) => contentHash(p.value)));
          if (distinct.size === 1 && perTheme.length === variants.length) {
            resolvedValue = perTheme[0]!.value as typeof resolvedValue;
            aliasState = "resolved";
            valueText = formatTokenValue(resolvedValue, t.type);
          } else {
            resolvedValue = { $themes: Object.fromEntries(perTheme.map((p) => [p.label, p.value])) } as typeof resolvedValue;
            aliasState = "theme-dependent";
            valueText = perTheme.map((p) => `${p.label}: ${formatTokenValue(p.value, t.type) ?? "?"}`).join(" · ");
          }
          themedTarget = { byName: perTheme[0]!.byName, res: perTheme[0]!.res };
        }
      }
      if (contentHash([t.resolvedValue ?? null, t.valueText ?? null, t.isAlias, t.aliasState ?? null]) !== contentHash([resolvedValue, valueText ?? null, isAlias, aliasState])) {
        updates.push({ id: t.id, resolved_value: resolvedValue, value_text: valueText, is_alias: isAlias, alias_state: aliasState });
      }
      if (themedTarget) {
        // Link alias rows to the first themed variant's target; state records that the target is per-theme.
        for (const row of tokenAliasRows(themedTarget.res)) {
          const target = row.targetName ? (byName.get(row.targetName) ?? themedTarget.byName.get(row.targetName)) : undefined;
          desiredAliases.set(`${t.id}|${row.targetRef}`, {
            tokenId: t.id,
            targetRef: row.targetRef,
            targetTokenId: target?.id ?? null,
            state: row.state === "resolved" && aliasState === "theme-dependent" ? "theme-dependent" : row.state,
            depth: row.depth,
          });
        }
        continue;
      }
      for (const row of tokenAliasRows(res)) {
        const target = row.targetName ? byName.get(row.targetName) : undefined;
        desiredAliases.set(`${t.id}|${row.targetRef}`, { tokenId: t.id, targetRef: row.targetRef, targetTokenId: target?.id ?? null, state: row.state, depth: row.depth });
      }
    }
  }
  await bulkUpdate(tx, "token", updates, {
    resolved_value: ["resolved_value", "jsonb"],
    value_text: ["value_text", "text"],
    is_alias: ["is_alias", "boolean"],
    alias_state: ["alias_state", "text"],
  });

  const have = new Map(aliasRows.map((a) => [`${a.tokenId}|${a.targetRef}`, a]));
  const toDelete = aliasRows.filter((a) => !desiredAliases.has(`${a.tokenId}|${a.targetRef}`)).map((a) => a.id);
  const toInsert = [...desiredAliases.entries()].filter(([k]) => !have.has(k)).map(([, v]) => v);
  const toUpdate = [...desiredAliases.entries()]
    .filter(([k, v]) => {
      const h = have.get(k);
      return h && (h.targetTokenId !== v.targetTokenId || h.state !== v.state || h.depth !== v.depth);
    })
    .map(([k, v]) => ({ id: have.get(k)!.id, target_token_id: v.targetTokenId, state: v.state, depth: v.depth }));
  for (let i = 0; i < toDelete.length; i += 1000) await tx.delete(tokenAliases).where(inArray(tokenAliases.id, toDelete.slice(i, i + 1000)));
  for (let i = 0; i < toInsert.length; i += 500) await tx.insert(tokenAliases).values(toInsert.slice(i, i + 500));
  await bulkUpdate(tx, "token_alias", toUpdate, { target_token_id: ["target_token_id", "uuid"], state: ["state", "text"], depth: ["depth", "integer"] });
}
