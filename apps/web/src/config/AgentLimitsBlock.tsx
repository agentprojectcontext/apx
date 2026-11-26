import type { AgentLimits, OwnerIdentity } from "@apx/protocol";
import { Input, SegmentedControl, SettingRow, Switch } from "@apx/ui";
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
 * write: none until the owner turns them on; then a number of turns and of tokens (left empty: that one has none).
 * Also whether finished work that can be undone is published without asking (DECISIONS.md#d-208).
 */
export function AgentLimitsBlock() {
  const t = useT();
  const [limits, setLimits] = useState<AgentLimits>();
  const [defaults, setDefaults] = useState<AgentLimits>({ runs: 100, tokens: 5_000_000 });
  const [draft, setDraft] = useState<Partial<Record<Key | "stuckRuns" | "stuckTokens", string>>>({});
  const [stuck, setStuck] = useState<AgentLimits>();
  const [publish, setPublish] = useState<OwnerIdentity["publish"]>();
  useEffect(() => {
    void client
      .call("owner.get", {})
      .then((o) => setPublish(o.publish))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void client
      .call("agents.limits", {})
      .then((r) => {
        setLimits({ runs: r.runs, tokens: r.tokens });
        setDefaults(r.defaults);
        setStuck(r.stuck);
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
  const row = (key: Key, guard?: AgentLimits) => {
    const field = guard ? (key === "runs" ? "stuckRuns" : "stuckTokens") : key;
    const value = (guard ?? limits)[key];
    const shown = draft[field] ?? (value ? String(Math.round(value / SCALE[key])) : "");
    const label = t(`limits.${field}`);
    const commit = () => {
      const typed = draft[field];
      setDraft((d) => ({ ...d, [field]: undefined }));
      if (typed === undefined) return;
      const n = Math.round(Number(typed) || 0);
      const next = n > 0 ? Math.min(MAX[key], n) * SCALE[key] : 0;
      if (!guard) return save({ ...limits, [key]: next });
      setStuck({ ...guard, [key]: next });
      void client
        .call("agents.set_limits", { stuck: { [key]: next } })
        .then((result) => setStuck(result.stuck ?? guard))
        .catch(() => setStuck(guard));
    };
    return (
      <SettingRow title={label} description={guard ? undefined : t(`limits.${key}Hint`)}>
        <div className="tgquiet">
          <Input
            aria-label={label}
            type="number"
            min={0}
            max={MAX[key]}
            className="nudge__num"
            placeholder={t("limits.none")}
            value={shown}
            onChange={(e) => {
              const typed = e.currentTarget.value;
              setDraft((d) => ({ ...d, [field]: typed }));
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
      <SettingRow title={t("limits.on")} description={t(none ? "limits.offHint" : "limits.onHint")}>
        <Switch
          size="sm"
          checked={!none}
          onCheckedChange={(on) => save(on ? defaults : { runs: 0, tokens: 0 })}
          aria-label={t("limits.on")}
        />
      </SettingRow>
      {!none && row("runs")}
      {!none && row("tokens")}
      {stuck && (
        <>
          <SettingRow title={t("limits.stuck")} description={t("limits.stuckHint")}>
            <Switch
              size="sm"
              checked={Boolean(stuck.runs || stuck.tokens)}
              aria-label={t("limits.stuck")}
              onCheckedChange={(on) => {
                const next = on ? { runs: 12, tokens: 2_000_000 } : { runs: 0, tokens: 0 };
                setStuck(next);
                void client
                  .call("agents.set_limits", { stuck: next })
                  .then((result) => setStuck(result.stuck ?? stuck))
                  .catch(() => setStuck(stuck));
              }}
            />
          </SettingRow>
          {Boolean(stuck.runs || stuck.tokens) && row("runs", stuck)}
          {Boolean(stuck.runs || stuck.tokens) && row("tokens", stuck)}
        </>
      )}
      {publish && (
        <SettingRow title={t("limits.publish")} description={t("limits.publishHint")}>
          <SegmentedControl
            size="sm"
            label={t("limits.publish")}
            value={publish}
            onValueChange={(v) => {
              const next = v === "ask" ? "ask" : "auto";
              setPublish(next);
              void client
                .call("owner.set", { publish: next })
                .then((o) => setPublish(o.publish))
                .catch(() => setPublish(publish));
            }}
            options={[
              { value: "auto", label: t("limits.publish.auto") },
              { value: "ask", label: t("limits.publish.ask") },
            ]}
          />
        </SettingRow>
      )}
    </>
  );
}
