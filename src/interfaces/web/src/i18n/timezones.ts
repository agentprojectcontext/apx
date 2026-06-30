// Timezone picker data. Native Intl is the "vendor" here: it ships the
// canonical IANA zone list (Intl.supportedValuesOf) and the current GMT offset
// per zone (Intl.DateTimeFormat longOffset) — no library needed.
//
// Stored value is the raw IANA id ("America/Argentina/Buenos_Aires"); the label
// shown is "(GMT-03:00) America/Argentina/Buenos_Aires", sorted by offset.

// A small fallback for ancient runtimes without Intl.supportedValuesOf.
const FALLBACK_ZONES = [
  "UTC", "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/New_York",
  "America/Los_Angeles", "America/Mexico_City", "Europe/London", "Europe/Madrid",
  "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

function zoneList(): string[] {
  try {
    const f = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof f === "function") return f("timeZone");
  } catch { /* ignore */ }
  return FALLBACK_ZONES;
}

// Detected browser/OS zone (e.g. America/Argentina/Buenos_Aires in BA).
export function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}

// Current GMT offset (minutes) for a zone, DST-aware as of `at`.
function offsetMinutes(tz: string, at: Date): number {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0; // "GMT" with no offset → 0
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
  } catch { return 0; }
}

function formatOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `GMT${sign}${h}:${m}`;
}

export interface TzOption { value: string; label: string }

let cached: TzOption[] | null = null;

// All IANA zones as { value, label } sorted by GMT offset then name.
// Computed once per page load (offsets are stable enough across a session).
export function timezoneOptions(): TzOption[] {
  if (cached) return cached;
  const now = new Date();
  cached = zoneList()
    .map((tz) => ({ value: tz, label: tz, off: offsetMinutes(tz, now) }))
    .sort((a, b) => a.off - b.off || a.value.localeCompare(b.value))
    .map(({ value, off }) => ({ value, label: `(${formatOffset(off)}) ${value}` }));
  return cached;
}
