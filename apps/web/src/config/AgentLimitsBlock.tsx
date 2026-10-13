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
 * write: a number of turns and of tokens, each one on or off.
 */
export function AgentLimitsBlock() {
  const t = useT();
  const [limits, setLimits] = useState<AgentLimits>();
  const [defaults, setDefaults] = useState<AgentLimits>({ runs: 16, tokens: 600_000 });
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({});
  useEffect(() => {
    void client
      .call("agents.limits", {})
      .then(({ defaults: d, ...l }) => {
        setLimits(l);
        setDefaults(d);
      })
      .catch(() => setLimits(undefined));
  }, []);
  if (!limits) return null;
  const save = (patch: Partial<AgentLimits>) => {
    const next = { ...limits, ...patch };
    setLimits(next);
    void client
      .call("agents.set_limits", next)
      .then(setLimits)
      .catch(() => setLimits(limits));
  };
  const row = (key: Key) => {
    const on = limits[key] > 0;
    const shown = draft[key] ?? String(Math.round((on ? limits[key] : defaults[key]) / SCALE[key]));
    const commit = () => {
      const typed = draft[key];
      setDraft((d) => ({ ...d, [key]: undefined }));
      if (typed === undefined) return;
      const v = Math.max(1, Math.min(MAX[key], Math.round(Number(typed) || 0)));
      save({ [key]: v * SCALE[key] });
    };
    return (
      <SettingRow title={t(`limits.${key}`)} description={t(`limits.${key}Hint`)}>
        <div className="tgquiet">
          <Switch
            size="sm"
            checked={on}
            onCheckedChange={(v) => save({ [key]: v ? defaults[key] : 0 })}
            aria-label={t(`limits.${key}`)}
          />
          {on && (
            <>
              <Input
                aria-label={t(`limits.${key}`)}
                type="number"
                min={1}
                max={MAX[key]}
                className="nudge__num"
                value={shown}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.currentTarget.value }))}
                onBlur={commit}
                onKeyDown={(e) => e.key === "Enter" && commit()}
              />
              {key === "tokens" && <span className="tgquiet__word">{t("limits.thousands")}</span>}
            </>
          )}
        </div>
      </SettingRow>
    );
  };
  return (
    <>
      <SubHead>{t("limits.title")}</SubHead>
      <p className="config__lead">{t("limits.lead")}</p>
      {row("runs")}
      {row("tokens")}
    </>
  );
}
