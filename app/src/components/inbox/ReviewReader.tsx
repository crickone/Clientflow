"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { draftReviewReplyAction, replyToReviewAction } from "@/app/communication/actions";
import { InboxAvatar } from "./ContactCard";
import { fullTime } from "./format";

/** Five stars, filled to the rating. Low ratings take the warning colour. */
export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className={`inbox-stars${rating <= 3 ? " is-low" : ""}`} role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} strokeWidth={1.6} fill={n <= rating ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

/**
 * A Google review in the reading pane: the stars, what they wrote, the
 * business's public reply if there is one, and a box to write or change it.
 * Adonis can draft the reply; it only goes to Google on "Post reply".
 */
export function ReviewReader({
  review,
  reviewer,
  at,
  focusReplyToken,
  onOpened,
  onReplied,
}: {
  review: { id: number; rating: number; comment: string; reply: string | null; repliedAt: number | null };
  reviewer: string;
  at: number;
  focusReplyToken: number;
  onOpened: () => void;
  onReplied: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(!review.reply);
  const [posting, startPost] = useTransition();
  const [drafting, startDraft] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText("");
    setEditing(!review.reply);
    onOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.id]);

  useEffect(() => {
    if (!focusReplyToken) return;
    setEditing(true);
    requestAnimationFrame(() => box.current?.focus());
  }, [focusReplyToken]);

  function draft() {
    startDraft(async () => {
      const res = await draftReviewReplyAction(review.id);
      if (!res.ok) return void toast.error(res.error);
      setEditing(true);
      setText(res.text);
      requestAnimationFrame(() => box.current?.focus());
    });
  }

  function post() {
    const t = text.trim();
    if (!t) return;
    startPost(async () => {
      const res = await replyToReviewAction(review.id, t);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Reply posted on Google");
      onReplied(t);
      setEditing(false);
      setText("");
    });
  }

  return (
    <div className="inbox-reader-body">
      <div className="inbox-reader-scroll">
        <article className="inbox-review">
          <div className="inbox-review-head">
            <Stars rating={review.rating} size={18} />
            <span className="inbox-msg-time">{fullTime(at)}</span>
          </div>
          <p className="inbox-review-text">{review.comment || "Left a rating without a written review."}</p>
        </article>

        {review.reply && (
          <article className="inbox-review-reply">
            <div className="inbox-msg-head" style={{ cursor: "default", padding: 0 }}>
              <InboxAvatar name="You" size={28} />
              <span className="inbox-msg-from">
                <strong>Your public reply</strong>
                <span>{review.repliedAt ? fullTime(review.repliedAt) : ""}</span>
              </span>
              {!editing && (
                <Button variant="ghost" size="sm" onClick={() => { setEditing(true); setText(review.reply ?? ""); }}>
                  Edit reply
                </Button>
              )}
            </div>
            <p className="inbox-review-text" style={{ marginTop: 10 }}>{review.reply}</p>
          </article>
        )}
      </div>

      <div className="inbox-composer">
        {editing ? (
          <>
            <div className="inbox-composer-to">
              Public reply to <strong>{reviewer}</strong>, shown on Google under the review
            </div>
            <Textarea
              ref={box}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  post();
                }
              }}
              placeholder="Write a reply"
              disabled={posting}
              style={{ resize: "vertical", minHeight: 96 }}
            />
            <div className="inbox-composer-actions">
              <Button variant="outline" size="sm" onClick={draft} loading={drafting} disabled={posting}>
                <Sparkles size={14} /> {text.trim() ? "Redraft with Adonis" : "Draft with Adonis"}
              </Button>
              <span className="inbox-composer-hint">Cmd + Enter to post</span>
              <Button size="sm" onClick={post} loading={posting} disabled={!text.trim()}>
                <Send size={14} /> {review.reply ? "Update reply" : "Post reply"}
              </Button>
            </div>
          </>
        ) : (
          <div className="inbox-composer-actions">
            <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Replied. Edit it any time.</span>
          </div>
        )}
      </div>
    </div>
  );
}
