import { redirect } from "next/navigation";

/** A system's component list lives in the universal catalog, filtered to that system. */
export default async function SystemComponentsIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/components?view=components&system=${encodeURIComponent(slug)}`);
}
