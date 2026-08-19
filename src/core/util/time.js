// Time helpers. Single source for ISO timestamps so every store agrees on
// resolution (seconds) and shape ("YYYY-MM-DDTHH:MM:SSZ").
export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoToMs(iso) {
  return iso ? Date.parse(iso) : 0;
}

// The two shapes the dated note files use (see core/memory/dated-log.js): a
// "YYYY-MM-DD" day heading and an "HH:MM" bullet tag. UTC on purpose — the
// notebook, project memory and routine memory have always been stamped in UTC
// and they are read against each other, so a per-file timezone would make two
// notes written a minute apart land on different days.
export function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function hourStamp(d = new Date()) {
  return d.toISOString().slice(11, 16);
}
