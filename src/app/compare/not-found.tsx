import { ShapesIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageContainer } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";

export default function CompareNotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={ShapesIcon}
        title="Not in the ATLAS taxonomy"
        description="This component type or saved comparison isn't in ATLAS. Types use canonical slugs such as button, combobox or date-picker; saved links may have been mistyped."
        action={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/compare">Choose a comparison</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/components">Browse component types</Link>
            </Button>
          </div>
        }
      />
    </PageContainer>
  );
}
