export function isSecretMarker(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("*** set ***");
}

export function secretHint(value: unknown, fallback = "(no seteada)") {
  return isSecretMarker(value) ? value : fallback;
}

// The daemon redacts secrets as "*** set *** (...XXXXX)". Pull out the XXXXX
// suffix so the UI can show "…XXXXX" without ever holding the real secret.
export function secretSuffix(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/\(\.\.\.([^)]+)\)/);
  return m ? m[1] : null;
}
