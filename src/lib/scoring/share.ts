/**
 * Input contract for POST /api/comparisons (saved, shareable comparisons). Accepts JSON or a
 * form-encoded body (the no-JS "Save" form); both normalize to CreateComparisonInput.
 */
import { z } from "zod";
import { MAX_SYSTEMS, MIN_SYSTEMS, isSlug, parsePicks, parseSlugList } from "./params";
import { CRITERIA } from "./types";

const slug = z.string().trim().toLowerCase().refine(isSlug, "must be a lowercase slug");

export const CreateComparisonInput = z
  .object({
    type: slug.nullish(),
    systems: z.array(slug).min(MIN_SYSTEMS, `select at least ${MIN_SYSTEMS} systems`).max(MAX_SYSTEMS, `select at most ${MAX_SYSTEMS} systems`),
    title: z
      .string()
      .trim()
      .max(140)
      .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
      .nullish(),
    criteria: z.array(z.enum(CRITERIA)).max(CRITERIA.length).nullish(),
    picks: z.record(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100)).nullish(),
  })
  .strict()
  .refine((v) => new Set(v.systems).size === v.systems.length, { message: "systems must be unique", path: ["systems"] });
export type CreateComparisonInput = z.infer<typeof CreateComparisonInput>;

/** Form fields (repeated or comma-separated) -> the JSON shape validated above. */
export function formToComparisonInput(form: URLSearchParams): Record<string, unknown> {
  const systems = parseSlugList(form.getAll("systems"));
  const criteria = parseSlugList(form.getAll("criteria"));
  const type = form.get("type")?.trim() || null;
  const title = form.get("title")?.trim() || null;
  const picks = parsePicks(form.getAll("pick"), systems);
  return {
    type,
    systems,
    ...(title ? { title } : {}),
    ...(criteria.length ? { criteria } : {}),
    ...(Object.keys(picks).length ? { picks } : {}),
  };
}
