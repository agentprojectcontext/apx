// What the agent writes for APX, not for the person, on a chat channel (see the core's channels/manager.ts).
/**
 * An agent's answer that is only a signal to APX on a channel ("SKIP", "REACT ❤️", "STICKER thumbs up"): the core
 * takes it out of the chat once the turn ends; it never shows meanwhile, nor while its first letters are being written.
 */
export function isSignal(text: string): boolean {
  const t = text.trim();
  if (/^[*_`]*(SKIP|REACT[\s:*_`]+\S{1,16}|STICKER[\s:*_`]+[^\n]{1,120})[\s.*_`!]*$/iu.test(t)) return true;
  return t.length > 0 && t.length <= 7 && ["SKIP", "REACT", "STICKER"].some((w) => w.startsWith(t));
}
