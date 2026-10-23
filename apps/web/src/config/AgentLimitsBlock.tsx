import type { AgentLimits } from "@apx/protocol";
import { Input, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Key = keyof AgentLimits;
/** Tokens are typed in thousands: 600 means 600k. */
const SCALE: Record<Key, number> = { runs: 1, tokens: 1000 };
const MAX: Record<Key, number> = { runs: 10_000, tokens: 1_000_000 };

/**
 * How far agents go on their own (delegating, waking each other with results) before they wait for the owner to
 * write: one switch removes both limits; otherwise a number of turns and of tokens (left empty: that one has none).
 */
export function AgentLimitsBlock() {
  const t = useT();
  const [limits, setLimits] = useState<AgentLimits>();
  const [defaults, setDefaults] = useState<AgentLimits>({ runs: 30, tokens: 1_500_000 });
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({});
  const [fanOutAsk, setFanOutAsk] = useState(true);
  useEffect(() => {
    void client
      .call("agents.limits", {})
      .then((r) => {
        setLimits({ runs: r.runs, tokens: r.tokens });
        setDefaults(r.defaults);
        setFanOutAsk(r.fan_out_ask);
      })
      .catch(() => setLimits(undefined));
  }, []);
  if (!limits) return null;
  const save = (next: AgentLimits) => {
    setLimits(next);
    void client
      .call("agents.set_limits", next)
      .then(setLimits)
      .catch(() => setLimits(limits));
  };
  const none = !limits.runs && !limits.tokens;
  const row = (key: Key) => {
    const shown = draft[key] ?? (limits[key] ? String(Math.round(limits[key] / SCALE[key])) : "");
    const commit = () => {
      const typed = draft[key];
      setDraft((d) => ({ ...d, [key]: undefined }));
      if (typed === undefined) return;
      const n = Math.round(Number(typed) || 0);
      save({ ...limits, [key]: n > 0 ? Math.min(MAX[key], n) * SCALE[key] : 0 });
    };
    return (
      <SettingRow title={t(`limits.${key}`)} description={t(`limits.${key}Hint`)}>
        <div className="tgquiet">
          <Input
            aria-label={t(`limits.${key}`)}
            type="number"
            min={0}
            max={MAX[key]}
            className="nudge__num"
            placeholder={t("limits.none")}
            value={shown}
            onChange={(e) => {
              const typed = e.currentTarget.value;
              setDraft((d) => ({ ...d, [key]: typed }));
            }}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          {key === "tokens" && <span className="tgquiet__word">{t("limits.thousands")}</span>}
        </div>
      </SettingRow>
    );
  };
  return (
    <>
      <SubHead>{t("limits.title")}</SubHead>
      <p className="config__lead">{t("limits.lead")}</p>
      <SettingRow title={t("limits.off")} description={t("limits.offHint")}>
        <Switch
          size="sm"
          checked={none}
          onCheckedChange={(off) => save(off ? { runs: 0, tokens: 0 } : defaults)}
          aria-label={t("limits.off")}
        />
      </SettingRow>
      {!none && row("runs")}
      {!none && row("tokens")}
      <SettingRow title={t("limits.fanOut")} description={t("limits.fanOutHint")}>
        <Switch
          size="sm"
          checked={fanOutAsk}
          onCheckedChange={(ask) => {
            setFanOutAsk(ask);
            void client
              .call("agents.set_fan_out_ask", { ask })
              .then((r) => setFanOutAsk(r.ask))
              .catch(() => setFanOutAsk(!ask));
          }}
          aria-label={t("limits.fanOut")}
        />
      </SettingRow>
    </>
  );
}
