import { toBlocks } from "@/lib/agreementsModel";

/** A document's text: "## " headings, list lines and paragraphs. Plain text in, never HTML. */
export function DocText({ body }: { body: string }) {
  const blocks = toBlocks(body);
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    out.push(
      <ul key={`ul${k}`}>
        {list.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  blocks.forEach((b, i) => {
    if (b.kind === "li") {
      list.push(b.text);
      return;
    }
    flush(i);
    out.push(b.kind === "h" ? <h3 key={i}>{b.text}</h3> : <p key={i}>{b.text}</p>);
  });
  flush(blocks.length);
  return <div className="ag-text">{out}</div>;
}
