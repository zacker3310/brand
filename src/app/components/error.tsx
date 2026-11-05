"use client";

import { CatalogRouteError } from "@/components/catalog/route-error";

export default function ComponentsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CatalogRouteError error={error} retry={retry} title="The component catalog couldn't load" backHref="/" backLabel="Go home" />;
}
