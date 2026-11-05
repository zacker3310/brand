import { notFound, redirect } from "next/navigation";
import { getSystemMeta } from "@/server/queries/systems";

/**
 * A system's component list lives in the universal catalog, filtered to that system.
 * The existence check runs first so an unknown slug is a real 404 (systems/[slug]/not-found.tsx)
 * rather than a redirect to an empty catalog filter; a known slug gets an HTTP 307.
 */
export default async function SystemComponentsIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await getSystemMeta(slug))) notFound();
  redirect(`/components?view=components&system=${encodeURIComponent(slug)}`);
}
