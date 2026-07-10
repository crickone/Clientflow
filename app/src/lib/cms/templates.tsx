import "server-only";

import type { Page } from "@/lib/db/schema";
import type { BlockKind } from "@/lib/db/schema";
import { Block, type RenderCtx } from "@/components/cms/Block";

/**
 * Template registry. Each coded page template declares the editable slots it
 * exposes (the `blocks` manifest drives the admin editor) and a server
 * component that reads those slots at render via <Block>. The bespoke DESIGN
 * lives in code here; CONTENT lives in the DB.
 */

export interface BlockSpec {
  name: string;
  kind: BlockKind;
  label: string;
  fallback?: string;
}

export interface TemplateProps {
  ctx: RenderCtx;
  page: Page;
}

export interface TemplateDef {
  id: string;
  label: string;
  blocks: BlockSpec[];
  Component: (props: TemplateProps) => JSX.Element;
}

// --- Basic page (generic; used for demos and simple pages) ---
const basicPage: TemplateDef = {
  id: "basic-page",
  label: "Basic page",
  blocks: [
    { name: "heading", kind: "text", label: "Heading", fallback: "Untitled" },
    { name: "body", kind: "richtext", label: "Body", fallback: "" },
  ],
  Component: ({ ctx }) => (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "80px 24px 120px",
        fontFamily: "var(--font-body), system-ui, sans-serif",
        color: "#16161a",
      }}
    >
      <h1 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 600 }}>
        <Block ctx={ctx} name="heading" kind="text" fallback="Untitled" />
      </h1>
      <div className="cms-prose" style={{ marginTop: 24, lineHeight: 1.75 }}>
        <Block ctx={ctx} name="body" kind="richtext" />
      </div>
    </main>
  ),
};

// --- Imported HTML page (controlled-HTML bridge for migrated bespoke pages) ---
const renovaHtml: TemplateDef = {
  id: "renova-html",
  label: "Imported page (HTML body)",
  blocks: [{ name: "body", kind: "html", label: "Page HTML", fallback: "" }],
  Component: ({ ctx }) => <Block ctx={ctx} name="body" kind="html" />,
};

const REGISTRY: Record<string, TemplateDef> = {
  [basicPage.id]: basicPage,
  [renovaHtml.id]: renovaHtml,
};

export function getTemplate(id: string): TemplateDef | null {
  return REGISTRY[id] ?? null;
}

export function listTemplates(): TemplateDef[] {
  return Object.values(REGISTRY);
}

/** Register a template (used by site-specific template modules e.g. Renova). */
export function registerTemplate(def: TemplateDef): void {
  REGISTRY[def.id] = def;
}
