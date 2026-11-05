"use client";

import { CatalogRouteError } from "@/components/catalog/route-error";

export default function ComponentTypeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CatalogRouteError error={error} retry={retry} title="This component type couldn't load" backHref="/components" backLabel="Back to the catalog" />;
}
