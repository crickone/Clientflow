import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentMembership } from "@/lib/auth";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { AiCapError } from "@/lib/ai/usage";
import { findTextRuns, runAt } from "@/lib/design/textRuns";
import { getCarousel } from "@/lib/image/carousels";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { parseRewrite, rewritePrompt } from "@/lib/content-studio/rewriteRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rewrite ONE line of a designed slide — the text the operator just clicked.
 *
 * It returns the new words and writes NOTHING. The slide is not touched, the
 * render is not rebuilt, and the id list is not altered: the words go back to
 * the editor's textarea, where the operator reads them, presses the button
 * again for another, or saves. That is what makes the button repeatable, which
 * is the whole point of it — a version that saved on every press would make
 * "try another" cost a re-render each time and leave the operator no way back
 * to the line they actually liked.
 *
 * Saving is the existing slide-text POST, unchanged.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "No active account" }, { status: 401 });
  }
  const tenantId = membership.tenant.id;

  let body: { slideId?: unknown; index?: unknown; note?: unknown; avoid?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const carousel = getCarousel(Number(params.id));
  if (!carousel) {
    return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });
  }
  const slide = carousel.slides.find((s) => s.id === Number(body?.slideId));
  if (!slide) {
    return NextResponse.json({ ok: false, error: "Slide not found." }, { status: 404 });
  }
  if (slide.templateId !== DESIGNED_TEMPLATE_ID || !slide.designHtml) {
    return NextResponse.json(
      { ok: false, error: "That slide was not designed by Adonis." },
      { status: 400 },
    );
  }

  const index = Number(body?.index);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ ok: false, error: "Nothing to rewrite." }, { status: 400 });
  }

  // Re-scanned from the CURRENT markup rather than trusting an index the
  // client held on to — the same reasoning as the save path. A slide
  // regenerated since the editor loaded has different words at that index.
  const html = slide.designHtml;
  const run = runAt(html, index);
  if (!run) {
    return NextResponse.json(
      { ok: false, error: "That text isn't on this slide any more. Reopen the slide and try again." },
      { status: 409 },
    );
  }

  const runs = findTextRuns(html).map((r) => ({ index: r.index, text: r.text }));
  const note = typeof body?.note === "string" ? body.note.trim() || null : null;
  // Lines the operator has already seen for this run: what is on the slide,
  // plus whatever the last press produced (the client sends its current
  // draft). Repeated presses are the point of this button, and circling back
  // to a line already rejected is a press that did nothing.
  const avoid = [
    run.text,
    ...(Array.isArray(body?.avoid)
      ? (body.avoid as unknown[]).filter((a): a is string => typeof a === "string")
      : []),
  ]
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 6);

  const ask = async () => {
    const message = await meteredCreate({ tenantId, agentKey: "carousel" }, () => ({
      model: CONTENT_MODEL,
      max_tokens: 300,
      // A rewrite is one line. Room to vary without room to ramble.
      temperature: 1,
      messages: [
        {
          role: "user" as const,
          content: rewritePrompt({
            text: run.text,
            runs,
            index,
            topic: carousel.name,
            business: getBusinessContext(),
            note,
            avoid,
          }),
        },
      ],
    }));
    const reply = message.content
      .filter((b): b is { type: "text"; text: string; citations: never } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseRewrite(reply, run.text, avoid);
  };

  try {
    // ONE retry. A model handed a line that is already good will sometimes
    // return it unchanged, and the first press of a button reporting "that
    // came back the same" reads as broken. Measured: the first press did
    // exactly that, the second produced a real alternative. Retrying costs a
    // second cheap call in the uncommon case and makes the button work in the
    // common one.
    const text = (await ask()) ?? (await ask());
    if (!text) {
      // Deliberately NOT a 500: nothing is broken, the model just came back
      // with the same line twice. Pressing again is the right next move.
      return NextResponse.json(
        { ok: false, error: "That came back the same. Try again." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, text, index });
  } catch (err) {
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    const messageText = err instanceof Error ? err.message : "Couldn't rewrite that.";
    console.error("[slide-text/rewrite] failed:", err);
    return NextResponse.json({ ok: false, error: messageText }, { status: 500 });
  }
}
