import type { CSSProperties } from 'react';

export function TypingTitle({ text }: { text: string }) {
  return <span className="typing-title">
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">{Array.from(text).map((character, index) =>
      <span className="typing-character" key={index} style={{ '--type-delay': `${250 + index * 120}ms` } as CSSProperties}>{character}</span>
    )}</span>
  </span>;
}
