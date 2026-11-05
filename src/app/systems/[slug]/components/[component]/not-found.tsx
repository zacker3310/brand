import Link from "next/link";
import { BoxIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function ComponentNotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={BoxIcon}
        title="This component isn't in ATLAS's index"
        description="The system may not be indexed at component level yet, the component may use a different name, or the link may be outdated. Absence from the index is not evidence the component doesn't exist."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/components?view=components">Browse indexed components</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/systems">All systems</Link>
            </Button>
          </div>
        }
      />
    </PageContainer>
  );
}
