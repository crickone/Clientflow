import { PageHeader } from "@/components/layout/PageHeader";
import { NewBlogForm } from "@/components/content-studio/NewBlogForm";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default function NewBlogPage() {
  const therapies = db
    .select()
    .from(schema.therapies)
    .where(eq(schema.therapies.isActive, true))
    .all();
  const videoProjects = db
    .select({
      id: schema.videoProjects.id,
      name: schema.videoProjects.name,
      status: schema.videoProjects.status,
    })
    .from(schema.videoProjects)
    .orderBy(desc(schema.videoProjects.createdAt))
    .all();

  return (
    <>
      <PageHeader
        eyebrow="New blog"
        title="Draft a Post"
        subtitle="Pick a source, give Claude a title and direction, and we'll generate a markdown draft you can edit."
      />
      <NewBlogForm therapies={therapies} videoProjects={videoProjects} />
    </>
  );
}
