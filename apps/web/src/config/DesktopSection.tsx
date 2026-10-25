import { Badge, Button, Kbd, SettingRow, Switch } from "@apx/ui";
import { type KeyboardEvent, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { computerUseHere, stopKeys } from "./desktopPrefs.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

type Prefs = { shortcut: string; launch_at_login: boolean; computer_use: boolean; keep_awake: boolean };

const SYMBOL: Record<string, string> = { CommandOrControl: "⌘", Alt: "⌥", Shift: "⇧", Control: "⌃", Space: "Space" };

/** A key press as an Electron accelerator ("CommandOrControl+Shift+K"); undefined while only modifiers are held. */
function accelerator(e: KeyboardEvent): string | undefined {
  const key =
    e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : /^F\d{1,2}$/.test(e.key) ? e.key : undefined;
  if (!key) return undefined;
  const mods = [
    e.metaKey && "CommandOrControl",
    e.ctrlKey && "Control",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
  ].filter(Boolean);
  // A shortcut for the whole system needs a modifier, or it would steal a plain key from every app.
  return mods.length ? [...mods, key].join("+") : undefined;
}

/** Desktop: the quick chat's global shortcut and starting with the computer. */
export function DesktopSection() {
  const t = useT();
  const [prefs, setPrefs] = useState<Prefs>();
  const [recording, setRecording] = useState(false);
  const inApp = Boolean(window.apxDesktop?.applyDesktopPrefs);

  useEffect(() => {
    void client
      .call("desktop.get", {})
      .then(setPrefs, () =>
        setPrefs({ shortcut: "Alt+Space", launch_at_login: true, computer_use: false, keep_awake: true }),
      );
  }, []);

  const save = async (next: Prefs) => {
    try {
      const saved = await client.call("desktop.set", next);
      setPrefs(saved);
      window.apxDesktop?.applyDesktopPrefs?.({
        shortcut: saved.shortcut,
        launchAtLogin: saved.launch_at_login,
        computerUse: saved.computer_use,
      });
    } catch (e) {
      notify(t("error.desktop", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (!prefs) return <SectionHead title={t("config.desktop")} lead={t("desktop.lead")} />;
  return (
    <>
      <SectionHead title={t("config.desktop")} lead={t("desktop.lead")} />
      {!inApp && <p className="config__lead">{t("desktop.onlyApp")}</p>}
      <SubHead>{t("desktop.quick")}</SubHead>
      <SettingRow title={t("desktop.shortcut")} description={t("desktop.shortcutHint")}>
        <div className="tgtoken">
          <button
            type="button"
            className={recording ? "shortcut is-recording" : "shortcut"}
            onClick={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(e) => {
              if (!recording) return;
              e.preventDefault();
              if (e.key === "Escape") return setRecording(false);
              const acc = accelerator(e);
              if (acc) {
                setRecording(false);
                void save({ ...prefs, shortcut: acc });
              }
            }}
          >
            {recording
              ? t("desktop.press")
              : prefs.shortcut
                ? prefs.shortcut.split("+").map((k) => <Kbd key={k}>{SYMBOL[k] ?? k}</Kbd>)
                : t("desktop.none")}
          </button>
          {prefs.shortcut && (
            <Button size="sm" variant="secondary" onClick={() => void save({ ...prefs, shortcut: "" })}>
              {t("desktop.clear")}
            </Button>
          )}
        </div>
      </SettingRow>
      <SettingRow title={t("desktop.login")} description={t("desktop.loginHint")}>
        <Switch
          size="sm"
          checked={prefs.launch_at_login}
          onCheckedChange={(on) => void save({ ...prefs, launch_at_login: on })}
          aria-label={t("desktop.login")}
        />
      </SettingRow>
      {window.apxDesktop?.platform === "darwin" && (
        <SettingRow title={t("desktop.awake")} description={t("desktop.awakeHint")}>
          <Switch
            size="sm"
            checked={prefs.keep_awake}
            onCheckedChange={(on) => void save({ ...prefs, keep_awake: on })}
            aria-label={t("desktop.awake")}
          />
        </SettingRow>
      )}
      {computerUseHere() && (
        <ComputerUse on={prefs.computer_use} onChange={(on) => void save({ ...prefs, computer_use: on })} />
      )}
    </>
  );
}

type Permissions = { screen: string; accessibility: boolean };

/** Computer use on this computer: the switch, and on a Mac the two permissions macOS asks for, each with a way to grant it. */
function ComputerUse({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  const mac = window.apxDesktop?.platform === "darwin";
  const [perms, setPerms] = useState<Permissions>();
  useEffect(() => {
    const read = () => void window.apxDesktop?.computerPermissions?.().then(setPerms, () => {});
    read();
    // The owner grants them in System Settings: coming back here shows the new state.
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  const row = (kind: "screen" | "accessibility", granted: boolean | undefined) => (
    <SettingRow title={t(`desktop.cu.${kind}`)} description={t(`desktop.cu.${kind}Hint`)}>
      <div className="tgtoken">
        <Badge tone={granted ? "brand" : "warning"} dot>
          {t(granted ? "desktop.cu.granted" : "desktop.cu.missing")}
        </Badge>
        {!granted && (
          <Button size="sm" variant="secondary" onClick={() => void window.apxDesktop?.openPrivacy?.(kind)}>
            {t("desktop.cu.open")}
          </Button>
        )}
      </div>
    </SettingRow>
  );
  return (
    <>
      <SubHead>{t("desktop.cu")}</SubHead>
      <SettingRow title={t("desktop.cu.switch")} description={t("desktop.cu.switchHint", { keys: stopKeys() })}>
        <Switch size="sm" checked={on} onCheckedChange={onChange} aria-label={t("desktop.cu.switch")} />
      </SettingRow>
      {/* Windows asks for neither permission. */}
      {on && perms && mac && row("screen", perms.screen === "granted")}
      {on && perms && mac && row("accessibility", perms.accessibility)}
    </>
  );
}
