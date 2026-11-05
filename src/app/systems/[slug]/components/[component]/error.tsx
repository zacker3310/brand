"use client";

import { CatalogRouteError } from "@/components/catalog/route-error";

export default function ComponentDetailError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CatalogRouteError error={error} retry={retry} title="This component couldn't load" backHref="/components" backLabel="Back to the catalog" />;
}
