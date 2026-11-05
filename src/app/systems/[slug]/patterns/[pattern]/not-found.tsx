import Link from "next/link";
import { ShapesIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function PatternNotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={ShapesIcon}
        title="Pattern not in the index"
        description="ATLAS has no published pattern at this address. It may not be ingested yet, or the system may document it under another name."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/patterns">Pattern library</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
