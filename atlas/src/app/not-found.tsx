import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={CompassIcon}
        title="Not in the index"
        description="This record isn't in ATLAS. It may not be indexed yet, or the system may not document it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/systems">Browse design systems</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
