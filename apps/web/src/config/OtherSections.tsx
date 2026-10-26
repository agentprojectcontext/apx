import type { OwnerIdentity } from "@apx/protocol";
import { Badge, EmptyState, Icons, Input, SegmentedControl, SettingRow, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, type ChannelKind } from "../channels/kinds.ts";
import { LanguageSelect, TimezoneSelect } from "../common/pickers/LocaleSelect.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { initialsOf, setPrefs, usePrefs } from "../data/prefs.ts";
import { isLanguage, LANGUAGE_NAMES, LANGUAGES, useLanguage, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { EmailSignatures } from "./EmailSignatures.tsx";
import { SectionHead } from "./SectionHead.tsx";
import "../styles/theme-switch.css";

/** Account: who you are, for the panel and for your agents (name, a few lines about you, their language, your time). */
export function AccountSection() {
  const t = useT();
  const stored = usePrefs((s) => s.displayName);
  const you = t("account.you");
  const [owner, setOwner] = useState<OwnerIdentity>();
  const [draft, setDraft] = useState(stored);
  useEffect(() => {
    void client
      .call("owner.get", {})
      .then((o) => {
        setOwner(o);
        if (o.name && !stored) setDraft(o.name);
      })
      .catch(() => {});
  }, [stored]);
  const save = (patch: Partial<OwnerIdentity>) =>
    void client
      .call("owner.set", patch)
      .then(setOwner)
      .catch((e: unknown) => notify(t("error.account", { error: e instanceof Error ? e.message : String(e) })));
  const saveName = () => {
    setPrefs({ displayName: draft.trim() });
    if (draft.trim() && draft.trim() !== owner?.name) save({ name: draft.trim() });
  };
  return (
    <>
      <SectionHead title={t("config.account")} lead={t("account.lead")} />
      <div className="account-card">
        <span className="account-card__avatar">{initialsOf(draft.trim() || you)}</span>
        <div className="account-card__text">
          <div className="account-card__name">{draft.trim() || you}</div>
          <div className="account-card__sub">{t("account.owner")}</div>
        </div>
      </div>
      <SettingRow title={t("account.name")} description={t("account.nameHint")}>
        <Input
          size="sm"
          className="config__input"
          value={draft}
          placeholder={you}
          maxLength={80}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && saveName()}
          aria-label={t("account.name")}
        />
      </SettingRow>
      {owner && (
        <>
          <SettingRow stacked title={t("account.about")} description={t("account.aboutHint")}>
            <Textarea
              className="config__input account__about"
              rows={3}
              defaultValue={owner.about}
              maxLength={2000}
              placeholder={t("account.aboutPlaceholder")}
              onBlur={(e) => e.currentTarget.value !== owner.about && save({ about: e.currentTarget.value })}
              aria-label={t("account.about")}
            />
          </SettingRow>
          <SettingRow title={t("account.agentLanguage")} description={t("account.agentLanguageHint")}>
            <LanguageSelect
              label={t("account.agentLanguage")}
              value={owner.language}
              onChange={(v) => save({ language: v })}
            />
          </SettingRow>
          <SettingRow title={t("account.timezone")} description={t("account.timezoneHint")}>
            <TimezoneSelect
              label={t("account.timezone")}
              value={owner.timezone}
              onChange={(v) => save({ timezone: v })}
            />
          </SettingRow>
        </>
      )}
      <EmailSignatures />
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
        <button
          type="button"
          role="switch"
          aria-checked={mode === "dark"}
          aria-label={t("appearance.mode.dark")}
          className={`theme-switch${mode === "dark" ? " is-dark" : ""}`}
          onClick={go.toggleMode}
        >
          <Icons.Sun size={16} className="theme-switch__sun" aria-hidden="true" />
          <Icons.Moon size={16} className="theme-switch__moon" aria-hidden="true" />
          <span className="theme-switch__thumb" />
        </button>
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
