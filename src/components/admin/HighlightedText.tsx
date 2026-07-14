import { Fragment } from "react";

export interface HighlightedTextProps {
  text: string;
  query: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps every case-insensitive occurrence of `query` inside `text` in a
 * <mark>, built via plain string splitting/rendering — never
 * dangerouslySetInnerHTML. Works for Arabic and English since matching is
 * plain substring comparison (Arabic has no case, so `i` flag is a no-op
 * for it but harmless). Renders `text` unchanged if `query` is empty. */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(trimmedQuery)})`, "gi"));
  const lowerQuery = trimmedQuery.toLowerCase();

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === lowerQuery ? (
          <mark key={index} className="rounded-sm bg-gold-champagne/30 text-gold-dark">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
