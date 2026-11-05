import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

/**
 * Shown for slugs that are not a published, verified system (and for records under them that
 * don't exist). Rejected and duplicate registry candidates are listed under Registry decisions.
 */
export default function SystemNotFound() {
  return (
    <PageContainer className="py-16">
      <EmptyState
        icon={CompassIcon}
        title="This design system isn't in the index"
        description={
          <>
            The address doesn&apos;t match a verified system or record in ATLAS. It may be misspelled, or the candidate may have been rejected or merged as a duplicate during
            registry review; those decisions are kept on record with their reasoning.
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/systems">Browse all systems</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/systems?registry=all">See registry decisions</Link>
            </Button>
          </div>
        }
      />
    </PageContainer>
  );
}
