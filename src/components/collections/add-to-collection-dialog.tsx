"use client";

/**
 * AddToCollectionDialog: stable, reusable API for any page.
 *
 *   <AddToCollectionDialog entityType="system" entityId={system.id} label={system.name} />
 *
 * - entityType / entityId (record UUID) / label as for BookmarkButton.
 * - trigger (optional): a custom trigger element; defaults to an outline "Collect" button.
 *
 * Without JavaScript the trigger is a link to /collections/add?..., a server-rendered form doing the
 * same job. With JS it opens a dialog listing the visitor's collections as checkboxes (toggle
 * membership in place) plus inline "new collection" creation. Results are announced via aria-live.
 */
import { CheckIcon, FolderPlusIcon, Loader2Icon, PlusIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { cloneElement, isValidElement, useCallback, useEffect, useId, useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCount } from "@/lib/utils";
import { addItemAction, createCollectionWithItemAction, removeEntityAction } from "@/app/collections/actions";
import { ENTITY_TYPE_LABELS, LIMITS, type EntityType } from "./schema";

export interface AddToCollectionDialogProps {
  entityType: EntityType;
  entityId: string;
  label: string;
  trigger?: ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  className?: string;
}

interface Membership {
  bookmarked: boolean;
  collections: { id: string; slug: string; name: string; itemCount: number; contains: boolean; itemId: string | null }[];
}

export function addToCollectionHref(entityType: EntityType, entityId: string) {
  return `/collections/add?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
}

export function AddToCollectionDialog({ entityType, entityId, label, trigger, className }: AddToCollectionDialogProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Membership | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [creating, startCreate] = useTransition();
  const [, startToggle] = useTransition();
  const nameId = useId();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/collections/membership?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(((await res.json()) as { data: Membership }).data);
    } catch {
      setError("Your collections couldn’t be loaded.");
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (open) {
      setData(null);
      load();
    }
  }, [open, load]);

  function toggle(c: Membership["collections"][number]) {
    const want = !c.contains;
    setBusyId(c.id);
    setData((d) => d && { ...d, collections: d.collections.map((x) => (x.id === c.id ? { ...x, contains: want, itemCount: x.itemCount + (want ? 1 : -1) } : x)) });
    startToggle(async () => {
      const r = want ? await addItemAction({ collectionId: c.id, entityType, entityId }) : await removeEntityAction({ collectionId: c.id, entityType, entityId });
      setBusyId(null);
      if (!r.ok) {
        setData((d) => d && { ...d, collections: d.collections.map((x) => (x.id === c.id ? { ...x, contains: !want, itemCount: x.itemCount + (want ? -1 : 1) } : x)) });
        setStatus(r.message);
        toast.error(r.message);
        return;
      }
      setStatus(want ? `Added ${label} to ${c.name}` : `Removed ${label} from ${c.name}`);
    });
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    startCreate(async () => {
      const r = await createCollectionWithItemAction({ name: n, entityType, entityId });
      if (!r.ok || !r.data) {
        setStatus(r.ok ? "Could not create the collection" : r.message);
        toast.error(r.ok ? "Could not create the collection" : r.message);
        return;
      }
      const created = r.data;
      setName("");
      setData((d) => ({
        bookmarked: d?.bookmarked ?? false,
        collections: [{ id: created.id, slug: created.slug, name: created.name, itemCount: 1, contains: true, itemId: null }, ...(d?.collections ?? [])],
      }));
      setStatus(`Created ${created.name} and added ${label}`);
      toast.success(`Added to “${created.name}”`, { action: { label: "Open", onClick: () => window.location.assign(`/collections/${created.slug}`) } });
    });
  }

  const href = addToCollectionHref(entityType, entityId);
  const onTriggerClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setOpen(true);
  };

  const triggerEl =
    trigger && isValidElement(trigger) ? (
      cloneElement(trigger, { onClick: onTriggerClick })
    ) : (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link href={href} onClick={onTriggerClick} aria-haspopup="dialog" aria-label={`Add ${label} to a collection`}>
          <FolderPlusIcon aria-hidden />
          <span>Collect</span>
        </Link>
      </Button>
    );

  return (
    <>
      {triggerEl}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle className="text-base">Add to collection</DialogTitle>
            <DialogDescription className="truncate">
              <span className="text-subtle-foreground">{ENTITY_TYPE_LABELS[entityType].one} · </span>
              <span className="text-foreground">{label}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto px-2 py-2" aria-busy={!data && !error}>
            {error ? (
              <div className="flex flex-col items-start gap-3 px-3 py-4 text-sm">
                <p className="text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" onClick={load}>
                  <RotateCcwIcon aria-hidden /> Retry
                </Button>
              </div>
            ) : !data ? (
              <div className="space-y-2 px-3 py-2">
                <span className="sr-only">Loading your collections</span>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : data.collections.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">You don’t have any collections yet. Name one below to create it with this {ENTITY_TYPE_LABELS[entityType].one.toLowerCase()} inside.</p>
            ) : (
              <ul className="space-y-0.5" aria-label="Your collections">
                {data.collections.map((c) => {
                  const id = `col-${c.id}`;
                  return (
                    <li key={c.id}>
                      <label
                        htmlFor={id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted has-[:focus-visible]:bg-muted",
                          busyId === c.id && "opacity-70",
                        )}
                      >
                        <Checkbox id={id} checked={c.contains} onCheckedChange={() => toggle(c)} disabled={busyId === c.id} />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="tabular text-xs text-subtle-foreground">{formatCount(c.itemCount)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <form onSubmit={create} className="flex items-end gap-2 border-t px-5 py-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor={nameId} className="text-xs text-muted-foreground">
                New collection
              </Label>
              <Input id={nameId} value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Date pickers to review" className="h-8" />
            </div>
            <Button type="submit" size="sm" disabled={creating || !name.trim()}>
              {creating ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
              Create & add
            </Button>
          </form>

          <DialogFooter className="flex-row items-center justify-between border-t bg-surface-1 px-5 py-3 sm:justify-between">
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {status ? (
                <span className="inline-flex items-center gap-1">
                  <CheckIcon className="size-3" aria-hidden />
                  {status}
                </span>
              ) : (
                "Stored privately for this browser."
              )}
            </p>
            <Link href="/collections" className="text-xs font-medium text-foreground/80 hover:text-foreground">
              Manage collections
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
