"use client";

import { CheckIcon, Loader2Icon, PencilIcon } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateItemAction } from "@/app/collections/actions";
import { LIMITS } from "./schema";

/**
 * Inline note + tags editor for one collection item. A native <details> disclosure, so it opens
 * and submits without JavaScript; with JS the save is in place and announced.
 */
export function ItemEditor({ itemId, slug, note, tags, title }: { itemId: string; slug: string; note: string | null; tags: string[]; title: string }) {
  const [state, action, pending] = useActionState(updateItemAction, null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const id = useId();
  useEffect(() => {
    if (state?.ok && ref.current) {
      ref.current.open = false;
      setOpen(false);
    }
  }, [state]);
  const err = state && !state.ok ? state.message : null;
  return (
    <details ref={ref} className="group/edit" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary
        className="inline-flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
        aria-expanded={open}
      >
        <PencilIcon className="size-3.5" aria-hidden />
        <span>{note || tags.length ? "Edit note" : "Add note"}</span>
        <span className="sr-only">{` and tags for ${title}`}</span>
      </summary>
      <form action={action} className="mt-2 space-y-3 rounded-lg border bg-surface-1 p-3">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="slug" value={slug} />
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-note`} className="text-xs">
            Note
          </Label>
          <Textarea id={`${id}-note`} name="note" defaultValue={note ?? ""} maxLength={LIMITS.note} rows={3} className="min-h-16 bg-background text-sm" placeholder="Why is this here?" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-tags`} className="text-xs">
            Tags <span className="font-normal text-muted-foreground">comma-separated</span>
          </Label>
          <Input id={`${id}-tags`} name="tags" defaultValue={tags.join(", ")} className="h-8 bg-background font-mono text-xs" placeholder="review, a11y" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs" role="status" aria-live="polite">
            {err ? <span className="text-destructive">{err}</span> : state?.ok ? <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckIcon className="size-3" aria-hidden /> Saved</span> : null}
          </p>
          <Button type="submit" size="xs" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
      </form>
    </details>
  );
}
