import type { QuoteRenderer } from "@apx/ui";
import { CopyButton } from "./MessageActions.tsx";

/** A quote in an agent's answer is often a draft to paste somewhere else: it gets a copy button of its own. */
export const copyableQuote: QuoteRenderer = (text, quote) => (
  <div className="quotecopy">
    {quote}
    <span className="quotecopy__button">
      <CopyButton text={text} />
    </span>
  </div>
);
