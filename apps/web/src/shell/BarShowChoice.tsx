import { SegmentedControl } from "@apx/ui";
import { type BarShow, setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";

/** Foot of a top-bar popover: whether its button shows its figures or only a small mark. */
export function BarShowChoice({ pref }: { pref: "quotaBar" | "resourcesBar" }) {
  const t = useT();
  const value = usePrefs((s) => s[pref]);
  return (
    <div className="barshow">
      <span className="barshow__label">{t("bar.show")}</span>
      <SegmentedControl
        size="sm"
        label={t("bar.show")}
        value={value}
        onValueChange={(v) => setPrefs({ [pref]: v as BarShow })}
        options={[
          { value: "full", label: t("bar.full") },
          { value: "mini", label: t("bar.mini") },
        ]}
      />
    </div>
  );
}
