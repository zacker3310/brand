import Link from "next/link";
import { ShapesIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function PatternTypeNotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={ShapesIcon}
        title="Not an ATLAS pattern type"
        description="This pattern type isn't part of the ATLAS taxonomy. Browse the library for the types ATLAS defines and the systems that document them."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/patterns">Pattern library</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
