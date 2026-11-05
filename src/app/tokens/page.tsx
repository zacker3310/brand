import type { Metadata } from "next";
import { resolveExplorerTitle, TokenExplorer } from "@/components/tokens/explorer";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const title = await resolveExplorerTitle(await searchParams);
  return {
    title,
    description: "Explore design tokens extracted from official token packages: color ramps, alias chains, themes, contrast, typography, spacing, shape, elevation and motion.",
  };
}

export default async function TokensPage({ searchParams }: Props) {
  return <TokenExplorer raw={await searchParams} />;
}
