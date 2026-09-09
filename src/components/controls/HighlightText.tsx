import { Fragment } from "react";

interface HighlightTextProps {
  text: string;
  term: string;
}

/** Renders `text` with every case-insensitive occurrence of `term` wrapped
 * in a <mark> so search results visually show why they matched. */
export function HighlightText({ text, term }: HighlightTextProps) {
  if (!term.trim()) return <>{text}</>;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="search-hit">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
