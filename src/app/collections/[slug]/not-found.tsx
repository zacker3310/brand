import { FolderXIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageContainer } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function CollectionNotFound() {
  return (
    <PageContainer>
      <EmptyState
        icon={FolderXIcon}
        title="Collection not found"
        description="It may have been deleted, or it belongs to another browser: personal collections are private to the browser that created them."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/collections">All collections</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
