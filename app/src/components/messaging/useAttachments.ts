"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import {
  composerReady,
  EXPIRED_CHIP_ERROR,
  parseUploadResponse,
  precheckFiles,
  readyTokens,
  trayAfterSend,
  type AttachmentItem,
  type SendOutcome,
} from "./attachmentsModel";
import { ATTACHMENT_TICKET_TTL_MS } from "@/lib/attachments/outgoingModel";
import { reportTenantMismatch, tabTenantHeaders, tenantMismatchMessage } from "@/lib/api/tabTenant";

export type { AttachmentItem, SendOutcome } from "./attachmentsModel";

const UPLOAD_URL = "/api/messages/attachments";

let seq = 0;
const newId = () => `att-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * Files attached in a message box. Each picked, dropped or pasted file is
 * checked straight away (type, size, the 5-file cap) so a refusal is
 * instant, then uploaded on its own with XMLHttpRequest so the chip can show
 * progress. The send action takes `tokens`, the signed tickets of the files
 * that finished uploading.
 *
 * `dropProps` goes on the composer's wrapper: dropping files on it, or
 * pasting a file (a screenshot) into it, calls `add`.
 */
export function useAttachments(opts: { disabled?: boolean } = {}) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const dragDepth = useRef(0);
  const disabled = !!opts.disabled;

  const patch = useCallback((id: string, next: Partial<AttachmentItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...next } : i)));
  }, []);

  const upload = useCallback(
    (id: string, file: File) => {
      const xhr = new XMLHttpRequest();
      xhrs.current.set(id, xhr);
      xhr.open("POST", UPLOAD_URL);
      // TenantTabGuard stamps fetch, not XHR: send the same tab stamp here.
      for (const [k, v] of Object.entries(tabTenantHeaders())) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) patch(id, { progress: Math.min(0.99, e.loaded / e.total) });
      };
      const finish = (status: number, body: string) => {
        xhrs.current.delete(id);
        const stale = tenantMismatchMessage(status, body);
        if (stale) reportTenantMismatch(stale);
        const res = parseUploadResponse(status, body);
        if (res.ok) patch(id, { status: "ready", progress: 1, token: res.token, media: res.media, kind: res.media.kind, expiresAt: Date.now() + ATTACHMENT_TICKET_TTL_MS });
        else patch(id, { status: "error", progress: 0, error: res.error });
      };
      xhr.onload = () => finish(xhr.status, xhr.responseText);
      xhr.onerror = () => finish(0, "");
      xhr.onabort = () => xhrs.current.delete(id);
      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    },
    [patch],
  );

  const add = useCallback(
    (list: FileList | ReadonlyArray<File> | null | undefined) => {
      if (disabled || !list) return;
      const files = Array.from(list);
      if (files.length === 0) return;
      const checks = precheckFiles(itemsRef.current, files);
      const added: AttachmentItem[] = [];
      const toUpload: Array<[string, File]> = [];
      files.forEach((f, i) => {
        const c = checks[i];
        const id = newId();
        const name = f.name || "File";
        if (c.ok) {
          added.push({ id, name, size: f.size, kind: c.kind, status: "uploading", progress: 0 });
          toUpload.push([id, f]);
        } else {
          added.push({ id, name, size: f.size, kind: c.kind, status: "error", progress: 0, error: c.error });
        }
      });
      // The ref is ahead of the render so two quick adds both see the cap.
      itemsRef.current = [...itemsRef.current, ...added];
      setItems((prev) => [...prev, ...added]);
      for (const [id, f] of toUpload) upload(id, f);
    },
    [disabled, upload],
  );

  const remove = useCallback((id: string) => {
    xhrs.current.get(id)?.abort();
    xhrs.current.delete(id);
    itemsRef.current = itemsRef.current.filter((i) => i.id !== id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const x of xhrs.current.values()) x.abort();
    xhrs.current.clear();
    itemsRef.current = [];
    setItems([]);
  }, []);

  /**
   * After a send answers: take off the files that went, keep the refused
   * ones, and mark expired tickets as errors (see trayAfterSend). `sent` is
   * the `ready` list captured when Send was pressed.
   */
  const afterSend = useCallback((sent: ReadonlyArray<AttachmentItem>, outcome: SendOutcome) => {
    const { remove, expire } = trayAfterSend(sent, outcome, Date.now());
    if (remove.length === 0 && expire.length === 0) return;
    const gone = new Set(remove);
    const dead = new Set(expire);
    const apply = (list: AttachmentItem[]) =>
      list
        .filter((i) => !gone.has(i.id))
        .map((i) => (dead.has(i.id) ? { ...i, status: "error" as const, progress: 0, token: undefined, error: EXPIRED_CHIP_ERROR } : i));
    itemsRef.current = apply(itemsRef.current);
    setItems(apply);
  }, []);

  // Stop any upload still running when the message box goes away.
  useEffect(() => {
    const map = xhrs.current;
    return () => {
      for (const x of map.values()) x.abort();
      map.clear();
    };
  }, []);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const dropProps = useMemo(
    () => ({
      onDragEnter: (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      },
      onDragOver: (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        add(e.dataTransfer.files);
      },
      onPaste: (e: ClipboardEvent) => {
        if (disabled) return;
        const files = e.clipboardData?.files;
        // Only a pasted file is taken over; pasting text works as normal.
        if (files && files.length > 0) {
          e.preventDefault();
          add(files);
        }
      },
    }),
    [add, disabled],
  );

  const tokens = useMemo(() => readyTokens(items), [items]);
  /** The chips a send would carry now: capture this with `tokens` when Send is pressed. */
  const ready = useMemo(() => items.filter((i) => i.status === "ready" && !!i.token), [items]);
  const busy = items.some((i) => i.status === "uploading");

  return {
    items,
    add,
    remove,
    clear,
    tokens,
    ready,
    afterSend,
    busy,
    dragging,
    dropProps,
    /** Send is ready: text or a ready file, and nothing still uploading. */
    readyWith: (text: string) => composerReady(text, items),
  };
}

export type Attachments = ReturnType<typeof useAttachments>;
