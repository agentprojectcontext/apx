import { Button, Kbd, SettingRow, Switch } from "@apx/ui";
import { type KeyboardEvent, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

type Prefs = { shortcut: string; launch_at_login: boolean };

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

/** Applies the desktop settings in the shell (no-op in a plain browser). */
export async function applyDesktopPrefs(): Promise<void> {
  if (!window.apxDesktop?.applyDesktopPrefs) return;
  try {
    const p = await client.call("desktop.get", {});
    window.apxDesktop.applyDesktopPrefs({ shortcut: p.shortcut, launchAtLogin: p.launch_at_login });
  } catch {}
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
      .then(setPrefs, () => setPrefs({ shortcut: "Alt+Space", launch_at_login: false }));
  }, []);

  const save = async (next: Prefs) => {
    try {
      const saved = await client.call("desktop.set", next);
      setPrefs(saved);
      window.apxDesktop?.applyDesktopPrefs?.({ shortcut: saved.shortcut, launchAtLogin: saved.launch_at_login });
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
          label={t("desktop.login")}
        />
      </SettingRow>
    </>
  );
}
