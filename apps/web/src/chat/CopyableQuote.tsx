import type { QuoteRenderer } from "@apx/ui";
import { type ReactElement, useRef } from "react";
import { CopyButton } from "./MessageActions.tsx";

/** A quote in an agent's answer is often a draft to paste somewhere else: it gets a copy button of its own. */
export const copyableQuote: QuoteRenderer = (quote, key) => <CopyableQuote key={key} quote={quote} />;

function CopyableQuote({ quote }: { quote: ReactElement }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className="quotecopy">
      {quote}
      <span className="quotecopy__button">
        {/* What the quote reads on screen: its words without the markdown marks. */}
        <CopyButton text={() => box.current?.querySelector("blockquote")?.innerText.trim() ?? ""} />
      </span>
    </div>
  );
}
