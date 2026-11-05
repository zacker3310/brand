import { AddToCollectionDialog } from "./add-to-collection-dialog";
import { BookmarkButton } from "./bookmark-button";
import type { EntityType } from "./schema";

/** Bookmark + add-to-collection controls for detail pages. */
export function EntityActions({ entityType, entityId, label, className }: { entityType: EntityType; entityId: string; label: string; className?: string }) {
  return (
    <div className={className ?? "flex items-center gap-1.5"}>
      <BookmarkButton entityType={entityType} entityId={entityId} label={label} showLabel />
      <AddToCollectionDialog entityType={entityType} entityId={entityId} label={label} />
    </div>
  );
}
