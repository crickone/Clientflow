"use client";

import "./chat.css";
import { Fragment, type ReactNode } from "react";

import { parseBlocks, parseInline, type Inline } from "./markdown";
import { useSmoothText } from "./useSmoothText";

/** Second guard behind the parser: only http(s) or an in-app path starting with a single slash. */
function safeHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^\/(?![/\\])/.test(href);
}

/**
 * Adonis's answer as a document: headings, paragraphs, lists, tables and
 * code, 15.5px at 1.7 line height, no bubble. Built as React nodes from the
 * markdown parser (never raw HTML), so text Adonis quotes from a customer
 * cannot inject markup. While the answer streams, useSmoothText reveals it
 * at an even pace and each new word fades in (an `.ax-w` span mounts once
 * per word; keys are positional, so words already shown never re-animate).
 */
export function AnswerDocument({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { text: shown, animating } = useSmoothText(text, streaming);
  const blocks = parseBlocks(shown);

  const words = (s: string, key: string): ReactNode => {
    if (!animating) return s;
    return s.split(/(\s+)/).map((w, i) => (w.trim() ? <span key={`${key}w${i}`} className="ax-w">{w}</span> : w));
  };

  const inline = (nodes: Inline[], key: string): ReactNode[] =>
    nodes.map((n, i) => {
      const k = `${key}i${i}`;
      switch (n.kind) {
        case "strong":
          return <strong key={k}>{words(n.text, k)}</strong>;
        case "em":
          return <em key={k}>{words(n.text, k)}</em>;
        case "code":
          return <code key={k}>{n.text}</code>;
        case "link": {
          if (!safeHref(n.href)) return <Fragment key={k}>{words(n.text, k)}</Fragment>;
          const external = /^https?:\/\//.test(n.href);
          return (
            <a key={k} href={n.href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {n.text}
            </a>
          );
        }
        default:
          return <Fragment key={k}>{words(n.text, k)}</Fragment>;
      }
    });

  return (
    <div className="ax-answer">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "heading":
            return b.level === 3 ? <h4 key={key}>{inline(parseInline(b.text), key)}</h4> : <h3 key={key}>{inline(parseInline(b.text), key)}</h3>;
          case "paragraph":
            return (
              <p key={key}>
                {b.lines.map((line, j) => (
                  <Fragment key={`${key}l${j}`}>
                    {j > 0 && <br />}
                    {inline(parseInline(line), `${key}l${j}`)}
                  </Fragment>
                ))}
              </p>
            );
          case "list": {
            const items = b.items.map((item, j) => <li key={`${key}li${j}`}>{inline(parseInline(item), `${key}li${j}`)}</li>);
            return b.ordered ? (
              <ol key={key} start={b.start}>
                {items}
              </ol>
            ) : (
              <ul key={key}>{items}</ul>
            );
          }
          case "table":
            return (
              <div key={key} className="ax-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={`${key}h${j}`}>{inline(parseInline(h), `${key}h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={`${key}r${r}`}>
                        {row.map((cell, j) => (
                          <td key={`${key}r${r}c${j}`}>{inline(parseInline(cell), `${key}r${r}c${j}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return (
              <pre key={key}>
                <code>{b.text}</code>
              </pre>
            );
          case "rule":
            return <hr key={key} />;
        }
      })}
    </div>
  );
}
