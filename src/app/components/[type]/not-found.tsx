import Link from "next/link";
import { ShapesIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function ComponentTypeNotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={ShapesIcon}
        title="Not an ATLAS canonical type"
        description="This slug isn't in the ATLAS taxonomy. System-specific names live on component pages; the catalog maps them to canonical types."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/components">Browse all component types</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
