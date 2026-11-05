/**
 * Collections & bookmarks input contracts (Zod). Shared by Server Actions, the REST API and client
 * components (pure module: no server imports).
 */
import { z } from "zod";

export const ENTITY_TYPES = ["system", "component", "component-type", "token", "pattern", "comparison"] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export const ENTITY_TYPE_LABELS: Record<EntityType, { one: string; many: string }> = {
  system: { one: "Design system", many: "Design systems" },
  component: { one: "Component", many: "Components" },
  "component-type": { one: "Component type", many: "Component types" },
  token: { one: "Token", many: "Tokens" },
  pattern: { one: "Pattern", many: "Patterns" },
  comparison: { one: "Comparison", many: "Comparisons" },
};

export const LIMITS = {
  collectionsPerOwner: 200,
  itemsPerCollection: 1000,
  bookmarksPerOwner: 2000,
  name: 80,
  description: 500,
  note: 1000,
  tags: 12,
  tag: 32,
} as const;

/** entityId is the record's UUID (`id` column of system/component/token/... tables). */
export const EntityRef = z.object({
  entityType: EntityType,
  entityId: z.uuid({ message: "must be a record UUID" }),
});
export type EntityRef = z.infer<typeof EntityRef>;

const trimmed = (max: number, label: string) => z.string().trim().max(max, `${label} must be at most ${max} characters`);

export const CollectionInput = z.object({
  name: trimmed(LIMITS.name, "Name").min(1, "Name is required"),
  description: trimmed(LIMITS.description, "Description")
    .optional()
    .transform((v) => (v ? v : null)),
});
export type CollectionInput = z.infer<typeof CollectionInput>;

/** Tags arrive as "a, b, c" from forms or as arrays from JSON. Normalized: lowercase, de-duplicated. */
export const TagsInput = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const raw = Array.isArray(v) ? v : (v ?? "").split(",");
    return [...new Set(raw.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
  })
  .pipe(
    z
      .array(z.string().max(LIMITS.tag, `Tags must be at most ${LIMITS.tag} characters`).regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, "Tags may use letters, numbers, dot, dash and underscore"))
      .max(LIMITS.tags, `At most ${LIMITS.tags} tags`),
  );

export const ItemInput = z.object({
  note: trimmed(LIMITS.note, "Note")
    .optional()
    .transform((v) => (v ? v : null)),
  tags: TagsInput,
});
export type ItemInput = z.infer<typeof ItemInput>;

export const MoveDirection = z.enum(["up", "down", "top", "bottom"]);
export type MoveDirection = z.infer<typeof MoveDirection>;

/** Server Action result shape (also used by useActionState). */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export function fieldErrorsOf(e: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of e.issues) {
    const k = String(i.path[0] ?? "form");
    (out[k] ??= []).push(i.message);
  }
  return out;
}
