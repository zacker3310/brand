import type { Metadata } from "next";
import { ComparePage } from "@/components/tokens/compare/compare-page";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = {
  title: "Compare token scales",
  description: "Spacing, shape and typography scales of design systems aligned by numeric value. Alignment by value does not imply semantic equivalence.",
};

export default async function TokensComparePage({ searchParams }: Props) {
  return <ComparePage raw={await searchParams} />;
}
