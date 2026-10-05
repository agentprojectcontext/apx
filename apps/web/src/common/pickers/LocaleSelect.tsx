import type { SelectOption } from "@apx/ui";
import { useMemo } from "react";
import { LOCALES, type MessageKey, useLanguage, useT } from "../../i18n/index.ts";
import { SearchSelect } from "./SearchSelect.tsx";

const LOCAL = "~local";

/** Languages agents can answer in (ISO 639-1); each is named in itself, with the panel's name for it as a hint. */
const AGENT_LANGUAGES =
  "es en pt fr it de nl ca gl eu pl ru uk tr ar he hi zh ja ko sv no da fi el cs ro hu id vi th".split(" ");

const REGIONS: Record<string, MessageKey> = {
  Africa: "tz.region.africa",
  America: "tz.region.america",
  Antarctica: "tz.region.antarctica",
  Arctic: "tz.region.arctic",
  Asia: "tz.region.asia",
  Atlantic: "tz.region.atlantic",
  Australia: "tz.region.australia",
  Europe: "tz.region.europe",
  Indian: "tz.region.indian",
  Pacific: "tz.region.pacific",
};

function capital(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function nameOf(code: string, locale: string): string {
  try {
    return capital(new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code);
  } catch {
    return code;
  }
}

/** The language the owner's agents answer in. */
export function LanguageSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange(v: string): void;
  label: string;
}) {
  const t = useT();
  const locale = LOCALES[useLanguage()];
  const options = useMemo<SelectOption[]>(() => {
    const codes = AGENT_LANGUAGES.includes(value) ? [...AGENT_LANGUAGES] : [value, ...AGENT_LANGUAGES];
    return codes
      .map((c) => ({ value: c, label: nameOf(c, c), hint: nameOf(c, locale) }))
      .map((o) => (o.label === o.hint ? { value: o.value, label: o.label } : o));
  }, [value, locale]);
  return (
    <SearchSelect
      size="sm"
      label={label}
      searchPlaceholder={t("pickers.searchLanguage")}
      emptyLabel={t("pickers.noMatch")}
      value={value}
      onValueChange={(v) => v && onChange(v)}
      options={options}
    />
  );
}

function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** "GMT-03:00" for a zone right now (DST-aware). */
function offsetOf(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return part === "GMT" || !part ? "GMT+00:00" : part;
  } catch {
    return "";
  }
}

/** A zone as a city under its region: "America/Argentina/Buenos_Aires" → "Argentina / Buenos Aires" in America. */
function split(zone: string): { region: string; place: string } {
  const [region = zone, ...rest] = zone.split("/");
  return { region: rest.length ? region : "", place: (rest.length ? rest : [zone]).join(" / ").replaceAll("_", " ") };
}

/** The owner's IANA time zone, grouped by region with the current offset; empty is this machine's. */
export function TimezoneSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange(v: string): void;
  label: string;
}) {
  const t = useT();
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options = useMemo<SelectOption[]>(() => {
    const now = new Date();
    const all = zones();
    const list = value && !all.includes(value) ? [value, ...all] : all;
    const rows = list
      .map((z) => {
        const { region, place } = split(z);
        const key = REGIONS[region];
        return { value: z, label: place, hint: offsetOf(z, now), group: key ? t(key) : t("tz.region.other") };
      })
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    return [
      { value: LOCAL, label: t("account.timezoneLocal", { zone: split(local).place }), hint: offsetOf(local, now) },
      ...rows,
    ];
  }, [value, local, t]);
  return (
    <SearchSelect
      size="sm"
      label={label}
      searchPlaceholder={t("pickers.searchZone")}
      emptyLabel={t("pickers.noMatch")}
      value={value || LOCAL}
      onValueChange={(v) => v && onChange(v === LOCAL ? "" : v)}
      options={options}
    />
  );
}
