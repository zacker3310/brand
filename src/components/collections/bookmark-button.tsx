"use client";

/**
 * BookmarkButton: stable, reusable API for any page.
 *
 *   <BookmarkButton entityType="component" entityId={component.id} label={component.name} />
 *
 * - entityType: "system" | "component" | "component-type" | "token" | "pattern" | "comparison"
 * - entityId:   the record's UUID (`id` column)
 * - label:      human name, used for the accessible name and the confirmation toast
 * Optional: initialBookmarked (skips the status lookup), showLabel, size, className.
 *
 * Progressive enhancement: it is a real <form> posting to a Server Action, so it works without
 * JavaScript; with JS it toggles optimistically and announces the result.
 */
import { BookmarkCheckIcon, BookmarkIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toggleBookmarkAction, toggleBookmarkFormAction } from "@/app/collections/actions";
import { loadBookmarked, refKey, setBookmarked, subscribeBookmarked } from "./bookmark-status";
import type { EntityType } from "./schema";

export interface BookmarkButtonProps {
  entityType: EntityType;
  entityId: string;
  label: string;
  initialBookmarked?: boolean;
  showLabel?: boolean;
  size?: "sm" | "icon-sm" | "xs";
  className?: string;
}

export function BookmarkButton({ entityType, entityId, label, initialBookmarked, showLabel = false, size, className }: BookmarkButtonProps) {
  const key = refKey(entityType, entityId);
  const [bookmarked, setState] = useState<boolean | null>(initialBookmarked ?? null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    if (initialBookmarked === undefined) {
      loadBookmarked(key).then((v) => {
        if (alive && v !== null) setState(v);
      });
    }
    const off = subscribeBookmarked(key, (v) => alive && setState(v));
    return () => {
      alive = false;
      off();
    };
  }, [key, initialBookmarked]);

  const on = bookmarked === true;
  const Icon = on ? BookmarkCheckIcon : BookmarkIcon;
  const actionLabel = on ? `Remove bookmark: ${label}` : `Bookmark ${label}`;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const want = !on;
    setState(want);
    startTransition(async () => {
      const r = await toggleBookmarkAction({ entityType, entityId, want });
      if (!r.ok) {
        setState(!want);
        toast.error("Bookmark not saved", { description: r.message });
        return;
      }
      setBookmarked(key, r.data?.bookmarked ?? want);
      toast.success(want ? `Bookmarked ${label}` : `Removed bookmark for ${label}`, {
        action: want ? { label: "View", onClick: () => router.push("/collections#bookmarks") } : undefined,
      });
    });
  }

  const effectiveSize = size ?? (showLabel ? "sm" : "icon-sm");
  const button = (
    <Button
      type="submit"
      variant="outline"
      size={effectiveSize}
      aria-pressed={bookmarked === null ? undefined : on}
      aria-label={showLabel ? undefined : actionLabel}
      disabled={pending}
      data-state={on ? "on" : "off"}
      className={cn("transition-colors data-[state=on]:border-primary/40 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground", className)}
    >
      <Icon aria-hidden className={cn(on && "text-primary")} />
      {showLabel && <span>{on ? "Bookmarked" : "Bookmark"}</span>}
    </Button>
  );

  return (
    <form action={toggleBookmarkFormAction} onSubmit={onSubmit} className="inline-flex">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      {bookmarked !== null && <input type="hidden" name="want" value={on ? "0" : "1"} />}
      {showLabel ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{on ? "Bookmarked · click to remove" : "Bookmark"}</TooltipContent>
        </Tooltip>
      )}
    </form>
  );
}

/** Small link to the bookmarks list, for page toolbars that host a BookmarkButton. */
export function BookmarksLink({ className }: { className?: string }) {
  return (
    <Link href="/collections#bookmarks" className={cn("text-xs text-muted-foreground hover:text-foreground", className)}>
      Your bookmarks
    </Link>
  );
}
