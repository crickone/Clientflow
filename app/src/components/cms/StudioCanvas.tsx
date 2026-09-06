"use client";

import { useEffect, useRef } from "react";

import type { PageBodyZones } from "@/lib/cms/pageBody";

export type SelectionKind = "text" | "link" | "image" | "section" | null;

export interface SelectionPayload {
  kind: SelectionKind;
  label: string;
  breadcrumb: { label: string; depth: number }[];
  props: {
    tag: string;
    words?: number;
    href?: string;
    newTab?: boolean;
    src?: string;
    alt?: string;
    hidden?: boolean;
  };
}

/**
 * The in-iframe edit surface (was RenovaEditCanvas — it stopped being
 * Renova-specific a long time ago).
 *
 * Renders the page's OWN styles and fonts (`head`) plus its content, and never
 * its scripts (`tail`): the canvas looks exactly like the live site but nothing
 * animates, hijacks scroll, or rewrites the DOM while you edit. GSAP writes
 * inline opacity/transform onto elements as it animates, so running it here
 * would bake those into whatever the editor saves.
 *
 * Talks to the Studio shell over postMessage — see the protocol table in
 * docs/superpowers/plans/2026-09-06-cms-studio-editor.md.
 */
export function StudioCanvas({
  zones,
  path,
}: {
  zones: PageBodyZones & { hasDraft: boolean };
  path: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const parentWin = window.parent;
    const post = (msg: unknown) => parentWin.postMessage(msg, "*");
    const dirty = () => post({ type: "cms:dirty", content: clean() });

    // --- editor chrome (never saved: lives outside #cms-edit-root) ---
    const style = document.createElement("style");
    style.setAttribute("data-cms-editor", "1");
    style.textContent = `
      [data-cms-sel]{outline:2px solid #ef5a24 !important;outline-offset:2px}
      [data-cms-hover]:not([data-cms-sel]){outline:1px dashed rgba(239,90,36,.65) !important;outline-offset:2px}
      [data-cms-hidden-preview]{opacity:.28}
      img.cms-drop-target{outline:3px solid #3fb950 !important;outline-offset:3px}
    `;
    document.head.appendChild(style);

    const SECTION_SEL = "section,header,footer,article,aside";
    const TEXT_SEL = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,th,td";
    const hasText = (el: Element) => (el.textContent || "").trim().length > 0;

    const labelFor = (el: HTMLElement): string => {
      const tag = el.tagName.toLowerCase();
      if (tag === "img") return "Image";
      if (tag === "a") return "Link";
      if (/^h[1-6]$/.test(tag)) return `Heading ${tag[1]}`;
      if (el.matches(SECTION_SEL)) return "Section";
      if (tag === "li") return "List item";
      if (tag === "button") return "Button";
      if (tag === "p") return "Text";
      return tag;
    };

    const kindFor = (el: HTMLElement): SelectionKind => {
      const tag = el.tagName.toLowerCase();
      if (tag === "img") return "image";
      if (tag === "a") return "link";
      if (el.matches(SECTION_SEL) || el.parentElement === root) return "section";
      if (el.matches(TEXT_SEL) || hasText(el)) return "text";
      return "section";
    };

    // --- selection ---
    let selected: HTMLElement | null = null;
    const chain = (el: HTMLElement): HTMLElement[] => {
      const out: HTMLElement[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== root) {
        out.unshift(cur);
        cur = cur.parentElement;
      }
      return out;
    };

    const describe = (el: HTMLElement): SelectionPayload => {
      const kind = kindFor(el);
      const anc = chain(el);
      const img = el as HTMLImageElement;
      const a = el as HTMLAnchorElement;
      return {
        kind,
        label: labelFor(el),
        // depth counts back from the selected element: 0 = itself, 1 = parent…
        breadcrumb: anc.map((n, i) => ({
          label: labelFor(n),
          depth: anc.length - 1 - i,
        })),
        props: {
          tag: el.tagName.toLowerCase(),
          words:
            kind === "text"
              ? ((el.textContent || "").trim().match(/\S+/g) || []).length
              : undefined,
          href: kind === "link" ? a.getAttribute("href") ?? "" : undefined,
          newTab: kind === "link" ? a.getAttribute("target") === "_blank" : undefined,
          src: kind === "image" ? img.getAttribute("src") ?? "" : undefined,
          alt: kind === "image" ? img.getAttribute("alt") ?? "" : undefined,
          hidden:
            kind === "section"
              ? el.hasAttribute("data-cms-hidden") || el.hasAttribute("data-cms-hidden-preview")
              : undefined,
        },
      };
    };

    const select = (el: HTMLElement | null) => {
      // A picker token only means anything paired with the DOM attribute
      // that carries it. The shell can't reliably tell two structurally
      // identical siblings apart (it only sees derived breadcrumb labels),
      // so it can't be trusted to invalidate a stale token by itself — the
      // canvas can, by comparing actual node identity. Any genuine change
      // of selection (a different element than the one already selected)
      // clears the marker off whatever element still carries it, so a later
      // cms:setImage naming a since-invalidated token finds nothing and
      // does nothing, rather than landing on the wrong element. Reselecting
      // the SAME element (el === selected) is not a change and must not
      // clear a token minted for it moments earlier.
      if (el !== selected) {
        root.querySelectorAll("[data-cms-img]").forEach((e) => e.removeAttribute("data-cms-img"));
      }
      if (selected) {
        selected.removeAttribute("data-cms-sel");
        if (selected.getAttribute("contenteditable") === "true") {
          selected.removeAttribute("contenteditable");
        }
      }
      selected = el;
      if (!el) {
        hideToolbar();
        post({ type: "cms:selection", kind: null, label: "", breadcrumb: [], props: { tag: "" } });
        return;
      }
      el.setAttribute("data-cms-sel", "1");
      const payload = describe(el);
      if (payload.kind === "text") {
        el.setAttribute("contenteditable", "true");
        el.focus();
        showToolbar(el);
      } else {
        hideToolbar();
      }
      post({ type: "cms:selection", ...payload });
    };

    // --- hover outline ---
    let hovered: HTMLElement | null = null;
    const onOver = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const el = t && t !== root ? (t.closest("*") as HTMLElement | null) : null;
      if (hovered === el) return;
      hovered?.removeAttribute("data-cms-hover");
      hovered = el && root.contains(el) && el !== root ? el : null;
      hovered?.setAttribute("data-cms-hover", "1");
    };
    const onLeave = () => {
      hovered?.removeAttribute("data-cms-hover");
      hovered = null;
    };

    // --- floating format toolbar (kept from the old canvas) ---
    const tb = document.createElement("div");
    tb.className = "cms-toolbar";
    tb.style.cssText =
      "position:absolute;z-index:99999;display:none;gap:2px;background:#16161a;border-radius:8px;padding:4px;box-shadow:0 8px 28px rgba(0,0,0,.35)";
    const btn = (cmd: string, label: string, italic = false, bold = false) =>
      `<button data-cmd="${cmd}" style="all:unset;cursor:pointer;color:#fff;font-size:12px;padding:5px 9px;border-radius:5px;${bold ? "font-weight:700;" : ""}${italic ? "font-style:italic;" : ""}">${label}</button>`;
    tb.innerHTML =
      btn("bold", "B", false, true) + btn("italic", "I", true) + btn("link", "Link") + btn("clear", "Clear");
    document.body.appendChild(tb);
    tb.addEventListener("mousedown", (e) => e.preventDefault());
    tb.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const cmd = (b as HTMLElement).dataset.cmd;
      if (cmd === "bold") document.execCommand("bold");
      else if (cmd === "italic") document.execCommand("italic");
      else if (cmd === "link") {
        const url = window.prompt("Link URL");
        if (!url) return;
        document.execCommand("createLink", false, url);
      } else if (cmd === "clear") {
        document.execCommand("removeFormat");
        document.execCommand("unlink");
      }
      dirty();
    });
    function showToolbar(el: HTMLElement) {
      const r = el.getBoundingClientRect();
      tb.style.display = "flex";
      tb.style.top = `${r.top + window.scrollY - 40}px`;
      tb.style.left = `${r.left + window.scrollX}px`;
    }
    function hideToolbar() {
      tb.style.display = "none";
    }

    // --- clicks: select, never navigate ---
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".cms-toolbar")) return;
      if (!root.contains(t)) {
        select(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      select(t === root ? null : t);
    };
    document.addEventListener("click", onClick, true);
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("input", dirty, true);

    // --- images: click selects; the shell opens the picker on Replace ---
    const imgToken = (img: HTMLImageElement) => {
      const token = `img-${Date.now()}`;
      img.setAttribute("data-cms-img", token);
      return token;
    };

    // --- serialise: everything the editor added comes back off ---
    function clean(): string {
      // root is a hoisted `function` declaration's outer binding: TS's null
      // narrowing from the `if (!root) return;` guard above does not carry
      // into hoisted function declarations (only into closures/arrow
      // functions), even though root is a const never reassigned. Asserted
      // non-null here for that reason — the guard already guarantees it.
      const clone = root!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
      clone.querySelectorAll("[data-cms-sel]").forEach((e) => e.removeAttribute("data-cms-sel"));
      clone.querySelectorAll("[data-cms-hover]").forEach((e) => e.removeAttribute("data-cms-hover"));
      clone.querySelectorAll("[data-cms-img]").forEach((e) => e.removeAttribute("data-cms-img"));
      // data-cms-hidden is the durable, saved-HTML record that the CMS (not
      // the page's own CSS/JS) hid this element; data-cms-hidden-preview is
      // the editor-only marker that fades it in the canvas instead of
      // actually hiding it, so it can still be found and switched back on.
      // Serialising must drop the preview marker but keep (or add) the
      // durable one, and re-apply the real display:none the live page needs.
      clone.querySelectorAll("[data-cms-hidden-preview]").forEach((e) => {
        e.removeAttribute("data-cms-hidden-preview");
        e.setAttribute("data-cms-hidden", "1");
        (e as HTMLElement).style.display = "none";
      });
      // .cms-toolbar itself lives on document.body and never appears inside
      // the cloned root, but if a customer's own markup ever used that class
      // name, stripping the class (not removing the element) keeps this
      // consistent and conservative with the .cms-drop-target handling below.
      clone.querySelectorAll(".cms-toolbar").forEach((e) => e.classList.remove("cms-toolbar"));
      // onDrop calls dirty() (which calls clean()) before its own setTarget(null)
      // clears this class from the live element, so a drop-in-progress could
      // otherwise serialise the drag-hover marker into saved content.
      clone.querySelectorAll(".cms-drop-target").forEach((e) => e.classList.remove("cms-drop-target"));
      return clone.innerHTML;
    }

    // --- drag-and-drop image replace (kept from the old canvas) ---
    let pendingAsset: { id: number; url: string; alt: string | null } | null = null;
    let dropTarget: HTMLImageElement | null = null;
    const setTarget = (img: HTMLImageElement | null) => {
      if (dropTarget && dropTarget !== img) dropTarget.classList.remove("cms-drop-target");
      dropTarget = img;
      img?.classList.add("cms-drop-target");
    };
    const imgFrom = (t: EventTarget | null) =>
      t instanceof HTMLElement ? (t.closest("img") as HTMLImageElement | null) : null;
    const onDragOver = (e: DragEvent) => {
      if (!pendingAsset) return;
      const img = imgFrom(e.target);
      if (img) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        setTarget(img);
      } else setTarget(null);
    };
    const onDrop = (e: DragEvent) => {
      if (!pendingAsset) return;
      const img = imgFrom(e.target);
      if (img) {
        e.preventDefault();
        img.setAttribute("src", pendingAsset.url);
        if (pendingAsset.alt) img.setAttribute("alt", pendingAsset.alt);
        dirty();
      }
      setTarget(null);
      pendingAsset = null;
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);

    // --- messages from the shell ---
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data || {};
      if (d.type === "cms:setProp" && selected) {
        const el = selected;
        if (d.prop === "href") el.setAttribute("href", String(d.value));
        else if (d.prop === "target") {
          if (d.value) el.setAttribute("target", "_blank");
          else el.removeAttribute("target");
        } else if (d.prop === "alt") el.setAttribute("alt", String(d.value));
        else if (d.prop === "hidden") {
          if (d.value) {
            // data-cms-hidden is the durable marker that survives clean() into
            // the saved HTML (paired there with inline display:none); the
            // preview attribute is editor-only and only fades the element
            // here so it stays visible enough to find and switch back on.
            el.setAttribute("data-cms-hidden", "1");
            el.setAttribute("data-cms-hidden-preview", "1");
            el.style.removeProperty("display");
          } else {
            el.removeAttribute("data-cms-hidden");
            el.removeAttribute("data-cms-hidden-preview");
            if (el.style.display === "none") el.style.removeProperty("display");
          }
        }
        dirty();
        post({ type: "cms:selection", ...describe(el) });
      } else if (d.type === "cms:pickImageRequest" && selected?.tagName === "IMG") {
        post({ type: "cms:pickImage", token: imgToken(selected as HTMLImageElement) });
      } else if (d.type === "cms:setImage") {
        const img = root.querySelector<HTMLImageElement>(`[data-cms-img="${d.token}"]`);
        if (img) {
          img.setAttribute("src", d.src);
          if (d.alt) img.setAttribute("alt", d.alt);
          img.removeAttribute("data-cms-img");
          dirty();
          if (selected === img) post({ type: "cms:selection", ...describe(img) });
        }
      } else if (d.type === "cms:selectAncestor") {
        // Never walk as far as (or past) the edit root itself: stop the walk
        // once `el` is already a direct child of root, since stepping up
        // from there would land on root, and root is not a selectable node.
        let el: HTMLElement | null = selected;
        for (let i = 0; i < Number(d.depth || 0) && el && el !== root && el.parentElement !== root; i++) {
          el = el.parentElement;
        }
        if (el && el !== root && root.contains(el)) select(el);
      } else if (d.type === "cms:deselect") {
        select(null);
      } else if (d.type === "cms:dragStart") {
        pendingAsset = d.asset || null;
      } else if (d.type === "cms:dragEnd") {
        setTarget(null);
        pendingAsset = null;
      }
    };
    window.addEventListener("message", onMsg);

    // Reveal only what the CMS itself hid — never infer it from a bare
    // inline display:none. A bespoke page very commonly authors its own
    // full-screen modal or mobile-nav overlay (position:fixed;inset:0;
    // display:none) as a top-level sibling of header/main/footer, precisely
    // because it doesn't need to sit in the document flow; a heuristic that
    // matched "hidden + top-level (or section-like)" would surface that
    // overlay as a fake faded section and its full-viewport hit area would
    // swallow every click to the real content underneath. data-cms-hidden is
    // the explicit, durable marker `clean()` writes when the operator hides a
    // section, so only elements carrying it are ever candidates here.
    root.querySelectorAll<HTMLElement>("[data-cms-hidden]").forEach((el) => {
      el.setAttribute("data-cms-hidden-preview", "1");
      el.style.removeProperty("display");
    });

    post({ type: "cms:ready", path, hasDraft: zones.hasDraft });

    return () => {
      window.removeEventListener("message", onMsg);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", onLeave);
      root.removeEventListener("input", dirty, true);
      tb.remove();
      style.remove();
    };
  }, [zones, path]);

  return (
    <>
      {/* The page's OWN styles and fonts. <style> and <link> inserted via
          innerHTML are applied by the browser (unlike <script>, which is
          inert), so the canvas looks exactly like the live site. */}
      <div dangerouslySetInnerHTML={{ __html: zones.head }} />
      <div id="cms-edit-root" ref={rootRef} dangerouslySetInnerHTML={{ __html: zones.content }} />
    </>
  );
}
