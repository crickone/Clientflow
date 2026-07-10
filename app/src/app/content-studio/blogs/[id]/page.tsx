import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { getBlogPost } from "@/lib/blog/posts";
import { BlogEditor } from "@/components/content-studio/BlogEditor";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

function modeCopy(mode: "prompt" | "therapy" | "video", serviceTerm: string): string {
  if (mode === "therapy") return `${serviceTerm} focus`;
  return mode === "video" ? "From video transcript" : "Topic prompt";
}

export default function BlogDetailPage({ params }: { params: { id: string } }) {
  const vocab = getVocab(getVenueType());
  const id = Number(params.id);
  const post = getBlogPost(id);
  if (!post) notFound();

  return (
    <>
      <PageHeader
        eyebrow={`Blog #${post.id} · ${modeCopy(post.inputMode, vocab.service)}`}
        title={post.title}
        subtitle={`Target ${post.targetWords} words`}
        actions={
          <Link href="/content-studio/blogs">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All blogs
            </Button>
          </Link>
        }
      />
      <BlogEditor initial={post} />
    </>
  );
}
