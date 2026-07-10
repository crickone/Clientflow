/**
 * Minimal HTML sanitizer for CMS `kind:'html'` content blocks. The imported
 * Renova page bodies are first-party, but we still strip executable vectors so
 * a content edit can never inject script. Behaviour/animation JS lives in the
 * coded page chrome, never in editable HTML.
 */
/**
 * For first-party imported pages (the Renova migration). Keeps <style> so the
 * page's own CSS renders, but still strips executable vectors (script, inline
 * handlers, javascript: URLs, embeds).
 */
export function sanitizeHtmlKeepStyles(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, ' $1="#"')
    .replace(/<\s*(iframe|object|embed)\b[^>]*>/gi, "");
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return (
    html
      // remove <script>…</script> and <style>…</style> blocks
      .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      // remove inline event handlers: on*="…" / on*='…' / on*=value
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // neutralise javascript: in href/src
      .replace(/\s(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, ' $1="#"')
      // drop <iframe>/<object>/<embed> openers (defensive)
      .replace(/<\s*(iframe|object|embed)\b[^>]*>/gi, "")
  );
}
