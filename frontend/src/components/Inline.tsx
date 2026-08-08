import { parseInline } from '../domain/parse';

/**
 * Renders inline markup as React elements. Never uses innerHTML — see
 * design.md §9 (XSS via note content).
 */
export function Inline({ text }: { text: string }) {
  const parts = parseInline(text);
  return (
    <>
      {parts.map((p, i) => {
        switch (p.kind) {
          case 'bold':
            return <strong key={i}>{p.value}</strong>;
          case 'italic':
            return <em key={i}>{p.value}</em>;
          case 'code':
            return (
              <code key={i} className="i-code">
                {p.value}
              </code>
            );
          case 'tag':
            return (
              <span key={i} className="i-tag">
                #{p.value}
              </span>
            );
          case 'link':
            return (
              <a key={i} className="i-link" href={p.href} target="_blank" rel="noopener noreferrer">
                {p.value}
              </a>
            );
          default:
            return <span key={i}>{p.value}</span>;
        }
      })}
    </>
  );
}

/** Highlights the matched ranges produced by the search service. */
export function Highlighted({ text, spans }: { text: string; spans: Array<[number, number]> }) {
  if (!spans.length) return <>{text}</>;

  const out: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach(([s, e], i) => {
    if (s < cursor) return; // overlapping match already covered
    if (s > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, s)}</span>);
    out.push(<mark key={`m${i}`}>{text.slice(s, e)}</mark>);
    cursor = e;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}
