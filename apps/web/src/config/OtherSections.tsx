import { Badge, Button, EmptyState, Icons, Input, SegmentedControl, SettingRow, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, type ChannelKind } from "../channels/kinds.ts";
import { loadHealth } from "../data/engines.ts";
import { initialsOf, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { isLanguage, LANGUAGE_NAMES, LANGUAGES, useLanguage, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { SectionHead } from "./SectionHead.tsx";

/** Account: how the panel calls you. Stored in this browser only. */
export function AccountSection() {
  const t = useT();
  const stored = usePrefs((s) => s.displayName);
  const you = t("account.you");
  const [draft, setDraft] = useState(stored);
  const save = () => setPrefs({ displayName: draft.trim() });
  return (
    <>
      <SectionHead title={t("config.account")} lead={t("account.lead")} />
      <div className="account-card">
        <span className="account-card__avatar">{initialsOf(draft.trim() || you)}</span>
        <div className="account-card__text">
          <div className="account-card__name">{stored || you}</div>
          <div className="account-card__sub">{t("account.owner")}</div>
        </div>
      </div>
      <SettingRow title={t("account.name")} description={t("account.nameHint")}>
        <Input
          size="sm"
          className="config__input"
          value={draft}
          placeholder={you}
          maxLength={40}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          aria-label={t("account.name")}
        />
      </SettingRow>
      <SettingRow title={t("account.cloud")} description={t("account.cloudHint")}>
        <Badge>{t("common.soon")}</Badge>
      </SettingRow>
    </>
  );
}

/** Appearance: look, mode, font, transcript width, language. */
export function AppearanceSection() {
  const t = useT();
  const mode = useNav((s) => s.mode);
  const look = usePrefs((s) => s.look);
  const font = usePrefs((s) => s.font);
  const width = usePrefs((s) => s.transcriptWidth);
  const lang = useLanguage();
  return (
    <>
      <SectionHead title={t("config.appearance")} />
      <SettingRow title={t("appearance.font")} description={t("appearance.fontHint")}>
        <SegmentedControl
          size="sm"
          label={t("appearance.fontLabel")}
          value={font}
          onValueChange={(v) => setPrefs({ font: v === "mono" ? "mono" : "system" })}
          options={[
            { value: "system", label: t("appearance.font.system") },
            { value: "mono", label: t("appearance.font.mono") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("appearance.width")} description={t("appearance.widthHint")}>
        <SegmentedControl
          size="sm"
          label={t("appearance.widthLabel")}
          value={width}
          onValueChange={(v) => setPrefs({ transcriptWidth: v === "narrow" || v === "wide" ? v : "medium" })}
          options={[
            { value: "narrow", label: t("appearance.width.narrow") },
            { value: "medium", label: t("appearance.width.medium") },
            { value: "wide", label: t("appearance.width.wide") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("appearance.mode")}>
        <SegmentedControl
          size="sm"
          label={t("appearance.mode")}
          value={mode}
          onValueChange={(v) => go.setMode(v === "dark" ? "dark" : "light")}
          options={[
            { value: "light", label: t("appearance.mode.light") },
            { value: "dark", label: t("appearance.mode.dark") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("appearance.look")} description={t("appearance.lookHint")}>
        <SegmentedControl
          size="sm"
          label={t("appearance.look")}
          value={look}
          onValueChange={(v) => setPrefs({ look: v === "classic" ? "classic" : "minimal" })}
          options={[
            { value: "minimal", label: t("appearance.look.minimal") },
            { value: "classic", label: t("appearance.look.classic") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("language.label")} description={t("language.hint")}>
        <SegmentedControl
          size="sm"
          label={t("language.label")}
          value={lang}
          onValueChange={(v) => isLanguage(v) && setPrefs({ language: v })}
          options={LANGUAGES.map((l) => ({
            value: l,
            label: LANGUAGE_NAMES[l],
          }))}
        />
      </SettingRow>
    </>
  );
}

/** A channel kind that cannot be connected yet. */
export function ChannelSoon({ channel }: { channel: ChannelKind }) {
  const t = useT();
  const name = t(CHANNEL_KINDS[channel].name);
  return (
    <div className="channelcfg">
      <KindTile kind={channel} size={40} />
      <EmptyState variant="dashed" icon={<Icons.Clock />} title={t("common.comingSoon", { name })}>
        {t("channel.soonBody")}
      </EmptyState>
    </div>
  );
}

/** Daemon and advanced: where the panel is connected and which code the core runs. */
export function AdvancedSection() {
  const t = useT();
  const health = useData((s) => s.health);
  const connection = useData((s) => s.connection);
  useEffect(() => {
    void loadHealth();
  }, []);
  const rows: [string, string][] = health
    ? [
        [t("advanced.core"), window.location.origin],
        [t("advanced.version"), health.version],
        [t("advanced.code"), health.code_sha],
        [t("advanced.protocol"), String(health.protocol)],
        [t("advanced.install"), health.home_id],
        [t("advanced.uptime"), uptime(health.uptime_s)],
      ]
    : [[t("advanced.core"), window.location.origin]];
  return (
    <>
      <SectionHead
        title={t("config.advanced")}
        lead={t("advanced.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            onClick={() => void loadHealth()}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      <dl className="kv">
        <div className="kv__row">
          <dt>{t("advanced.connection")}</dt>
          <dd>
            <Badge tone={connection === "online" ? "brand" : connection === "offline" ? "danger" : "neutral"} dot>
              {connection === "online"
                ? t("connection.online")
                : connection === "offline"
                  ? t("connection.offline")
                  : t("connection.connecting")}
            </Badge>
          </dd>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd className="kv__mono">{v}</dd>
          </div>
        ))}
      </dl>
      {health ? (
        <div className="subsys">
          <h3 className="config__sub">{t("advanced.subsystems")}</h3>
          {Object.entries(health.subsystems).map(([name, st]) => (
            <SettingRow key={name} title={name} description={st.detail}>
              <Badge tone={st.status === "ok" ? "brand" : st.status === "degraded" ? "warning" : "neutral"} dot>
                {st.status}
              </Badge>
            </SettingRow>
          ))}
        </div>
      ) : (
        <Skeleton shape="block" height={120} />
      )}
    </>
  );
}

function uptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
