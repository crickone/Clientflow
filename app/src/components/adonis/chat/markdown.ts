/**
 * The small markdown Adonis writes, as data: blocks (headings, paragraphs,
 * lists, tables, fenced code, rules) and inline runs (bold, italic, code,
 * links). AnswerDocument builds React nodes from this and never raw HTML, so
 * text Adonis quotes from a customer cannot inject markup. Links are only
 * http(s) or paths inside the app ("/marketing/ads/12").
 *
 * Partial input (a reply still streaming) always parses: an unclosed fence
 * is code to the end, a table header without its divider yet is a paragraph.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^([-*_])(?:\s*\1){2,}$/;
const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^(\d{1,3})[.)]\s+(.*)$/;
const FENCE = /^```/;

function isTableDivider(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.includes("-") && /^[\s|:-]+$/.test(t);
}

export function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", lines: para });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (FENCE.test(t)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) body.push(lines[i++]);
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (t === "") {
      flush();
      continue;
    }
    if (RULE.test(t)) {
      flush();
      out.push({ kind: "rule" });
      continue;
    }
    const h = HEADING.exec(t);
    if (h) {
      flush();
      out.push({ kind: "heading", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2].trim() });
      continue;
    }
    if (t.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flush();
      const header = splitRow(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) rows.push(splitRow(lines[i++]));
      i--;
      out.push({ kind: "table", header, rows: rows.map((r) => header.map((_, k) => r[k] ?? "")) });
      continue;
    }
    const b = BULLET.exec(t);
    const n = b ? null : NUMBERED.exec(t);
    if (b || n) {
      flush();
      const ordered = n !== null;
      const item = b ? b[1] : n![2];
      const prev = out[out.length - 1];
      if (prev && prev.kind === "list" && prev.ordered === ordered) prev.items.push(item);
      else out.push({ kind: "list", ordered, start: n ? Number(n[1]) : 1, items: [item] });
      continue;
    }
    para.push(t);
  }
  flush();
  return out;
}

// Order matters: bold before italic, a markdown link before a bare URL.
// Italic needs a non-space just inside each marker, and underscores only at
// word edges, so "2 * 3" and snake_case tool names stay as written.
const TOKEN =
  /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s)]*)\)|(https?:\/\/[^\s<>()]+)|(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])|(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += s;
    else out.push({ kind: "text", text: s });
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    pushText(text.slice(at, start));
    at = start + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", text: m[3], href: m[4] });
    else if (m[5] !== undefined) {
      const href = m[5].replace(/[.,;:!?'"]+$/, "");
      out.push({ kind: "link", text: href, href });
      pushText(m[5].slice(href.length));
    } else if (m[6] !== undefined) out.push({ kind: "em", text: m[6] });
    else if (m[7] !== undefined) out.push({ kind: "em", text: m[7] });
  }
  pushText(text.slice(at));
  return out;
}
