"use server";

/**
 * Collections & bookmarks Server Actions. Every action derives the owner from the caller's own
 * identity cookie (requireOwnerId) and every mutation filters on that owner, so a forged id can
 * never touch someone else's data. Inputs are Zod-validated.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  addItem,
  CollectionError,
  createCollection,
  deleteCollection,
  moveItem,
  removeEntityFromCollection,
  removeItem,
  toggleBookmark,
  updateCollection,
  updateItem,
} from "@/server/queries/collections";
import { requireOwnerId } from "@/server/identity";
import { type ActionResult, CollectionInput, EntityRef, fieldErrorsOf, ItemInput, MoveDirection } from "@/components/collections/schema";

const Id = z.uuid();

function fail(e: unknown): ActionResult<never> {
  if (e instanceof CollectionError) return { ok: false, message: e.message };
  if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Invalid input.", fieldErrors: fieldErrorsOf(e) };
  console.error("[collections] action failed", e);
  return { ok: false, message: "Something went wrong saving your change. Try again." };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

function revalidate(slug?: string) {
  revalidatePath("/collections");
  if (slug) revalidatePath(`/collections/${slug}`);
}

/** Create from the /collections form. Redirects to the new collection (works without JS). */
export async function createCollectionAction(_prev: ActionResult<{ slug: string }> | null, fd: FormData): Promise<ActionResult<{ slug: string }>> {
  let slug: string;
  try {
    const input = CollectionInput.parse({ name: str(fd, "name") ?? "", description: str(fd, "description") });
    const owner = await requireOwnerId();
    slug = (await createCollection(owner, input)).slug;
  } catch (e) {
    return fail(e);
  }
  revalidate();
  redirect(`/collections/${slug}`);
}

/** Create a collection and add one entity to it (Add to collection dialog). */
export async function createCollectionWithItemAction(input: { name: string; description?: string; entityType: string; entityId: string }): Promise<ActionResult<{ id: string; slug: string; name: string }>> {
  try {
    const c = CollectionInput.parse({ name: input.name, description: input.description });
    const ref = EntityRef.parse({ entityType: input.entityType, entityId: input.entityId });
    const owner = await requireOwnerId();
    const created = await createCollection(owner, c);
    await addItem(owner, created.id, ref);
    revalidate(created.slug);
    return { ok: true, message: `Created “${c.name}”`, data: { ...created, name: c.name } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateCollectionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const id = Id.parse(str(fd, "collectionId"));
    const input = CollectionInput.parse({ name: str(fd, "name") ?? "", description: str(fd, "description") });
    const owner = await requireOwnerId();
    const row = await updateCollection(owner, id, input);
    revalidate(row.slug);
    return { ok: true, message: "Collection saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCollectionAction(fd: FormData): Promise<void> {
  const id = Id.safeParse(str(fd, "collectionId"));
  if (!id.success) return;
  const owner = await requireOwnerId();
  try {
    await deleteCollection(owner, id.data);
  } catch (e) {
    if (!(e instanceof CollectionError)) throw e;
  }
  revalidate();
  redirect("/collections?deleted=1");
}

export async function addItemAction(input: { collectionId: string; entityType: string; entityId: string; note?: string }): Promise<ActionResult<{ alreadyPresent: boolean }>> {
  try {
    const collectionId = Id.parse(input.collectionId);
    const ref = EntityRef.parse(input);
    const item = ItemInput.parse({ note: input.note });
    const owner = await requireOwnerId();
    const r = await addItem(owner, collectionId, ref, item);
    revalidate();
    return { ok: true, message: r.alreadyPresent ? "Already in this collection" : "Added", data: { alreadyPresent: r.alreadyPresent } };
  } catch (e) {
    return fail(e);
  }
}

export async function removeEntityAction(input: { collectionId: string; entityType: string; entityId: string }): Promise<ActionResult> {
  try {
    const collectionId = Id.parse(input.collectionId);
    const ref = EntityRef.parse(input);
    const owner = await requireOwnerId();
    await removeEntityFromCollection(owner, collectionId, ref);
    revalidate();
    return { ok: true, message: "Removed" };
  } catch (e) {
    return fail(e);
  }
}

/** Form action (no-JS friendly): remove one item. */
export async function removeItemAction(fd: FormData): Promise<void> {
  const id = Id.safeParse(str(fd, "itemId"));
  if (!id.success) return;
  const owner = await requireOwnerId();
  try {
    await removeItem(owner, id.data);
  } catch (e) {
    if (!(e instanceof CollectionError)) throw e;
  }
  revalidate(str(fd, "slug"));
}

/** Form action (no-JS friendly): move one item up/down/top/bottom. */
export async function moveItemAction(fd: FormData): Promise<void> {
  const id = Id.safeParse(str(fd, "itemId"));
  const dir = MoveDirection.safeParse(str(fd, "direction"));
  if (!id.success || !dir.success) return;
  const owner = await requireOwnerId();
  try {
    await moveItem(owner, id.data, dir.data);
  } catch (e) {
    if (!(e instanceof CollectionError)) throw e;
  }
  revalidate(str(fd, "slug"));
}

export async function updateItemAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const id = Id.parse(str(fd, "itemId"));
    const input = ItemInput.parse({ note: str(fd, "note"), tags: str(fd, "tags") });
    const owner = await requireOwnerId();
    await updateItem(owner, id, input);
    revalidate(str(fd, "slug"));
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

/** Toggle (or set, with `want`) a bookmark. Usable from a client button or a plain form. */
export async function toggleBookmarkAction(input: { entityType: string; entityId: string; want?: boolean }): Promise<ActionResult<{ bookmarked: boolean }>> {
  try {
    const ref = EntityRef.parse(input);
    const owner = await requireOwnerId();
    const r = await toggleBookmark(owner, ref, input.want);
    revalidate();
    return { ok: true, message: r.bookmarked ? "Bookmarked" : "Bookmark removed", data: r };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleBookmarkFormAction(fd: FormData): Promise<void> {
  const want = str(fd, "want");
  await toggleBookmarkAction({ entityType: str(fd, "entityType") ?? "", entityId: str(fd, "entityId") ?? "", want: want === undefined ? undefined : want === "1" });
}
