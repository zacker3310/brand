import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { componentCompareHref, decodeSavedCriteria, systemCompareHref } from "@/lib/scoring/params";
import { getComparisonBySlug } from "@/server/queries/compare";

type Props = { params: Promise<{ slug: string }> };

const SLUG_RE = /^[A-Za-z0-9]{6,16}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const saved = SLUG_RE.test(slug) ? await getComparisonBySlug(slug) : null;
  if (!saved) notFound();
  return { title: saved.title, description: `Saved ATLAS comparison: ${saved.title}.` };
}

/**
 * Short, shareable link for a saved comparison. Saved comparisons store the selection, not a
 * snapshot, so this redirects to the canonical comparison URL (with ?saved= for the banner).
 */
export default async function SavedComparisonPage({ params }: Props) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const saved = await getComparisonBySlug(slug);
  if (!saved) notFound();
  const { criteria, picks } = decodeSavedCriteria(saved.criteria);
  if (saved.typeSlug) redirect(componentCompareHref({ type: saved.typeSlug, systems: saved.systemSlugs, picks, saved: saved.slug }));
  redirect(systemCompareHref({ systems: saved.systemSlugs, criteria, saved: saved.slug }));
}
