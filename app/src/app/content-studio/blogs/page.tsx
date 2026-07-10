import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { listBlogPosts } from "@/lib/blog/posts";
import { BlogList } from "@/components/content-studio/BlogList";

export const dynamic = "force-dynamic";

export default function BlogsPage() {
  const posts = listBlogPosts();
  return (
    <>
      <PageHeader
        eyebrow="AI Blog"
        title="Blogs"
        subtitle="Draft a blog post from a topic prompt, a therapy focus, or by repurposing a Content Studio video transcript."
        actions={
          <Link href="/content-studio/blogs/new">
            <Button>
              <Plus size={15} />
              New blog
            </Button>
          </Link>
        }
      />
      {posts.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} strokeWidth={1.4} />}
          title="No blog posts yet"
          message="Draft your first post and Claude will write it from your inputs."
          action={
            <Link href="/content-studio/blogs/new">
              <Button>
                <Plus size={15} />
                New blog
              </Button>
            </Link>
          }
        />
      ) : (
        <BlogList posts={posts} />
      )}
    </>
  );
}
