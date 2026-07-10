"use client";

import { useEffect, useRef } from "react";

/**
 * In-iframe edit surface. Renders the page's content (scripts stripped, so it's
 * stable while editing) and instruments it: hover outlines, click-to-edit text,
 * click-to-swap images. Talks to the parent Studio via postMessage:
 *  - up:   cms:ready{path}, cms:dirty, cms:pickImage{token}, cms:content{path,html}
 *  - down: cms:save (→ reply cms:content), cms:setImage{token,src}
 * On save the parent merges this content with the page's original <script> tags.
 */
export function RenovaEditCanvas({ html, path }: { html: string; path: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const parentWin = window.parent;

    const style = document.createElement("style");
    style.setAttribute("data-cms-editor", "1");
    style.textContent = `
      /* JS-driven overlays would normally be lifted by scripts; hide them while
         editing (scripts are off in edit mode) so the page is visible. */
      .pt,.intro{display:none!important}
      .lenis,.lenis body{overflow:auto!important}
      [data-cms-text]{outline:1px dashed transparent;outline-offset:2px;transition:outline-color .12s;cursor:text}
      [data-cms-text]:hover{outline-color:#ef5a24}
      [data-cms-text][contenteditable="true"]{outline:2px solid #ef5a24;background:rgba(239,90,36,.06)}
      img{cursor:pointer}
      img:hover{outline:2px solid #ef5a24;outline-offset:2px}
      img.cms-drop-target{outline:3px solid #3fb950!important;outline-offset:3px}
    `;
    document.head.appendChild(style);

    // Block-level text containers — made editable as a whole, so a heading that
    // contains inline children (e.g. <span class="accent">) is fully editable.
    const BLOCK_SEL =
      "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,th,td";
    // Inline text elements that stand alone (not inside a block above), e.g. nav
    // links, buttons, lone spans.
    const INLINE_SEL = "a,button,span,em,strong";

    const hasText = (el: HTMLElement) => (el.textContent || "").trim().length > 0;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SEL)).filter(
      (el) => hasText(el) && !el.closest("[data-cms-text]"),
    );
    blocks.forEach((el) => el.setAttribute("data-cms-text", "1"));
    const inlines = Array.from(
      root.querySelectorAll<HTMLElement>(INLINE_SEL),
    ).filter((el) => hasText(el) && !el.closest("[data-cms-text]"));

    const texts = [...blocks, ...inlines];

    const dirty = () => parentWin.postMessage({ type: "cms:dirty" }, "*");

    // Floating format toolbar (lives on document.body, outside the saved root).
    const tb = document.createElement("div");
    tb.className = "cms-toolbar";
    tb.style.cssText =
      "position:absolute;z-index:99999;display:none;gap:2px;background:#16161a;border-radius:8px;padding:4px;box-shadow:0 8px 28px rgba(0,0,0,.35)";
    const btn = (cmd: string, label: string, italic = false, bold = false) =>
      `<button data-cmd="${cmd}" style="all:unset;cursor:pointer;color:#fff;font-size:12px;padding:5px 9px;border-radius:5px;${bold ? "font-weight:700;" : ""}${italic ? "font-style:italic;" : ""}">${label}</button>`;
    tb.innerHTML =
      btn("bold", "B", false, true) +
      btn("italic", "I", true) +
      btn("link", "Link") +
      btn("clear", "Clear");
    document.body.appendChild(tb);
    tb.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection
    tb.addEventListener("mouseover", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b) (b as HTMLElement).style.background = "rgba(255,255,255,.14)";
    });
    tb.addEventListener("mouseout", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b) (b as HTMLElement).style.background = "transparent";
    });
    tb.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const cmd = (b as HTMLElement).dataset.cmd;
      if (cmd === "bold") document.execCommand("bold");
      else if (cmd === "italic") document.execCommand("italic");
      else if (cmd === "link") {
        const url = prompt("Link URL");
        if (url) document.execCommand("createLink", false, url);
      } else if (cmd === "clear") {
        document.execCommand("removeFormat");
        document.execCommand("unlink");
      }
      dirty();
    });
    const showToolbar = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      tb.style.display = "flex";
      tb.style.top = `${r.top + window.scrollY - 40}px`;
      tb.style.left = `${r.left + window.scrollX}px`;
    };
    const hideToolbar = () => {
      tb.style.display = "none";
    };

    const onTextClick = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      el.setAttribute("contenteditable", "true");
      el.focus();
      showToolbar(el);
      e.preventDefault();
      e.stopPropagation();
    };

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-cms-text]") && !t.closest(".cms-toolbar")) hideToolbar();
    };
    document.addEventListener("click", onDocClick);
    window.addEventListener("scroll", hideToolbar, true);
    texts.forEach((el) => {
      el.setAttribute("data-cms-text", "1");
      el.addEventListener("click", onTextClick);
    });

    // Stop links navigating while editing.
    const blockNav = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a");
      if (a) e.preventDefault();
    };
    root.addEventListener("click", blockNav, true);

    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    imgs.forEach((img, i) => {
      img.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const token = `img-${i}-${Date.now()}`;
        img.setAttribute("data-cms-img", token);
        parentWin.postMessage({ type: "cms:pickImage", token }, "*");
      });
    });

    root.addEventListener("input", dirty, true);

    const clean = (): string => {
      const clone = root.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("[contenteditable]")
        .forEach((e) => e.removeAttribute("contenteditable"));
      clone
        .querySelectorAll("[data-cms-text]")
        .forEach((e) => e.removeAttribute("data-cms-text"));
      clone
        .querySelectorAll("[data-cms-img]")
        .forEach((e) => e.removeAttribute("data-cms-img"));
      return clone.innerHTML;
    };

    // --- Drag-and-drop image replace (from the parent's media sidebar) ---
    // The parent posts cms:dragStart{asset} when a library thumbnail starts
    // dragging; native drag events then fire inside this same-origin iframe.
    // Dropping on an <img> swaps its src + alt.
    let pendingAsset: { id: number; url: string; alt: string | null } | null =
      null;
    let dropTarget: HTMLImageElement | null = null;
    const setTarget = (img: HTMLImageElement | null) => {
      if (dropTarget && dropTarget !== img)
        dropTarget.classList.remove("cms-drop-target");
      dropTarget = img;
      if (img) img.classList.add("cms-drop-target");
    };
    const imgFrom = (t: EventTarget | null) =>
      t instanceof HTMLElement
        ? (t.closest("img") as HTMLImageElement | null)
        : null;

    const onDragOver = (e: DragEvent) => {
      if (!pendingAsset) return;
      const img = imgFrom(e.target);
      if (img) {
        e.preventDefault(); // allow drop
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        setTarget(img);
      } else {
        setTarget(null);
      }
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

    const onMsg = (ev: MessageEvent) => {
      const d = ev.data || {};
      if (d.type === "cms:save") {
        parentWin.postMessage({ type: "cms:content", path, html: clean() }, "*");
      } else if (d.type === "cms:setImage") {
        const img = root.querySelector<HTMLImageElement>(
          `[data-cms-img="${d.token}"]`,
        );
        if (img) {
          img.setAttribute("src", d.src);
          if (d.alt) img.setAttribute("alt", d.alt);
          img.removeAttribute("data-cms-img");
          dirty();
        }
      } else if (d.type === "cms:dragStart") {
        pendingAsset = d.asset || null;
      } else if (d.type === "cms:dragEnd") {
        setTarget(null);
        pendingAsset = null;
      }
    };
    window.addEventListener("message", onMsg);
    parentWin.postMessage({ type: "cms:ready", path }, "*");

    return () => {
      window.removeEventListener("message", onMsg);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      window.removeEventListener("scroll", hideToolbar, true);
      tb.remove();
      style.remove();
    };
  }, [html, path]);

  return <div id="cms-edit-root" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
