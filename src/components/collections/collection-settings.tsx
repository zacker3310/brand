"use client";

import { Loader2Icon, Settings2Icon, Trash2Icon } from "lucide-react";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteCollectionAction, updateCollectionAction } from "@/app/collections/actions";
import { LIMITS } from "./schema";

/** Rename / describe / delete. A <details> panel: fully usable without JavaScript. */
export function CollectionSettings({ id, name, description, itemCount }: { id: string; name: string; description: string | null; itemCount: number }) {
  const [state, action, pending] = useActionState(updateCollectionAction, null);
  const uid = useId();
  return (
    <details className="group/settings w-full">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors select-none hover:bg-accent dark:border-input dark:bg-input/30 [&::-webkit-details-marker]:hidden">
        <Settings2Icon className="size-4" aria-hidden /> Edit
      </summary>
      <div className="mt-3 grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <form action={action} className="space-y-3">
          <input type="hidden" name="collectionId" value={id} />
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-name`}>Name</Label>
            <Input id={`${uid}-name`} name="name" defaultValue={name} required maxLength={LIMITS.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-desc`}>Description</Label>
            <Textarea id={`${uid}-desc`} name="description" defaultValue={description ?? ""} maxLength={LIMITS.description} rows={2} className="min-h-16" />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              Save changes
            </Button>
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {state ? (state.ok ? "Saved. The URL stays the same." : <span className="text-destructive">{state.message}</span>) : ""}
            </p>
          </div>
        </form>
        <form action={deleteCollectionAction} className="space-y-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <input type="hidden" name="collectionId" value={id} />
          <p className="text-sm font-medium">Delete collection</p>
          <p className="text-xs text-muted-foreground">Removes the collection and its {itemCount === 1 ? "1 item" : `${itemCount} items`}. The indexed records themselves are not affected.</p>
          <label htmlFor={`${uid}-confirm`} className="flex items-center gap-2 text-xs">
            <Checkbox id={`${uid}-confirm`} name="confirm" required />I understand this can’t be undone
          </label>
          <Button type="submit" size="sm" variant="destructive">
            <Trash2Icon aria-hidden /> Delete
          </Button>
        </form>
      </div>
    </details>
  );
}
