/** Remove a device suffix: an address identifies the person, not their linked device. */
export const normalJid = (jid: string | null | undefined): string => {
  const s = String(jid ?? "").toLowerCase();
  const at = s.indexOf("@");
  if (at < 1) return "";
  return `${s.slice(0, at).split(":")[0]}@${s.slice(at + 1)}`;
};
