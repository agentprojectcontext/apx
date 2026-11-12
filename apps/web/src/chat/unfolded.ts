import { useState } from "react";

// Kept for the page's life: a resize between phone and desktop draws the chat again, and the card stays as it was.
const unfolded = new Map<string, boolean>();

/** Whether a teammate's card is unfolded, by its conversation: the same card in another chat opens with it. */
export function unfoldedOf(id: string, initial: boolean): boolean {
  return unfolded.get(id) ?? initial;
}

export function setUnfolded(id: string, open: boolean): void {
  unfolded.set(id, open);
}

export function useUnfolded(id: string, initial: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => unfoldedOf(id, initial));
  return [
    open,
    (next) => {
      setUnfolded(id, next);
      setOpen(next);
    },
  ];
}
