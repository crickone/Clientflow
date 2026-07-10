import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tags as tagsTable, conversationTags, type Tag } from "@/lib/db/schema";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** All tags, core first then alphabetical. */
export function listTags(): Tag[] {
  return db
    .select()
    .from(tagsTable)
    .orderBy(desc(tagsTable.isCore), tagsTable.label)
    .all();
}

/** Promote an AI-suggested tag into the controlled core vocabulary. */
export function promoteTag(id: number): void {
  db.update(tagsTable).set({ isCore: true }).where(eq(tagsTable.id, id)).run();
}

/** Delete a tag and its conversation links. */
export function deleteTag(id: number): void {
  db.delete(conversationTags).where(eq(conversationTags.tagId, id)).run();
  db.delete(tagsTable).where(eq(tagsTable.id, id)).run();
}

/** Add a new core tag (no-op if the slug already exists). */
export function addCoreTag(label: string): void {
  const clean = label.trim();
  const slug = slugify(clean);
  if (!slug) return;
  const existing = db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.slug, slug))
    .get();
  if (existing) {
    if (!existing.isCore) promoteTag(existing.id);
    return;
  }
  db.insert(tagsTable).values({ label: clean, slug, isCore: true }).run();
}
