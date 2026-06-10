// Time helpers. Single source for ISO timestamps so every store agrees on
// resolution (seconds) and shape ("YYYY-MM-DDTHH:MM:SSZ").
export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoToMs(iso) {
  return iso ? Date.parse(iso) : 0;
}
