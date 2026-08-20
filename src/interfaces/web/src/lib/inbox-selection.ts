// Which thread an inbox row points at, and how to tell when it has moved.
//
// Pure on purpose: the inbox follows its selected row as the list refreshes
// underneath, and getting the comparison wrong is invisible until the exact day
// it matters. Kept out of the screen so it can be tested without a DOM.

/** The part of an inbox row that says WHICH thread it currently points at. */
export interface RowThread {
  channel?: string | null;
  conversation_id?: string | null;
}

/**
 * Has this row's thread changed since it was selected?
 *
 * Channel AND id, never the id alone. The super-agent's history is a ledger file
 * per channel per DAY, so today's Telegram thread and today's web thread are
 * both `2026-08-20` and differ only by channel. Comparing ids left the pane on
 * the web thread while the row it belongs to had already moved to Telegram: the
 * list showed a preview the pane could not reach.
 *
 * Null and undefined are the same absence — a row that never had a channel and
 * one whose channel is null must not read as a move, or the pane would remount
 * on every refresh.
 */
export function threadMoved(selected: RowThread, fresh: RowThread): boolean {
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
  return !same(selected.conversation_id, fresh.conversation_id) || !same(selected.channel, fresh.channel);
}
