// "Disconnect" picked in an account's menu: its settings open on the question alone, without the dialog behind it.
let asked: string | undefined;

/** The next settings opened for this account ask to disconnect it first. */
export function askRemove(id: string): void {
  asked = id;
}

/** Whether the settings opening for `id` came from "Disconnect" (read as often as React renders; `clearRemoveAsk` ends it). */
export const removeAsked = (id: string | undefined): boolean => id !== undefined && asked === id;

/** The question was shown: the next settings open as usual. */
export function clearRemoveAsk(): void {
  asked = undefined;
}
