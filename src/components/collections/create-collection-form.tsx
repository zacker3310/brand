"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCollectionAction } from "@/app/collections/actions";
import { LIMITS } from "./schema";

/** New collection form. Server Action + redirect, so it works without JavaScript. */
export function CreateCollectionForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const [state, action, pending] = useActionState(createCollectionAction, null);
  const id = useId();
  const nameErr = state && !state.ok ? state.fieldErrors?.name?.[0] : undefined;
  const descErr = state && !state.ok ? state.fieldErrors?.description?.[0] : undefined;
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={LIMITS.name}
          placeholder="e.g. Combobox implementations"
          autoFocus={autoFocus}
          aria-invalid={!!nameErr}
          aria-describedby={nameErr ? `${id}-name-err` : undefined}
        />
        {nameErr && (
          <p id={`${id}-name-err`} className="text-xs text-destructive">
            {nameErr}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-desc`}>
          Description <span className="font-normal text-subtle-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`${id}-desc`}
          name="description"
          rows={2}
          maxLength={LIMITS.description}
          placeholder="What is this list for?"
          className="min-h-16 resize-y"
          aria-invalid={!!descErr}
        />
        {descErr && <p className="text-xs text-destructive">{descErr}</p>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {state && !state.ok && !state.fieldErrors ? state.message : ""}
        </p>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
          Create collection
        </Button>
      </div>
    </form>
  );
}
