"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addToCollectionFormAction } from "@/app/collections/actions";
import { LIMITS, type EntityType } from "./schema";

/** Server-rendered equivalent of AddToCollectionDialog (works without JavaScript). */
export function AddToCollectionForm({
  entityType,
  entityId,
  collections,
}: {
  entityType: EntityType;
  entityId: string;
  collections: { id: string; name: string; itemCount: number; contains: boolean }[];
}) {
  const [state, action, pending] = useActionState(addToCollectionFormAction, null);
  const id = useId();
  const firstFree = collections.find((c) => !c.contains);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <fieldset className="space-y-1">
        <legend className="mb-2 text-sm font-medium">Collection</legend>
        <div className="divide-y rounded-lg border">
          {collections.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input type="radio" name="collectionId" value={c.id} disabled={c.contains} defaultChecked={c.id === firstFree?.id} className="accent-[var(--primary)]" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.contains ? "Already added" : `${c.itemCount} items`}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
            <input type="radio" name="collectionId" value="new" defaultChecked={!firstFree} className="accent-[var(--primary)]" />
            <span className="shrink-0">New collection:</span>
            <Input name="newName" maxLength={LIMITS.name} placeholder="Name" className="h-8" aria-label="New collection name" />
          </label>
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id={`${id}-note`} name="note" maxLength={LIMITS.note} rows={2} className="min-h-16" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" aria-hidden />}
          Add to collection
        </Button>
        <p className="text-sm text-destructive" role="status" aria-live="polite">
          {state && !state.ok ? state.message : ""}
        </p>
      </div>
    </form>
  );
}
